// Melee DPS calculator — Phase 6.7
//
// Computes auto-attack DPS for melee builds from a weapon + build-stats
// snapshot. Phase 1 covers main-hand + off-hand auto-attacks with
// Doublestrike and Seeker. Ki strikes, on-hit procs, and sneak attack
// are deferred to Phase 2.

import type { Build, GearItem } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import { abilityModifier } from '@/engine';
import { stackBonuses } from '@/engine/bonusStacking';
import { weaponInGroup } from '@/engine/weaponGroups';
import type { Stat } from '@/types/build';

export type WeaponCategory = 'handwraps' | 'one-handed' | 'two-handed';
export type TWFStyle = 'none' | 'twf' | 'itwf' | 'gtwf';

export interface MeleeWeaponInfo {
  name: string;
  /** Raw DDO weapon type from the item catalog (e.g. "Handwraps",
   *  "Quarterstaff", "Longsword"). Used to filter weapon-type-gated
   *  effects like Swords to Plowshares crit range bonuses, which
   *  emit separate entries for each eligible weapon type. */
  weaponType: string;
  category: WeaponCategory;
  /** Weapon W multiplier from `<WeaponDamage>` in the item data (e.g. 5.6
   *  for high-level handwraps). Scales the base dice: avgDice × wScalar. */
  wScalar: number;
  diceNum: number;
  diceSides: number;
  diceBonus: number;
  enchantBonus: number;
  /** Raw d20 faces that threaten a crit before feat doubling (1 = 20-only). */
  critThreatBase: number;
  critMultiplier: number;
  attackStat: 'Strength' | 'Dexterity';
}

export interface MeleeBuildStats {
  statMod: number;
  damageStat: Stat;          // which ability contributes to melee damage
  meleePower: number;
  doublestrike: number;      // %
  meleeAlacrity: number;       // %, passive (capped at 15 in meleeDPS)
  /** Time-averaged Action Boost alacrity from activated abilities in the
   *  rotation (e.g. Haste Boost uptime × 30%).  Multiplies with passive
   *  alacrity — not subject to the 15% passive cap. */
  actionBoostAlacrity: number; // %, no cap (multiplicative)
  /** Pre-alacrity base APM. Default seeds from `meleeBaseAPM(category)`;
   *  the editor's Base APM slider may replace this with a tuned value. */
  baseAPM: number;
  seeker: number;
  hasImprovedCritical: boolean;
  /** Flat faces added to threat range after IC doubling. */
  critRangeBonus: number;
  /** Flat bonus to critical multiplier on every crit. */
  critMultBonus: number;
  /** Flat bonus to critical multiplier on 19–20 rolls only. */
  critMult1920Bonus: number;
  /** Additional [W] dice per hit from enhancements / destinies
   *  (e.g. Legendary Dreadnought Dread Mantle +1[W]). */
  wBonus: number;
  /** Flat per-hit damage bonus from Deadly / Insightful Deadly / etc. */
  flatDmgBonus: number;
  /** Percentage physical damage bonus (e.g. Primal Force +2% Epic Damage).
   *  Applied as a separate multiplier on top of Melee Power: ×(1 + pct/100). */
  physDamagePct: number;
  twfStyle: TWFStyle;
  offHandChance: number;     // % (all sources, capped at 100)
  isHandwraps: boolean;
  hasPerfectTWF: boolean;    // raises OH DS fraction from 50% → 65%
}

export interface MeleeDPSResult {
  avgBaseDamage: number;
  avgScaledDamage: number;
  avgPerHit: number;
  /** Total threat faces (after IC + range bonuses). */
  critThreatFaces: number;
  /** Overall crit chance = critThreatFaces / 20. */
  critChance: number;
  /** Crit mult on all crits (base + critMultBonus). */
  critMultOnAll: number;
  /** Crit mult on 19-20 rolls (critMultOnAll + critMult1920Bonus). */
  critMultOn1920: number;
  /** The 19-20-only crit mult bonus (from Overwhelming Critical etc.).
   *  Non-zero means 19-20 crits deal more than lower crit faces. */
  critMult1920Bonus: number;
  /** Weapon W multiplier (from item data). */
  wScalar: number;
  /** Additional [W] bonus from enhancements / destinies. */
  wBonus: number;
  /** Total W = wScalar + wBonus. */
  totalW: number;
  /** Flat per-hit damage bonus (Deadly etc.) before Melee Power scaling. */
  flatDmgBonus: number;
  /** Percentage physical damage bonus (e.g. +2% Epic from Primal Force). */
  physDamagePct: number;
  seeker: number;
  damageStat: Stat;
  damageStatMod: number;
  mhAttacksPerMin: number;
  ohAttacksPerMin: number;
  effectiveMHPerMin: number;
  effectiveOHPerMin: number;
  totalEffectivePerMin: number;
  mhDPS: number;
  ohDPS: number;
  totalAutoDPS: number;
  meleePower: number;
  doublestrike: number;
  doublestrikeOH: number;
  ohDSFraction: number;
  meleeAlacrity: number;
  actionBoostAlacrity: number;
  /** APM at passive alacrity only, no action-boost contribution.
   *  Used by the timeline to generate burst attack patterns. */
  mhBaseAPM: number;
  ohBaseAPM: number;
}

// ── Weapon category ──────────────────────────────────────────────────

const TWO_HANDED_KEYWORDS = [
  'greatsword', 'greataxe', 'great crossbow', 'falchion',
  'maul', 'quarterstaff', 'two-handed', 'two handed',
  'bastard sword',  // can be 2H wielded
];

export function weaponCategoryFromName(weaponName: string): WeaponCategory {
  const lower = weaponName.toLowerCase();
  if (lower === 'handwraps') return 'handwraps';
  if (TWO_HANDED_KEYWORDS.some(k => lower.includes(k))) return 'two-handed';
  return 'one-handed';
}

// ── Attack rates ──────────────────────────────────────────────────────
//
// Baseline measured in-game for a BAB 20+ character.
// Handwraps: slightly faster than standard one-handed.
// Two-handed: slightly slower.
// Alacrity cap = 15% (user-visible slider cap).

export function meleeBaseAPM(category: WeaponCategory): number {
  switch (category) {
    case 'handwraps':  return 110;
    case 'two-handed': return 90;
    default:           return 100;
  }
}

export function meleeAttacksPerMin(category: WeaponCategory, alacrityPct: number): number {
  return meleeBaseAPM(category) * (1 + Math.min(Math.max(0, alacrityPct), 15) / 100);
}

// ── TWF helpers ──────────────────────────────────────────────────────

export function twfOffHandChancePct(style: TWFStyle): number {
  switch (style) {
    case 'gtwf': return 80;
    case 'itwf': return 60;
    case 'twf':  return 40;
    default:     return 0;
  }
}

/** Base off-hand chance before any feat / enhancement bonuses.
 *  Two-handed weapons cannot produce off-hand attacks at all.
 *  One-handed weapons and handwraps have a 20% inherent base. */
export function baseOffHandChancePct(category: WeaponCategory): number {
  return category === 'two-handed' ? 0 : 20;
}

export function detectTWFStyle(build: Build): TWFStyle {
  const ids = new Set([
    ...build.feats.map(f => f.featId),
    ...(build.specialFeats ?? []).map(f => f.featId),
  ]);
  if (ids.has('Greater Two Weapon Fighting')) return 'gtwf';
  if (ids.has('Improved Two Weapon Fighting')) return 'itwf';
  if (ids.has('Two Weapon Fighting'))          return 'twf';
  return 'none';
}

export function detectImprovedCritical(build: Build): boolean {
  return build.feats.some(f => f.featId.startsWith('Improved Critical:'));
}

export function detectPerfectTWF(build: Build): boolean {
  return build.feats.some(f => f.featId === 'Perfect Two Weapon Fighting');
}

// ── Core DPS formula ─────────────────────────────────────────────────

export function meleeDPS(
  weapon: MeleeWeaponInfo,
  stats: MeleeBuildStats,
): MeleeDPSResult {
  // ── Per-hit damage ──────────────────────────────────────────────
  // W multiplier: item wScalar (e.g. 5.6) + enhancement bonus W.
  // Only the dice portion scales by W; the flat diceBonus does not.
  const totalW   = weapon.wScalar + stats.wBonus;
  const avgDice  = weapon.diceNum * totalW * (weapon.diceSides + 1) / 2;
  // Flat per-hit bonus: diceBonus (from dice notation), stat mod, enchant,
  // and Deadly-style flat damage.  All added before Melee Power scaling.
  const avgBase  = avgDice + weapon.diceBonus + stats.statMod + weapon.enchantBonus + stats.flatDmgBonus;
  const scaled   = avgBase * (1 + stats.meleePower / 100) * (1 + stats.physDamagePct / 100);

  // ── Crit threat range ───────────────────────────────────────────
  // IC doubles the base, then flat bonuses add on top.
  const rangeAfterIC   = stats.hasImprovedCritical
    ? weapon.critThreatBase * 2
    : weapon.critThreatBase;
  const totalFaces     = rangeAfterIC + stats.critRangeBonus;
  const critChance     = totalFaces / 20;

  // ── Split crit multipliers ──────────────────────────────────────
  // Bonuses from OC / Pulverizer / Blunt Trauma only apply on 19-20
  // rolls, not on lower crit faces (e.g. 18 from crit range expansion).
  const multOnAll   = weapon.critMultiplier + stats.critMultBonus;
  const multOn1920  = multOnAll + stats.critMult1920Bonus;

  // Faces that roll 19-20 vs all other crit faces.
  const faces1920   = Math.min(2, totalFaces);
  const facesOther  = Math.max(0, totalFaces - 2);

  // Weighted average per hit across all outcomes:
  //   non-crit:  scaled damage only
  //   crit ≤18:  (scaled + seeker) × multOnAll
  //   crit 19-20: (scaled + seeker) × multOn1920
  const avgPerHit = (1 - critChance) * scaled
    + (facesOther / 20) * (scaled + stats.seeker) * multOnAll
    + (faces1920  / 20) * (scaled + stats.seeker) * multOn1920;

  // ── Attack rates ─────────────────────────────────────────────────
  // Passive alacrity (Haste bonus type) caps at 15%.
  // Action Boost alacrity multiplies on top — no shared cap.
  const alacrity      = Math.min(Math.max(0, stats.meleeAlacrity), 15);
  const boostAlacrity = Math.max(0, stats.actionBoostAlacrity ?? 0);
  const baseAPM       = stats.baseAPM > 0 ? stats.baseAPM : meleeBaseAPM(weapon.category);
  // mhNoBoostAPM: the passive-only rate used by the timeline for burst visualization.
  const mhNoBoostAPM  = baseAPM * (1 + alacrity / 100);
  const mhAPM         = mhNoBoostAPM * (1 + boostAlacrity / 100);
  const ohFrac    = Math.min(1.0, stats.offHandChance / 100);
  const ohAPM     = mhAPM * ohFrac;

  // ── Doublestrike ─────────────────────────────────────────────────
  // Applies to all melee attacks (confirmed).
  // OH DS fraction: 100% for handwraps, 65% for PTWF, 50% standard.
  const dsMH       = stats.doublestrike / 100;
  const ohDSFraction = stats.isHandwraps
    ? 1.00
    : stats.hasPerfectTWF ? 0.65 : 0.50;
  const dsOH       = dsMH * ohDSFraction;

  const effectiveMH    = mhAPM * (1 + dsMH);
  const effectiveOH    = ohAPM * (1 + dsOH);
  const totalEffective = effectiveMH + effectiveOH;

  const mhDPS = effectiveMH * avgPerHit / 60;
  const ohDPS = effectiveOH * avgPerHit / 60;

  return {
    avgBaseDamage:        avgBase,
    avgScaledDamage:      scaled,
    avgPerHit,
    critThreatFaces:      totalFaces,
    critChance,
    critMultOnAll:        multOnAll,
    critMultOn1920:       multOn1920,
    critMult1920Bonus:    stats.critMult1920Bonus,
    wScalar:              weapon.wScalar,
    wBonus:               stats.wBonus,
    totalW,
    flatDmgBonus:         stats.flatDmgBonus,
    physDamagePct:        stats.physDamagePct,
    seeker:               stats.seeker,
    damageStat:           stats.damageStat,
    damageStatMod:        stats.statMod,
    mhAttacksPerMin:      mhAPM,
    ohAttacksPerMin:      ohAPM,
    effectiveMHPerMin:    effectiveMH,
    effectiveOHPerMin:    effectiveOH,
    totalEffectivePerMin: totalEffective,
    mhDPS,
    ohDPS,
    totalAutoDPS:         mhDPS + ohDPS,
    meleePower:           stats.meleePower,
    doublestrike:         stats.doublestrike,
    doublestrikeOH:       dsOH * 100,
    ohDSFraction,
    meleeAlacrity:        alacrity,
    actionBoostAlacrity:  boostAlacrity,
    mhBaseAPM:            mhNoBoostAPM,
    ohBaseAPM:            mhNoBoostAPM * ohFrac,
  };
}

// ── Build-data extractors ────────────────────────────────────────────

/** Default base dice for shield types (no baseDice in item catalog).
 *  Matches DDO wiki values: buckler 1d4, small/large shield 1d6, tower 1d8. */
const SHIELD_BASE_DICE: Record<string, { number: number; sides: number }> = {
  'Buckler':      { number: 1, sides: 4 },
  'Small Shield': { number: 1, sides: 6 },
  'Large Shield': { number: 1, sides: 6 },
  'Tower Shield': { number: 1, sides: 8 },
};

/** Returns true for weapon types that use shield-bash attack rates
 *  rather than TWF off-hand rates. */
export function isShieldType(weaponType: string): boolean {
  return weaponType in SHIELD_BASE_DICE;
}

/** Build a MeleeWeaponInfo from a GearItem. Returns null when the item
 *  has no weapon fields. Shields fall back to type-based default dice
 *  (their baseDice is absent from the item catalog). */
export function weaponInfoFromGearItem(item: GearItem): MeleeWeaponInfo | null {
  if (!item.weapon) return null;
  const dice = item.baseDice ?? SHIELD_BASE_DICE[item.weapon];
  if (!dice) return null;
  const enchantBuff = item.buffs.find(b => b.type === 'WeaponEnchantment');
  return {
    name:           item.name,
    weaponType:     item.weapon ?? '',
    category:       weaponCategoryFromName(item.weapon),
    wScalar:        item.weaponDamage ?? 1,
    diceNum:        dice.number,
    diceSides:      dice.sides,
    diceBonus:      item.baseDice?.bonus ?? 0,
    enchantBonus:   enchantBuff?.value1 ?? 0,
    critThreatBase: item.criticalThreatRange ?? 1,
    critMultiplier: item.criticalMultiplier  ?? 2,
    attackStat:     item.attackModifier?.toLowerCase().includes('dex')
                      ? 'Dexterity'
                      : 'Strength',
  };
}

/**
 * Compute the Weapon_CriticalRange bonus for a specific weapon type.
 *
 * Effects like Swords to Plowshares emit one bonus entry per eligible
 * weapon type (Handwraps +1, Kama +1, Sickle +1, Quarterstaff +2) so
 * the caller can target any of them. The standard `weaponCritRange`
 * breakdown sums all entries, overcounting when the build has multiple
 * weapon-type entries for the same feat. This helper filters to only
 * bonuses whose `target` matches the equipped weapon type (or 'All' /
 * untargeted), then re-stacks with the full rules so Highest-Only types
 * (e.g. Competence from Shintao Mastery) are still deduplicated.
 */
export function critRangeBonusForWeapon(engine: EngineResult, weaponType: string): number {
  const wt = weaponType.toLowerCase();
  const relevant = engine.allBonuses.filter(b =>
    b.effectType === 'Weapon_CriticalRange' &&
    (!b.target || b.target === 'All' || b.target.toLowerCase() === wt),
  );
  return stackBonuses(relevant, engine.stackingRules).total;
}

/**
 * Resolve `Weapon*Class` bonuses (class-restricted weapon bonuses that
 * fire only when wielding a weapon in a specific group) into per-stat
 * augmentations for the equipped weapon. Group membership combines the
 * static weapon-type registry (`engine/weaponGroups.ts`) with dynamic
 * groups built from `AddGroupWeapon` effects.
 *
 * Returns a struct of augmentations to ADD on top of the standard
 * (non-class-restricted) breakdowns. The to-hit family
 * (`WeaponAttackBonusClass`, `WeaponAttackBonusCriticalClass`) is
 * intentionally omitted — the DPS engine doesn't model AC.
 */
export function weaponClassBonusesForWeapon(
  engine: EngineResult,
  weaponType: string,
): {
  flatDamage: number;
  critRange: number;
  critMult: number;
  critDamageRider: number;
  enchantment: number;
} {
  const dyn = engine.dynamicWeaponGroups;
  const matches = (b: { target?: string }) =>
    !!b.target && weaponInGroup(weaponType, b.target, dyn);

  const stackByType = (type: string, predicate = matches): number =>
    stackBonuses(
      engine.allBonuses.filter(b => b.effectType === type && predicate(b)),
      engine.stackingRules,
    ).total;

  return {
    // Flat per-hit damage from class-restricted enhancements (Ravager
    // Power Rush "+1/2/3 damage with Two-Handed weapons", etc.).
    flatDamage:      stackByType('WeaponDamageBonusClass'),
    // Extra crit-range faces when the wielded weapon matches.
    critRange:       stackByType('WeaponCriticalRangeClass'),
    // Crit-mult bonus on every crit when the wielded weapon matches.
    critMult:        stackByType('WeaponCriticalMultiplierClass'),
    // Bonus damage on crit only (treat as Seeker-style add).
    critDamageRider: stackByType('WeaponDamageBonusCriticalClass'),
    // Effect-driven enchantment bonus (e.g. Kensei Strike with Conviction).
    enchantment:     stackByType('Weapon_EnchantmentClass'),
  };
}

/** Derive MeleeBuildStats from the engine result + build. Pass an
 *  optional `alacrityOverride` (0-15) from the panel slider and an
 *  optional `actionBoostAlacrity` from active rotation boosts. */
export function buildStatsFromEngine(
  build: Build,
  engine: EngineResult,
  weaponInfo: MeleeWeaponInfo,
  alacrityOverride?: number,
  actionBoostAlacrity = 0,
  /** Optional manual stat pick from the editor's damage-stat dropdown.
   *  When 'auto' (default), the function picks the highest-mod stat. */
  damageStatOverride: Stat | 'auto' = 'auto',
  /** Optional Base APM override from the editor's slider. Undefined =
   *  `meleeBaseAPM(weapon.category)` default. */
  baseAPMOverride?: number,
): MeleeBuildStats {
  // ── Effective damage stat ─────────────────────────────────────────
  // Weapon_DamageAbility bonuses replace the weapon's own damage stat.
  // If multiple sources grant different replacements, use the one with
  // the highest modifier (e.g. WIS +43 beats STR +5 for a monk build).
  const STAT_MAP: Record<string, Stat> = {
    strength: 'STR', dexterity: 'DEX', constitution: 'CON',
    intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA',
  };
  let damageStat: Stat;
  let statMod: number;
  if (damageStatOverride !== 'auto') {
    damageStat = damageStatOverride;
    statMod    = abilityModifier(engine.abilityScores[damageStat].total);
  } else {
    damageStat = weaponInfo.attackStat === 'Dexterity' ? 'DEX' : 'STR';
    let bestMod = abilityModifier(engine.abilityScores[damageStat].total);
    for (const b of engine.allBonuses) {
      if (b.effectType !== 'Weapon_DamageAbility') continue;
      const tgt = (b.target ?? '').toLowerCase();
      const candidate = STAT_MAP[tgt] as Stat | undefined;
      if (!candidate) continue;
      const mod = abilityModifier(engine.abilityScores[candidate].total);
      if (mod > bestMod) { bestMod = mod; damageStat = candidate; }
    }
    statMod = bestMod;
  }

  const twfStyle = detectTWFStyle(build);
  const ohBonus  = weaponInfo.category === 'two-handed' ? 0 : engine.offHandChance.total;
  const ohChance = Math.min(100, ohBonus);
  const alacrity = alacrityOverride ?? engine.meleeSpeed.total;

  // Class-restricted weapon bonuses (`Weapon*Class` family). Only fire
  // when the equipped weapon is in the named group — see
  // engine/weaponGroups.ts.
  const klass = weaponClassBonusesForWeapon(engine, weaponInfo.weaponType);

  const baseAPM = baseAPMOverride !== undefined && baseAPMOverride > 0
    ? baseAPMOverride
    : meleeBaseAPM(weaponInfo.category);

  return {
    statMod,
    damageStat,
    meleePower:          engine.meleePower.total,
    doublestrike:        engine.doublestrike.total,
    meleeAlacrity:       alacrity,
    baseAPM,
    seeker:              engine.seeker.total + klass.critDamageRider,
    hasImprovedCritical: detectImprovedCritical(build),
    critRangeBonus:      critRangeBonusForWeapon(engine, weaponInfo.weaponType) + klass.critRange,
    critMultBonus:       engine.weaponCritMult.total + klass.critMult,
    critMult1920Bonus:   engine.weaponCritMult1920.total,
    wBonus:              engine.weaponBaseDamage.total,
    // Class-restricted enchantment is a flat per-hit damage rider
    // (matches DDO's treatment — enchantment +N adds N flat damage).
    flatDmgBonus:        engine.weaponFlatDamage.total + klass.flatDamage + klass.enchantment,
    physDamagePct:       engine.weaponDamagePct.total,
    twfStyle,
    offHandChance:       ohChance,
    isHandwraps:         weaponInfo.category === 'handwraps',
    hasPerfectTWF:       detectPerfectTWF(build),
    actionBoostAlacrity: Math.max(0, actionBoostAlacrity),
  };
}

/**
 * Effective weapon-hit multiplier for one activation of a melee ability.
 *
 * All activated melee abilities trigger an off-hand swing in addition to
 * their MH hit(s). Doublestrike applies to every hit.
 *
 *   effectiveHits = mhHits × (1 + DS_MH) + 1 × (1 + DS_OH)
 *
 * Use this to scale placeholder-damage melee SLA damage once the dice
 * rolls are filled in.
 *
 * @param mhHits  Number of main-hand weapon hits the ability delivers
 *                (e.g. 2 for Quick Cutter's "Cleave Attack: 2 weapon damage").
 * @param stats   Build stats from `buildStatsFromEngine`.
 */
export function meleeAbilityEffectiveHits(mhHits: number, stats: MeleeBuildStats): number {
  const dsMH = stats.doublestrike / 100;
  const ohDSFraction = stats.isHandwraps ? 1.00 : stats.hasPerfectTWF ? 0.65 : 0.50;
  const dsOH = dsMH * ohDSFraction;
  const ohFrac = Math.min(1.0, stats.offHandChance / 100);
  // OH hit count matches MH hit count — a 2-hit attack gets 2 OH swings too.
  return mhHits * ((1 + dsMH) + ohFrac * (1 + dsOH));
}

/**
 * Average per-hit damage for a melee ability that modifies the weapon's crit
 * threat range. Recomputes the crit-weighted average using the weapon's base
 * scaled damage and the extended crit profile, then applies `scalar`.
 *
 * The scalar multiplies the full per-hit result (including crit weighting),
 * matching how "+N% weapon damage" works in DDO.
 */
function meleeAbilityAvgPerHit(
  result: MeleeDPSResult,
  scalar: number,
  extraCritFaces: number,
  extraCritMult: number,
): number {
  // Cap at 20 so +100 crit range (Legendary Rally) maps to 100% crit, not
  // 520%. Of the 20 d20 faces, 2 are always 19-20 (higher-mult tier).
  const cappedFaces = Math.min(20, result.critThreatFaces + extraCritFaces);
  const critChance  = cappedFaces / 20;
  const faces1920   = Math.min(2, cappedFaces);
  const facesOther  = Math.max(0, cappedFaces - 2);
  const s = result.avgScaledDamage;
  const multAll  = result.critMultOnAll  + extraCritMult;
  const mult1920 = result.critMultOn1920 + extraCritMult;
  const avgPerHit = (1 - critChance) * s
    + (facesOther / 20) * (s + result.seeker) * multAll
    + (faces1920  / 20) * (s + result.seeker) * mult1920;
  return avgPerHit * scalar;
}

/**
 * Damage per activation for a melee weapon-attack ability.
 *
 * Accounts for the ability's own crit range bonus (e.g. Quick Cutter +3
 * at rank 3) so its hits use the extended crit profile, not the auto-attack
 * profile. The scalar then multiplies the full crit-weighted per-hit.
 *
 * Each activation delivers `mhHits` MH strikes + one OH swing, both with
 * doublestrike applied.
 */
export function meleeAbilityDamagePerActivation(
  mhHits: number,
  scalar: number,
  meleeResult: MeleeDPSResult,
  stats: MeleeBuildStats,
  extraCritFaces = 0,
  extraCritMult  = 0,
  dsBuffPct      = 0,
  dsBuffDuration = 0,
): number {
  const perHit = (extraCritFaces === 0 && extraCritMult === 0)
    ? meleeResult.avgPerHit * scalar
    : meleeAbilityAvgPerHit(meleeResult, scalar, extraCritFaces, extraCritMult);
  const hitDamage = meleeAbilityEffectiveHits(mhHits, stats) * perHit;

  // DS buff contribution: extra auto-attack effective hits during buff uptime.
  // Each base MH/OH attack gets dsBuffPct% extra chance to double-strike.
  let buffDamage = 0;
  if (dsBuffPct > 0 && dsBuffDuration > 0) {
    const extraEffAPM = (dsBuffPct / 100)
      * (meleeResult.mhAttacksPerMin + meleeResult.ohAttacksPerMin);
    buffDamage = (extraEffAPM / 60) * meleeResult.avgPerHit * dsBuffDuration;
  }

  return hitDamage + buffDamage;
}

// ── Shield bash ──────────────────────────────────────────────────────────────

export interface ShieldBashResult {
  /** Raw bash attempts per minute before the 60/min cap. */
  rawBashesPerMin: number;
  /** Effective bashes per minute after the 1/s cap. */
  bashesPerMin: number;
  /** Average damage per bash (scaled by MP and physDamagePct, with crits). */
  avgDmgPerBash: number;
  /** Shield DPS contribution. */
  bashDPS: number;
  /** Crit threat faces for the shield. */
  shieldCritFaces: number;
  /** Crit chance for the shield. */
  shieldCritChance: number;
  /** Crit multiplier used on all shield crits. */
  shieldCritMult: number;
}

/**
 * Shield bash DPS contribution.
 *
 * Each MH attack has `secondaryBashPct`% chance to trigger a shield bash
 * (capped at 60 per minute = 1/s). The bash deals the shield's weapon
 * damage scaled by Melee Power and physDamagePct; Doublestrike applies
 * identically to regular MH attacks.
 *
 * Crit range bonus sources that target 'All' (e.g. Shintao Mastery) apply
 * to shields too; the caller should pass the filtered bonus separately, or
 * pass 0 to use only the shield's intrinsic crit range.
 */
export function shieldBashDPS(
  shield: MeleeWeaponInfo,
  secondaryBashPct: number,
  stats: MeleeBuildStats,
  meleeResult: MeleeDPSResult,
  extraCritFaces = 0,
): ShieldBashResult {
  // ── Bash rate ──────────────────────────────────────────────────────
  const rawBashesPerMin = meleeResult.mhAttacksPerMin * secondaryBashPct / 100;
  const bashesPerMin    = Math.min(60, rawBashesPerMin);

  // ── Shield per-hit damage ─────────────────────────────────────────
  const avgDice    = shield.diceNum * shield.wScalar * (shield.diceSides + 1) / 2;
  const avgBase    = avgDice + shield.diceBonus + stats.statMod + shield.enchantBonus + stats.flatDmgBonus;
  const scaled     = avgBase * (1 + stats.meleePower / 100) * (1 + stats.physDamagePct / 100);

  // ── Shield crit profile ───────────────────────────────────────────
  const rangeAfterIC   = stats.hasImprovedCritical ? shield.critThreatBase * 2 : shield.critThreatBase;
  const cappedFaces    = Math.min(20, rangeAfterIC + extraCritFaces);
  const critChance     = cappedFaces / 20;
  const faces1920      = Math.min(2, cappedFaces);
  const facesOther     = Math.max(0, cappedFaces - 2);
  const multOnAll      = shield.critMultiplier + stats.critMultBonus;
  const multOn1920     = multOnAll + stats.critMult1920Bonus;

  const avgPerBash = (1 - critChance) * scaled
    + (facesOther / 20) * (scaled + stats.seeker) * multOnAll
    + (faces1920  / 20) * (scaled + stats.seeker) * multOn1920;

  // ── Doublestrike on bashes ────────────────────────────────────────
  const effectiveBashesPerMin = bashesPerMin * (1 + stats.doublestrike / 100);

  return {
    rawBashesPerMin,
    bashesPerMin,
    avgDmgPerBash:    avgPerBash,
    bashDPS:          effectiveBashesPerMin * avgPerBash / 60,
    shieldCritFaces:  cappedFaces,
    shieldCritChance: critChance,
    shieldCritMult:   multOnAll,
  };
}
