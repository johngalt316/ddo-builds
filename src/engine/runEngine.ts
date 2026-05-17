// Top-level engine orchestrator.
//
// Glues collectEffects → evaluateEffect → breakdowns into one call,
// returning a unified result for every tracked stat plus diagnostics
// (unmatched feats, unmodeled effect types) so the UI can surface gaps.

import type { Build } from '@/types/build';
import type {
  DDOClassData, DDOFeatData, DDORaceData, DDOBonusType,
  EnhancementTreeData, ItemBuffCatalog, DDOSetBonusData, DDOAugmentData,
  DDOFiligreeData, DDOFiligreeSetBonus, DDOOptionalBuff, DDOGuildBuff,
} from '@/types/ddoData';
import { applyRacialBonuses, applyAbilityTomes, applyLevelUps, calculateBAB, classHitPoints, calculateSaves } from '@/engine';
import { ddoClassDataToEngineClass, ddoRaceDataToRace } from '@/utils/classAdapter';
import { collectEffects, buildBuildContext, collectAvailableStances, type AvailableStance } from './collectEffects';
import { weaponInGroup } from './weaponGroups';
import { evaluateEffect, passesRequirements } from './evaluateEffect';
import { buildStackingRules, type Bonus, type BreakdownResult, type StackingRules } from './bonusStacking';
import {
  breakdownAbilityScore, breakdownHitPoints, breakdownSave,
  breakdownDoublestrike, breakdownDoubleshot, breakdownSneakAttackDice,
  breakdownOffHandChance,
  breakdownWeaponCritRange, breakdownWeaponCritMult, breakdownWeaponCritMult1920,
  breakdownSeeker,
  breakdownWeaponBaseDamage, breakdownWeaponFlatDamage, breakdownWeaponDamagePct,
  breakdownShieldBashRate,
  breakdownImbueDice,
  breakdownMeleePower, breakdownRangedPower,
  breakdownHealingAmp, breakdownNegativeHealingAmp, breakdownRepairAmp,
  breakdownAC, breakdownDodge, breakdownPRR, breakdownMRR, breakdownSpellResistance,
  breakdownMeleeSpeed, breakdownRangedSpeed,
  breakdownArcaneSpellFailure,
  breakdownSpellPower, breakdownSpellCriticalChance, breakdownSpellCriticalDamage,
  breakdownUniversalSpellPower,
  breakdownUniversalSpellCriticalChance, breakdownUniversalSpellCriticalDamage,
  breakdownSpellPoints,
  breakdownSpellDC, breakdownSpellPenetration, breakdownCasterLevel,
  breakdownSpellCooldownReduction,
  breakdownSkill,
  SPELL_SCHOOLS, SPELL_DAMAGE_TYPES, type SpellSchool, type SpellDamageType,
} from './breakdowns';
import skillsJson from '@/data/skills.json';
import type { Skill } from '@/types/gameData';
const ALL_SKILLS = skillsJson as unknown as Skill[];
import { abilityModifier } from './abilityScores';
import type { Stat } from '@/types/build';

/**
 * A spell-like ability granted by a feat, enhancement, destiny, item, or set
 * bonus. Surfaced separately from `Bonus[]` because SLAs aren't numeric
 * stat contributions — they're a list of cast-able abilities with their own
 * cost / max-caster-level / cooldown metadata.
 *
 * Each SpellLikeAbility effect is its own entry — same-named SLAs from
 * different sources (e.g. Past Life Magic Missile + ArchMage Magic Missile)
 * aren't merged because they scale on different caster levels.
 */
export type SLACategory = 'feat' | 'enhancement' | 'gear' | 'other';

export interface CollectedSLA {
  /** Spell name being granted (e.g. "Shield", "Magic Missile"). */
  name: string;
  /** Casting class for DC + caster level (e.g. "Wizard"). May be empty when
   *  the granting source doesn't specify one. */
  castingClass: string;
  /** SP cost per cast (Amount[1]). Falls back to 0 when unset. */
  cost: number;
  /** Max caster level cap (Amount[2]). 0 = no cap (uses class CL). */
  maxCasterLevel: number;
  /** Cooldown in seconds between casts (Amount[3]). */
  cooldown: number;
  /** Per-rest charges. 0 means unlimited. Sourced from Amount[0] of
   *  the granting `<Effect>` block — XML entries that need a non-zero
   *  charge count carry it directly (see Past Life: Arcane Initiate
   *  in Wizard.class.xml). */
  charges: number;
  /** Where it came from — full source label including prefix. */
  source: string;
  /** Bucketed source category, derived from the source-label prefix. Used
   *  by the UI to split feat-granted SLAs onto their own tab. */
  category: SLACategory;
}

/** Map a SourcedEffect.source label prefix → category bucket. */
function categorizeSLASource(source: string): SLACategory {
  // Enhancement-tree prefixes: heroic [E], destiny [D], reaper [R].
  if (/^\[[EDR]\] /.test(source)) return 'enhancement';
  // Gear-side: items [G], augments [A], item set [S], filigrees [F]/[FA]/[FS].
  if (/^\[(G|A|S|F|FA|FS)\] /.test(source)) return 'gear';
  // Past-life feats use [PL]; selected/class autofeats have no bracket prefix.
  if (source.startsWith('[PL] ') || !source.startsWith('[')) return 'feat';
  return 'other';
}

/**
 * Resolve which "class" controls an SLA's caster-level scaling. The data
 * isn't always honest about this — e.g. Past Life: Arcane Initiate's Magic
 * Missile lists `<Item>Wizard</Item>` but actually scales on character
 * level, not Wizard class level. Apply heuristics:
 *
 *   - Source mentions "Past Life:" (heroic past life stored as a special
 *     feat with [PL] prefix, OR epic past life trained as a regular feat)
 *     → always "Character" (universal CL scaling).
 *   - "None" / empty Item[1] → "Character" (typical for destiny SLAs and
 *     class autofeats that don't tie scaling to a specific casting stat).
 *   - Anything else → use Item[1] as the casting class.
 */
function resolveSLACastingClass(rawClass: string, source: string): string {
  if (source.includes('Past Life:')) return 'Character';
  if (!rawClass || rawClass === 'None') return 'Character';
  return rawClass;
}

export interface EngineResult {
  abilityScores: Record<Stat, BreakdownResult>;
  hitPoints: BreakdownResult;
  saves: { Fortitude: BreakdownResult; Reflex: BreakdownResult; Will: BreakdownResult };
  meleePower: BreakdownResult;
  rangedPower: BreakdownResult;
  doublestrike: BreakdownResult;
  doubleshot: BreakdownResult;
  /** Total sneak-attack dice. Same value drives melee + ranged sneak
   *  attacks AND spell procs that read sneak dice (Magical Ambush). */
  sneakAttackDice: BreakdownResult;
  /** Off-hand attack chance bonus from enhancements / destinies (stacks on
   *  top of the TWF feat base: 0/40/60/80%). Cap is enforced in melee calc. */
  offHandChance: BreakdownResult;
  /** Flat faces added to the weapon's crit threat range after IC doubling. */
  weaponCritRange: BreakdownResult;
  /** Additional [W] dice per hit from enhancements / destinies. */
  weaponBaseDamage: BreakdownResult;
  /** Flat per-hit damage bonus from Deadly / Insightful Deadly / Quality Deadly etc. */
  weaponFlatDamage: BreakdownResult;
  /** Percentage physical damage bonus (e.g. "+2% Epic Damage" from Primal Force).
   *  Applied as a separate ×(1 + pct/100) multiplier on top of Melee Power. */
  weaponDamagePct: BreakdownResult;
  /** Secondary shield bash rate (% chance per MH attack to trigger a bash).
   *  Sources: Improved Shield Bash (+20), Vanguard enhancements (+10 each), etc. */
  shieldBashRate: BreakdownResult;
  /** Flat bonus to crit multiplier on every crit. */
  weaponCritMult: BreakdownResult;
  /** Flat bonus to crit multiplier only on 19–20 rolls. */
  weaponCritMult1920: BreakdownResult;
  /** Seeker total — flat damage bonus applied before crit multiplier on
   *  successful critical hits (melee and ranged). */
  seeker: BreakdownResult;
  imbueDice: BreakdownResult;
  meleeSpeed: BreakdownResult;
  rangedSpeed: BreakdownResult;
  healingAmp: BreakdownResult;
  negativeHealingAmp: BreakdownResult;
  repairAmp: BreakdownResult;
  ac: BreakdownResult;
  dodge: BreakdownResult;
  prr: BreakdownResult;
  mrr: BreakdownResult;
  spellResistance: BreakdownResult;
  arcaneSpellFailure: BreakdownResult;
  spellDCs: Record<SpellSchool, BreakdownResult>;
  spellPenetration: BreakdownResult;
  casterLevel: BreakdownResult;
  spellPoints: BreakdownResult;
  spellCooldownReduction: BreakdownResult;
  universalSpellPower: BreakdownResult;
  universalSpellCriticalChance: BreakdownResult;
  universalSpellCriticalDamage: BreakdownResult;
  skills: Record<string, BreakdownResult>;
  spellPowers: Record<SpellDamageType, BreakdownResult>;
  spellCriticalChance: Record<SpellDamageType, BreakdownResult>;
  spellCriticalDamage: Record<SpellDamageType, BreakdownResult>;
  /** All spell-like abilities granted by feats / enhancements / items. */
  slas: CollectedSLA[];
  /** Toggleable stances + mantles available to the build. The UI uses this
   *  to render the Stances/Mantles tab. */
  availableStances: AvailableStance[];
  /** Raw bonus pool collected during evaluation — used by consumers
   *  that need a direct read on EffectType totals not bucketed into a
   *  top-level breakdown (e.g. `MetamagicCostEmpower`, `SpellPointCostPercent`). */
  allBonuses: Bonus[];
  /** Stacking rules parsed from BonusTypes.xml. Exposed so consumers that
   *  re-stack filtered subsets of `allBonuses` (e.g. weapon-type-filtered
   *  crit range) can apply the same rules without re-parsing the catalog. */
  stackingRules: StackingRules;
  /** Dynamic weapon-group memberships built up from `AddGroupWeapon`
   *  effects across the build's active enhancements / feats / class
   *  abilities. Map: groupName → Set<weaponType>. Used by
   *  `weaponInGroup` (engine/weaponGroups.ts) to decide which
   *  Weapon*Class effects fire for the equipped weapon. */
  dynamicWeaponGroups: Map<string, Set<string>>;
  diagnostics: {
    unmatchedFeats: string[];
    unmatchedTrees: string[];
    unmatchedEnhancements: string[];
    unmatchedItemBuffs: string[];
    unmatchedSets: string[];
    unmatchedAugments: string[];
    unmatchedFiligrees: string[];
    unmatchedFiligreeSets: string[];
    /** AmountType strings the evaluator skipped, with effect-source counts. */
    unmodeledAmountTypes: Record<string, number>;
    requirementsFailedCount: number;
    totalSourcedEffects: number;
    totalAppliedBonuses: number;
  };
}

interface RunEngineInput {
  build: Build;
  classes: DDOClassData[];
  races: DDORaceData[];
  feats: DDOFeatData[];
  bonusTypes: DDOBonusType[];
  enhancementTrees: EnhancementTreeData[];
  itemBuffs: ItemBuffCatalog;
  setBonuses: DDOSetBonusData[];
  itemSetIndex: Record<string, string>;
  augments: DDOAugmentData[];
  filigrees: DDOFiligreeData[];
  filigreeSetBonuses: DDOFiligreeSetBonus[];
  selfPartyBuffs: DDOOptionalBuff[];
  guildBuffs?: DDOGuildBuff[];
}

const STATS: Stat[] = ['STR','DEX','CON','INT','WIS','CHA'];

export function runEngine(input: RunEngineInput): EngineResult {
  const {
    build, classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex, augments,
    filigrees, filigreeSetBonuses, selfPartyBuffs, guildBuffs,
  } = input;

  // ── Seeds (pre-effect baseline) ────────────────────────────────────
  const engineClasses = classes.map(ddoClassDataToEngineClass);
  const engineRaces = races.map(ddoRaceDataToRace);
  const race =
    engineRaces.find(r => r.id === build.raceId) ??
    engineRaces.find(r => r.name.toLowerCase() === build.raceId.replace(/_/g, ' ')) ??
    engineRaces[0];

  // Score pipeline mirrors useBuild: base → race → tomes → level-ups. The
  // level-up filter is gated on total character level (heroic + epic) so
  // build entries pre-assigned past the current cap (36/40 today) don't fire.
  const seedTotalLevel = build.classes.reduce((s, c) => s + c.levels, 0)
                       + (build.epicLevels ?? 0);
  const effectiveScores = applyLevelUps(
    applyAbilityTomes(
      race ? applyRacialBonuses(build.abilityScores, race) : { ...build.abilityScores },
      build.abilityTomes,
    ),
    build.levelUps,
    seedTotalLevel,
  );

  const seedBab = calculateBAB(build.classes, engineClasses);
  // Class-only seed; CON contribution is added as a synthetic 'Hitpoints'
  // bonus AFTER the CON breakdown is final, so gear/augment/set CON bonuses
  // feed into HP exactly like DDOBuilderV2's BreakdownItemHitpoints does.
  const seedHp = classHitPoints(build.classes, engineClasses, build.epicLevels);
  const seedSaves = calculateSaves(
    build.classes, engineClasses,
    effectiveScores.CON, effectiveScores.DEX, effectiveScores.WIS,
  );

  // ── Effect collection + evaluation ─────────────────────────────────
  // Collect first so we know which feats are granted by enhancements/classes/
  // races; merge those into ctx.feats so <Type>Feat</Type> requirements that
  // gate on granted feat names pass.
  const {
    effects: sourced,
    grantedFeats,
    unmatchedFeats,
    unmatchedTrees,
    unmatchedEnhancements,
    unmatchedItemBuffs,
    unmatchedSets,
    unmatchedAugments,
    unmatchedFiligrees,
    unmatchedFiligreeSets,
  } = collectEffects({
    build, feats, classes, races, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex, augments,
    filigrees, filigreeSetBonuses, selfPartyBuffs, guildBuffs,
  });

  // Pre-pass: build dynamic weapon-group memberships from AddGroupWeapon
  // effects BEFORE main evaluation. Needed because GroupMember/GroupMember2
  // requirement gates (Slice 7) consult these dynamic groups, and a gate that
  // fires earlier in the main loop must see groups added by later sources.
  // The same effects are still skipped in the main loop (see early-return
  // below) to avoid double-processing.
  /** Dynamic weapon-group memberships, fed by AddGroupWeapon effects.
   *  groupName → set of weapon types added to that group. See
   *  `engine/weaponGroups.ts` for usage. */
  const dynamicWeaponGroups = new Map<string, Set<string>>();
  for (const { effect } of sourced) {
    if (!effect.types.includes('AddGroupWeapon')) continue;
    const items = effect.items ?? [];
    const groupName = items[0];
    if (!groupName) continue;
    const set = dynamicWeaponGroups.get(groupName) ?? new Set<string>();
    for (let i = 1; i < items.length; i++) {
      const w = items[i];
      if (w) set.add(w);
    }
    dynamicWeaponGroups.set(groupName, set);
  }

  const activeGearSet = build.gearSets.find(g => g.name === build.activeGearSet)
                     ?? build.gearSets[0];
  const mainHandWeapon = activeGearSet?.items.find(i => i.slot === 'MainHand')?.weapon ?? '';
  const offHandWeapon  = activeGearSet?.items.find(i => i.slot === 'OffHand')?.weapon  ?? '';

  // Auto-stance pass — some stances aren't user-toggled; they activate
  // automatically based on what weapon is wielded. The engine doesn't
  // see "I'm wielding a Longbow → activate FavoredWeapon stance" from
  // the build state, so we synthesize those stances here before ctx is
  // built. Effects gated on `<Stance>FavoredWeapon</Stance>` (Grace of
  // Battle, Knowledge of Battle, Beloved of the Divine, etc.) then pass
  // their requirement check.
  //
  // The check uses `weaponInGroup` which already knows the static weapon
  // → group map plus the dynamic groups built above (deity feats add
  // their weapon to "Favored Weapon"; Inquisitive Divine Inquisition
  // adds crossbows; Warforged Spear of the Mournlands; etc.).
  const autoStances = new Set<string>();
  function checkAutoStance(stance: string, group: string) {
    if (mainHandWeapon && weaponInGroup(mainHandWeapon, group, dynamicWeaponGroups)) {
      autoStances.add(stance);
      return;
    }
    if (offHandWeapon && weaponInGroup(offHandWeapon, group, dynamicWeaponGroups)) {
      autoStances.add(stance);
    }
  }
  checkAutoStance('FavoredWeapon', 'Favored Weapon');
  // "Ranged Combat" — fires whenever a ranged weapon is equipped. The
  // Mechanic tree's "Improved Detection" sneak-attack-die effect gates
  // on this stance, as do several other ranged riders.
  checkAutoStance('Ranged Combat', 'Ranged');

  const ctx = buildBuildContext({
    build, classes,
    effectiveScores: effectiveScores as unknown as Record<string, number>,
    bab: seedBab,
    grantedFeats,
    mainHandWeapon,
    offHandWeapon,
    dynamicWeaponGroups,
    autoStances,
  });

  const allBonuses: Bonus[] = [];
  const unmodeled: Record<string, number> = {};
  let reqFailed = 0;
  /** SLA accumulator — one entry per granting source (no name-deduping). */
  const slas: CollectedSLA[] = [];

  // Effects whose value depends on the final (post-enhancement) ability score
  // are deferred to a second pass after ability breakdowns are computed.
  // Pattern: AType is AbilityMod / HalfAbilityMod / ThirdAbilityMod AND
  // StackSource contains "Snapshot<Ability>" (e.g. "SnapshotWisdom").
  // Example: Clear Your Mind battle trance — WIS mod / 2 flat damage bonus.
  type DeferredEffect = { effect: (typeof sourced)[0]['effect']; source: string; rankCount: number };
  const abilitySnapshotDeferred: DeferredEffect[] = [];
  const ABILITY_SNAP_ATYPES = new Set(['AbilityMod', 'HalfAbilityMod', 'ThirdAbilityMod', 'AbilityValue', 'AbilityTotal']);

  // Stack-source consolidation: effects with `<AType>Stacks</AType>` AND a
  // `<DisplayName>` belong to a stacking group. DDOBuilderV2's convention is
  // that all effects sharing a DisplayName combine into a single source,
  // indexed by the count of contributing effects (1 source → amount[0],
  // 2 sources → amount[1], …). Classic example: Shiradi Champion's "Pierce
  // Deception + Watchful Eye" — Amount=[0, 5], so the feat alone or the
  // enhancement alone gives 0% Doubleshot, but together they give 5%.
  // Without this consolidation we emit each contributor as a separate
  // value=0 bonus, both showing as "Pierce Deception + Watchful Eye" in
  // breakdowns.
  interface StackGroup {
    displayName: string;
    types: string[];
    bonus: string;
    items: string[];
    amount: number[];
    isPercent: boolean;
    isItemEffect: boolean;
    count: number;
    sources: string[];
  }
  const stackGroups = new Map<string, StackGroup>();

  for (const { effect, source, rankCount } of sourced) {
    // AddGroupWeapon effects are processed in the pre-pass above (which
    // populates `dynamicWeaponGroups` before ctx is built so GroupMember
    // gates can see them). Skip them here to avoid double-processing.
    if (effect.types.includes('AddGroupWeapon')) continue;

    const isSLA = effect.types.includes('SpellLikeAbility');
    if (isSLA) {
      // Item[0] = spell name; Item[1] = casting class. Amount layout:
      //   [0] = per-rest charges (0 = unlimited)
      //   [1] = SP cost
      //   [2] = max caster level
      //   [3] = cooldown (seconds)
      // Multi-rank SLAs (e.g. Reconstruct, Acid Blast) use a 4×N table
      // where N = number of ranks. The player's actual `rankCount`
      // selects which 4-slot slice applies. Falls back to slice 0 when
      // the table is single-rank or the player rank is out of range.
      const name = effect.items?.[0] ?? '';
      if (name) {
        const amt    = effect.amount ?? [];
        const ranks  = Math.max(1, Math.floor(amt.length / 4));
        const rank   = Math.min(Math.max(1, rankCount), ranks);
        const base   = (rank - 1) * 4;
        slas.push({
          name,
          castingClass: resolveSLACastingClass(effect.items?.[1] ?? '', source),
          cost:           amt[base + 1] ?? 0,
          maxCasterLevel: amt[base + 2] ?? 0,
          cooldown:       amt[base + 3] ?? 0,
          charges:        amt[base + 0] ?? 0,
          source,
          category: categorizeSLASource(source),
        });
      }
      // Don't fall into evaluateEffect — SLAs use AType=SpellInfo which the
      // numeric evaluator treats as unmodeled and that would inflate the
      // unmodeled-amount-type diagnostic with non-issues.
      continue;
    }

    // Defer ability-snapshot effects — their value depends on the final
    // ability score (after all enhancement/item bonuses), not the seed.
    const at = effect.amountType ?? 'Simple';
    if (ABILITY_SNAP_ATYPES.has(at) && effect.stackSource?.startsWith('Snapshot')) {
      abilitySnapshotDeferred.push({ effect, source, rankCount });
      continue;
    }

    // Stack-source consolidation — see comment near `stackGroups` above.
    if (at === 'Stacks' && effect.displayName && effect.types.length > 0) {
      if (!passesRequirements(effect.requirements, ctx)) {
        reqFailed++;
        continue;
      }
      const items = effect.items?.length ? effect.items : [''];
      const key = JSON.stringify([
        effect.displayName,
        [...effect.types].sort(),
        effect.bonus ?? '',
        [...items].sort(),
        !!effect.isPercent,
        !!effect.isApplyAsItemEffect,
      ]);
      let g = stackGroups.get(key);
      if (!g) {
        g = {
          displayName: effect.displayName,
          types: effect.types,
          bonus: effect.bonus ?? '',
          items,
          amount: effect.amount ?? [],
          isPercent: !!effect.isPercent,
          isItemEffect: !!effect.isApplyAsItemEffect,
          count: 0,
          sources: [],
        };
        stackGroups.set(key, g);
      }
      // Each emission contributes `rankCount` stacks. Multi-rank past-life
      // feats and enhancements with `<Ranks>N</Ranks>` work the same way
      // as N separate single-rank sources — DDOBuilderV2's Amount table is
      // sized for max-stacks-across-all-sources (e.g. EPL FatePoint at 54
      // = 18 distinct EPLs × 3 ranks each).
      g.count += rankCount;
      g.sources.push(source);
      continue;
    }

    const result = evaluateEffect(effect, ctx, source, rankCount);
    if (result.skipped === 'unmodeled-amount-type' && result.unmodeledAmountType) {
      unmodeled[result.unmodeledAmountType] = (unmodeled[result.unmodeledAmountType] ?? 0) + 1;
    } else if (result.skipped === 'requirements-failed') {
      reqFailed++;
    }
    allBonuses.push(...result.bonuses);
  }

  // Emit one bonus per stack group. Value = Amount[count - 1], clamped to
  // the last table entry when more contributors than the table covers.
  // Zero-valued groups still emit so the breakdown reflects partial setups
  // (1 of 2 sources contributing → 0% value, useful for "almost there"
  // diagnostics). Groups with target items fan out (one bonus per item).
  //
  // Label strategy: in DDO terms a stack-source group is ONE bonus (the
  // combined effect of all the contributing pieces). Use the displayName
  // verbatim, with a source-type prefix lifted from the highest-priority
  // contributor (destiny > reaper > heroic enhancement > feat > other) so
  // the breakdown row's left margin still shows where the bonus comes from.
  const prefixPriority = ['[D]', '[R]', '[E]', '[F]', '[PL]', '[A]', '[G]', '[S]', '[FS]', '[B]', '[Guild]'];
  const pickPrefix = (sources: string[]): string => {
    for (const p of prefixPriority) {
      if (sources.some(s => s.startsWith(p + ' '))) return p;
    }
    return '';
  };
  for (const g of stackGroups.values()) {
    const idx = Math.min(Math.max(0, g.count - 1), Math.max(0, g.amount.length - 1));
    const value = g.amount[idx] ?? 0;
    let label: string;
    if (g.sources.length === 1) {
      label = g.sources[0]!;
    } else {
      const prefix = pickPrefix(g.sources);
      label = prefix ? `${prefix} ${g.displayName}` : g.displayName;
    }
    for (const t of g.types) {
      for (const item of g.items) {
        allBonuses.push({
          bonusType: g.bonus,
          value,
          source: label,
          ...(item && { target: item }),
          effectType: t || undefined,
          ...(g.isPercent && { isPercent: true }),
          ...(g.isItemEffect && { isItemEffect: true }),
        });
      }
    }
  }

  slas.sort((a, b) =>
    a.name.localeCompare(b.name) || a.source.localeCompare(b.source));

  // ── Stack into per-stat breakdowns ─────────────────────────────────
  const rules = buildStackingRules(bonusTypes);

  const abilityScores = Object.fromEntries(
    STATS.map(s => [s, breakdownAbilityScore(s, effectiveScores[s], allBonuses, rules)] as const),
  ) as Record<Stat, BreakdownResult>;

  // ── Second pass: ability-snapshot effects ───────────────────────────
  // Now that final ability scores are known, evaluate deferred effects with
  // the post-enhancement scores so e.g. Clear Your Mind correctly uses the
  // full WIS mod rather than the pre-effect seed.
  if (abilitySnapshotDeferred.length > 0) {
    const finalAbilityScores: Record<string, number> = Object.fromEntries(
      STATS.map(s => [s, abilityScores[s].total]),
    );
    const ctx2 = { ...ctx, abilityScores: finalAbilityScores };
    for (const { effect, source, rankCount } of abilitySnapshotDeferred) {
      const result = evaluateEffect(effect, ctx2, source, rankCount);
      if (result.skipped === 'unmodeled-amount-type' && result.unmodeledAmountType) {
        unmodeled[result.unmodeledAmountType] = (unmodeled[result.unmodeledAmountType] ?? 0) + 1;
      } else if (result.skipped === 'requirements-failed') {
        reqFailed++;
      }
      allBonuses.push(...result.bonuses);
    }
  }

  // Synthetic HP bonus from CON-mod × total level. Mirrors DDOBuilderV2's
  // BreakdownItemHitpoints which reads the final CON breakdown total. This
  // has to happen AFTER abilityScores has been computed, so gear/augment/PL
  // CON bonuses (already in allBonuses) feed through.
  {
    const totalLvl = build.classes.reduce((s, c) => s + c.levels, 0) + (build.epicLevels ?? 0);
    const conMod = abilityModifier(abilityScores.CON.total);
    const conHp = conMod * totalLvl;
    if (conHp !== 0) {
      allBonuses.push({
        effectType: 'Hitpoints',
        bonusType: 'Stacking',
        value: conHp,
        source: `Constitution mod (${conMod >= 0 ? '+' : ''}${conMod}) × ${totalLvl} levels`,
      });
    }
  }

  // Combat-Style HP bonus (Heroic Durability description): each style feat
  // (TWF, THF, S&B, SWF, etc.) grants +25% of class HP, capped at 100%.
  // DDOBuilderV2's BreakdownItemHitpoints sums all `HitpointsStyleBonus`
  // effects to count style feats, then `0.25 * min(4, count) * classHP`.
  {
    const styleFeatCount = allBonuses
      .filter(b => b.effectType === 'HitpointsStyleBonus')
      .reduce((s, b) => s + b.value, 0);
    if (styleFeatCount > 0) {
      // Class HP excluding Epic/Legendary: DDOBuilderV2 counts those at
      // half value for the style multiplier (line 81-82 of BreakdownItemHitpoints.cpp).
      const heroicClassHp = classHitPoints(build.classes, engineClasses, 0);
      const epicClassHp = classHitPoints([], engineClasses, build.epicLevels ?? 0);
      const eligibleClassHp = heroicClassHp + Math.floor(epicClassHp / 2);
      const multiplier = 0.25 * Math.min(4, styleFeatCount);
      const styleHp = Math.floor(eligibleClassHp * multiplier);
      if (styleHp > 0) {
        allBonuses.push({
          effectType: 'Hitpoints',
          bonusType: 'Stacking',
          value: styleHp,
          source: `Combat Style (${Math.min(4, styleFeatCount)} style feat${styleFeatCount === 1 ? '' : 's'} × 25% of class HP)`,
        });
      }
    }
  }

  // Fate-points HP bonus: 2 HP per Fate Point at character level 20+.
  // Mirrors DDOBuilderV2's BreakdownItemHitpoints lines 87-105.
  {
    const charLvl = build.classes.reduce((s, c) => s + c.levels, 0) + (build.epicLevels ?? 0);
    if (charLvl >= 20) {
      const fatePoints = allBonuses
        .filter(b => b.effectType === 'FatePoint')
        .reduce((s, b) => s + b.value, 0);
      if (fatePoints > 0) {
        allBonuses.push({
          effectType: 'Hitpoints',
          bonusType: 'Stacking',
          value: 2 * fatePoints,
          source: `Fate Points (×2 HP each, ${fatePoints} fate points)`,
        });
      }
    }
  }

  // Implement-in-your-hands → Universal Spell Power = main-hand minLevel.
  // Shiradi Champion's "Fey Form" selection (and similar effects) tag the
  // main-hand weapon as an Implement, which in DDO grants Universal Spell
  // Power equal to the weapon's minimum level. Trigger: any `ImplementInYourHands`
  // bonus that survived requirements/rank gating.
  {
    const hasImplement = allBonuses.some(b => b.effectType === 'ImplementInYourHands' && b.value > 0);
    if (hasImplement) {
      const activeSet = build.gearSets.find(g => g.name === build.activeGearSet);
      const mainHand = activeSet?.items.find(i => i.slot === 'MainHand');
      const ml = mainHand?.minLevel ?? 0;
      if (ml > 0) {
        allBonuses.push({
          effectType: 'UniversalSpellPower',
          bonusType: 'Enhancement',
          value: ml,
          source: `Implement (${mainHand!.name} ML ${ml})`,
        });
      }
    }
  }

  // Casting-stat mod for the per-school spell DC seed. Each casting class
  // uses its own primary stat (Wizard/AT → Int, Sorcerer/Bard/FvS → Cha,
  // Cleric/Druid/Paladin/Ranger → Wis, Artificer/Alchemist → Int). When
  // the build has multiple casting classes we take the highest mod since
  // the user is most likely to cast with that class's spells.
  //
  // The mod uses the stat's *final* breakdown total (post-effect, including
  // gear bonuses + past-life stacks + ability tomes), not the seed score.
  const STAT_NAMES_LC: Record<string, Stat> = {
    strength: 'STR', dexterity: 'DEX', constitution: 'CON',
    intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA',
  };
  const totalLevel = build.classes.reduce((s, c) => s + c.levels, 0)
                   + (build.epicLevels ?? 0);
  let bestCastingStatMod = 0;
  let primaryCastingClass: string | undefined;
  let primaryCastingClassLevel = 0;
  for (const cl of build.classes) {
    if (cl.levels <= 0) continue;
    // Read the raw catalog DDOClassData (which carries `castingStat`) since
    // the engine-side DDOClass type doesn't include it.
    const cdata = classes.find(c =>
      c.name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_') === cl.classId);
    if (!cdata?.castingStat) continue;
    const stat = STAT_NAMES_LC[cdata.castingStat.toLowerCase()];
    if (!stat) continue;
    const mod = abilityModifier(abilityScores[stat].total);
    if (mod > bestCastingStatMod) bestCastingStatMod = mod;
    // Track the highest-level casting class as the build's primary caster.
    if (cl.levels > primaryCastingClassLevel) {
      primaryCastingClass = cdata.name;
      primaryCastingClassLevel = cl.levels;
    }
  }
  // Build a name set of all classes (heroic + epic/legendary). Used by the
  // caster-level breakdown to ignore class-targeted bonuses for classes the
  // build doesn't actually have.
  const buildClassNames = new Set<string>();
  for (const cl of build.classes) {
    if (cl.levels <= 0) continue;
    const cdata = classes.find(c =>
      c.name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_') === cl.classId);
    if (cdata) buildClassNames.add(cdata.name);
  }

  // ── Spell Points seed ──────────────────────────────────────────────
  // Build per-class seed rows: class table SP + casting-stat bonus.
  //
  // Formula matches DDOBuilderV2 / in-game DDO:
  //   bonus_SP = (class_level + 9) × casting_stat_modifier
  // and only contributes when the class actually grants base SP at this
  // level (table > 0). The earlier `mod × levels × 5` shortcut was
  // ~3× too generous for level-20 casters and ~5× off for half-casters.
  //
  // Effect bonuses with EffectType=SpellPoints stack on top inside
  // breakdownSpellPoints.
  const spSeedBonuses: Bonus[] = [];
  for (const cl of build.classes) {
    if (cl.levels <= 0) continue;
    const cdata = classes.find(c =>
      c.name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_') === cl.classId);
    if (!cdata) continue;
    const tableSp = cdata.spellPointsPerLevel?.[cl.levels] ?? 0;
    if (tableSp <= 0) continue;          // non-caster level / no SP yet → nothing else fires
    spSeedBonuses.push({
      bonusType: '',
      value: tableSp,
      source: `${cdata.name} class table (level ${cl.levels})`,
    });
    if (!cdata.castingStat) continue;
    const stat = STAT_NAMES_LC[cdata.castingStat.toLowerCase()];
    if (!stat) continue;
    const mod = abilityModifier(abilityScores[stat].total);
    if (mod <= 0) continue;
    const bonusSP = (cl.levels + 9) * mod;
    if (bonusSP > 0) {
      spSeedBonuses.push({
        bonusType: '',
        value: bonusSP,
        source: `${cdata.name} ${cdata.castingStat} mod (+${mod}) × (${cl.levels} + 9)`,
      });
    }
  }

  const spellDCs = Object.fromEntries(
    SPELL_SCHOOLS.map(school => [
      school,
      breakdownSpellDC(school, bestCastingStatMod, allBonuses, rules),
    ] as const),
  ) as Record<SpellSchool, BreakdownResult>;

  // ── Per-skill breakdowns ───────────────────────────────────────────
  // Compute every skill's full total: ranks + ability mod (post-effect) +
  // racial + tome + SkillBonus / SkillBonusAbility effects. Surfaced on
  // EngineResult.skills so the Breakdowns UI can show each contributor.
  const raceSkillBonuses = (race?.skillBonuses ?? {}) as Record<string, number>;
  const skillTomes = build.skillTomes ?? {};
  const skillRanks = build.skillRanks ?? {};
  const skills: Record<string, BreakdownResult> = {};
  for (const skill of ALL_SKILLS) {
    const stat = skill.keyAbility as Stat;
    const ranks = skillRanks[skill.id] ?? 0;
    const abilMod = abilityModifier(abilityScores[stat]?.total ?? 10);
    const racialBonus = raceSkillBonuses[skill.id] ?? 0;
    const tomeBonus = skillTomes[skill.id] ?? 0;
    skills[skill.id] = breakdownSkill(
      skill.name, skill.keyAbility,
      ranks, abilMod, racialBonus, tomeBonus,
      skill.trainedOnly ?? false,
      allBonuses, rules,
    );
  }

  // ── Skill → spell power injection ──────────────────────────────────
  // Each point of the relevant skill TOTAL (post-feats/enhancements/effects)
  // adds 1 spell power for the matching element(s):
  //   Spellcraft → Acid/Chaos/Cold/Electric/Evil/Fire/Force/Light/Poison
  //   Perform    → Sonic
  //   Heal       → Positive, Negative
  //   Repair     → Repair
  // Injected as untyped SpellPower bonuses so they always stack with other
  // contributors. Uses the full per-skill BreakdownResult total computed
  // above, matching what the in-game character sheet shows.
  const SKILL_SPELL_POWER: Array<{
    skillId: string; name: string; elements: SpellDamageType[];
  }> = [
    { skillId: 'spellcraft', name: 'Spellcraft',
      elements: ['Acid','Chaos','Cold','Electric','Evil','Fire','Force','Light/Alignment','Poison'] },
    { skillId: 'perform',    name: 'Perform',    elements: ['Sonic'] },
    { skillId: 'heal',       name: 'Heal',       elements: ['Positive','Negative'] },
    { skillId: 'repair',     name: 'Repair',     elements: ['Repair'] },
  ];
  for (const sk of SKILL_SPELL_POWER) {
    const total = skills[sk.skillId]?.total ?? 0;
    if (total <= 0) continue;
    const sourceLabel = `[Skill] ${sk.name} (total ${total})`;
    for (const element of sk.elements) {
      allBonuses.push({
        effectType: 'SpellPower',
        bonusType: '',
        value: total,
        source: sourceLabel,
        target: element,
      });
    }
  }

  const spellPowers = Object.fromEntries(
    SPELL_DAMAGE_TYPES.map(t => [t, breakdownSpellPower(t, allBonuses, rules)] as const),
  ) as Record<SpellDamageType, BreakdownResult>;
  const spellCriticalChance = Object.fromEntries(
    SPELL_DAMAGE_TYPES.map(t => [t, breakdownSpellCriticalChance(t, allBonuses, rules)] as const),
  ) as Record<SpellDamageType, BreakdownResult>;
  const spellCriticalDamage = Object.fromEntries(
    SPELL_DAMAGE_TYPES.map(t => [t, breakdownSpellCriticalDamage(t, allBonuses, rules)] as const),
  ) as Record<SpellDamageType, BreakdownResult>;

  const result: EngineResult = {
    abilityScores,
    hitPoints: breakdownHitPoints(seedHp, allBonuses, rules),
    saves: {
      Fortitude: breakdownSave('Fortitude', seedSaves.fortitude, allBonuses, rules),
      Reflex:    breakdownSave('Reflex',    seedSaves.reflex,    allBonuses, rules),
      Will:      breakdownSave('Will',      seedSaves.will,      allBonuses, rules),
    },
    meleePower:        breakdownMeleePower(allBonuses, rules),
    rangedPower:       breakdownRangedPower(allBonuses, rules),
    doublestrike:      breakdownDoublestrike(allBonuses, rules),
    doubleshot:        breakdownDoubleshot(allBonuses, rules),
    sneakAttackDice:   breakdownSneakAttackDice(allBonuses, rules),
    offHandChance:     breakdownOffHandChance(allBonuses, rules),
    weaponBaseDamage:  breakdownWeaponBaseDamage(allBonuses, rules),
    weaponFlatDamage:  breakdownWeaponFlatDamage(allBonuses, rules),
    weaponDamagePct:   breakdownWeaponDamagePct(allBonuses, rules),
    shieldBashRate:    breakdownShieldBashRate(allBonuses, rules),
    weaponCritRange:   breakdownWeaponCritRange(allBonuses, rules),
    weaponCritMult:    breakdownWeaponCritMult(allBonuses, rules),
    weaponCritMult1920: breakdownWeaponCritMult1920(allBonuses, rules),
    seeker:            breakdownSeeker(allBonuses, rules),
    imbueDice:         breakdownImbueDice(allBonuses, rules),
    meleeSpeed:        breakdownMeleeSpeed(allBonuses, rules),
    rangedSpeed:       breakdownRangedSpeed(allBonuses, rules),
    healingAmp:        breakdownHealingAmp(allBonuses, rules),
    negativeHealingAmp: breakdownNegativeHealingAmp(allBonuses, rules),
    repairAmp:         breakdownRepairAmp(allBonuses, rules),
    ac:                breakdownAC(allBonuses, rules),
    dodge:             breakdownDodge(allBonuses, rules),
    prr:               breakdownPRR(allBonuses, rules),
    mrr:               breakdownMRR(allBonuses, rules),
    spellResistance:   breakdownSpellResistance(allBonuses, rules),
    arcaneSpellFailure: breakdownArcaneSpellFailure(allBonuses, rules),
    spellDCs,
    spellPenetration:  breakdownSpellPenetration(allBonuses, rules),
    casterLevel:       breakdownCasterLevel(
      primaryCastingClass,
      primaryCastingClassLevel,
      totalLevel,
      buildClassNames,
      allBonuses,
      rules,
    ),
    spellPoints:       breakdownSpellPoints(spSeedBonuses, allBonuses, rules),
    spellCooldownReduction: breakdownSpellCooldownReduction(allBonuses, rules),
    universalSpellPower: breakdownUniversalSpellPower(allBonuses, rules),
    universalSpellCriticalChance: breakdownUniversalSpellCriticalChance(allBonuses, rules),
    universalSpellCriticalDamage: breakdownUniversalSpellCriticalDamage(allBonuses, rules),
    skills,
    spellPowers, spellCriticalChance, spellCriticalDamage,
    slas,
    availableStances: collectAvailableStances({
      build, feats, classes, enhancementTrees,
    }),
    // Raw bonus pool — exposed for domain-specific consumers (spell SP
    // cost, fate-point bonus, etc.) that route effect types we don't
    // bucket into a top-level breakdown.
    allBonuses,
    stackingRules: rules,
    dynamicWeaponGroups,
    diagnostics: {
      unmatchedFeats: [...new Set(unmatchedFeats)].sort(),
      unmatchedTrees: unmatchedTrees.sort(),
      unmatchedEnhancements: unmatchedEnhancements.sort(),
      unmatchedItemBuffs: unmatchedItemBuffs,
      unmatchedSets: unmatchedSets,
      unmatchedAugments: unmatchedAugments,
      unmatchedFiligrees: unmatchedFiligrees,
      unmatchedFiligreeSets: unmatchedFiligreeSets,
      unmodeledAmountTypes: unmodeled,
      requirementsFailedCount: reqFailed,
      totalSourcedEffects: sourced.length,
      totalAppliedBonuses: allBonuses.length,
    },
  };

  return result;
}
