// Per-stat breakdown registry.
//
// Each Breakdown takes:
//   - `seed`: the value before Effect-driven contributions (race+class+pure-engine)
//   - `bonuses`: all flat bonuses from Effect evaluation, filtered to those
//                relevant to this stat
//   - stacking rules
// and returns a `BreakdownResult` with the final total + every contributor
// annotated with applied/dominated state.
//
// The MVP set: AbilityScore (per stat), HitPoints, Saves (Fort/Ref/Will),
// MeleePower, RangedPower, Doublestrike, Doubleshot.
//
// AC / PRR / MRR / skill bonuses depend heavily on gear effects (which
// we're deferring) so they're stubbed in `runFullBreakdown` to seed-only
// for now — they'll show "no Effect contributors yet" in the UI, which
// is honest and obvious.

import type { Bonus, BreakdownResult, StackingRules } from './bonusStacking';
import { stackBonuses } from './bonusStacking';

/** Filter bonuses by EffectType (e.g. all Bonuses with effectType="MeleePower"). */
function ofType(bonuses: Bonus[], type: string): Bonus[] {
  return bonuses.filter(b => b.effectType === type);
}

/** Add a synthetic seed Bonus to a list. Used to fold pure-engine output into the stack. */
function withSeed(bonuses: Bonus[], seed: number, seedSource: string): Bonus[] {
  if (seed === 0) return bonuses;
  // Seed is treated as untyped (always-stacks) so it doesn't compete with
  // effect-driven bonuses of any type. Whether this is correct depends on
  // the stat — for HP/SP/saves the seed already accounts for class+ability,
  // so the *additional* effect bonuses layer on top. For ability scores
  // the seed is base-and-race only and Effect contributions DO compete.
  // Per-stat fold strategies live in the individual breakdown functions.
  return [
    { bonusType: '', value: seed, source: seedSource },
    ...bonuses,
  ];
}

// ── Hit Points ───────────────────────────────────────────────────────────
// Seed = pure-engine HP (class hit dice + CON modifier × levels + Toughness feat heuristic).
// Stacking layer: Effect bonuses with effectType in HP_TYPES.

// DDOBuilderV2 effect-name strings (lowercase 'p'). FalseLife is folded in
// directly because the upstream BreakdownItemHitpoints adds the FalseLife
// breakdown total as a 'False Life' source row; we approximate that by
// merging the two effect buckets here.
//
// `HitpointsReaper` is intentionally OMITTED — it's the per-AP HP gain that
// only applies in Reaper Difficulty (DDOBuilderV2 wraps it in a Stance: Reaper
// gate and routes through Breakdown_ReaperHitpoints). We don't model Reaper
// stance yet, so excluding the type entirely is the correct non-reaper view.
const HP_TYPES = ['Hitpoints', 'HitpointsStyleBonus', 'FalseLife'];

export function breakdownHitPoints(
  seed: number,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const relevant = bonuses.filter(b => b.effectType !== undefined && HP_TYPES.includes(b.effectType));
  return stackBonuses(withSeed(relevant, seed, 'class hit dice'), rules);
}

// ── Saves ────────────────────────────────────────────────────────────────
// Seed = pure-engine save (class progression + ability mod). Effect bonuses
// with effectType in SAVE_TYPES (also matching the save name in `target`).

export function breakdownSave(
  saveName: 'Fortitude' | 'Reflex' | 'Will',
  seed: number,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const relevant = bonuses.filter(b => {
    if (b.effectType !== 'SaveBonus') return false;
    // SaveBonus effects can target a specific save by name, or "All".
    return !b.target || b.target === saveName || b.target === 'All';
  });
  return stackBonuses(withSeed(relevant, seed, `class save progression + ability mod`), rules);
}

// ── Ability Scores ───────────────────────────────────────────────────────
// Seed = base score + race mod (already applied as `effectiveScores`).
// Effect contributions DO compete via stacking rules, since that's how DDO
// ability bonuses work (one Insight bonus, one Enhancement bonus, etc.).

const ABILITY_NAMES: Record<string, string> = {
  STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution',
  INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma',
};

export function breakdownAbilityScore(
  stat: 'STR'|'DEX'|'CON'|'INT'|'WIS'|'CHA',
  seed: number,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const target = ABILITY_NAMES[stat]!;
  // AbilityBonus effects can target a specific ability or "All" (e.g.
  // Master of Trickery, Completionist, set bonuses with +N to all abilities).
  // "All" applies to every stat.
  const relevant = bonuses.filter(b =>
    b.effectType === 'AbilityBonus' && (b.target === target || b.target === 'All'),
  );
  return stackBonuses(withSeed(relevant, seed, 'base + racial'), rules);
}

// ── Doublestrike / Doubleshot ────────────────────────────────────────────

export function breakdownDoublestrike(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'Doublestrike'), rules);
}

export function breakdownDoubleshot(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'Doubleshot'), rules);
}

// ── Sneak Attack Dice ────────────────────────────────────────────────────
//
// Number of `Nd6` sneak-attack dice the build accumulates. The same
// total drives melee sneak attacks, ranged sneak attacks, and spell
// procs that read sneak-dice (Magical Ambush, Dark Imbuement / Paranoia).

export function breakdownSneakAttackDice(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'SneakAttackDice'), rules);
}

export function breakdownSeeker(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'Seeker'), rules);
}

// ── Imbue Dice ───────────────────────────────────────────────────────────
//
// Number of imbue dice the build has from Arcane Trickster, Dark Hunter,
// and similar trees. Drives Shiradi Mantle damage scaling: base 7d77
// plus +1d77 per 7 imbue dice.

export function breakdownImbueDice(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'ImbueDice'), rules);
}

// ── Melee / Ranged Power ─────────────────────────────────────────────────

export function breakdownMeleePower(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'MeleePower'), rules);
}

export function breakdownRangedPower(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'RangedPower'), rules);
}

// ── Healing Amplification (three flavors) ──────────────────────────────────
// HealingAmplification    — positive-energy heals (clerics, divine, potions)
// NegativeHealingAmplification — negative-energy (warlocks, undead PCs)
// RepairAmplification     — repair (Warforged, Bladeforged)

export function breakdownHealingAmp(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'HealingAmplification'), rules);
}

export function breakdownNegativeHealingAmp(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'NegativeHealingAmplification'), rules);
}

export function breakdownRepairAmp(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'RepairAmplification'), rules);
}

// ── Defenses: AC / Dodge / PRR / MRR / Spell Resistance ───────────────────

export function breakdownAC(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  // ACBonus + ACBonusShield (shield AC stacks with armor) + ACBonusTowerShield.
  const relevant = bonuses.filter(b =>
    b.effectType === 'ACBonus' ||
    b.effectType === 'ACBonusShield' ||
    b.effectType === 'ACBonusTowerShield');
  return stackBonuses(relevant, rules);
}

export function breakdownDodge(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'DodgeBonus'), rules);
}

export function breakdownPRR(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'PRR'), rules);
}

export function breakdownMRR(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'MRR'), rules);
}

export function breakdownSpellResistance(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'SpellResistance'), rules);
}

// ── Combat speeds ─────────────────────────────────────────────────────────

export function breakdownMeleeSpeed(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'MeleeAlacrity'), rules);
}

export function breakdownRangedSpeed(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'RangedAlacrity'), rules);
}

// ── Arcane Spell Failure ──────────────────────────────────────────────────
// ArcaneSpellFailure (race + armor) + ArcaneSpellFailureShields. Total ASF
// is the sum of all sources; gear/feat-based reductions appear as negative
// values in the same effect bucket.

export function breakdownArcaneSpellFailure(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  const relevant = bonuses.filter(b =>
    b.effectType === 'ArcaneSpellFailure' ||
    b.effectType === 'ArcaneSpellFailureShields');
  return stackBonuses(relevant, rules);
}

// ── Per-element spell power / crit chance / crit damage ───────────────────
// `SpellPower` effects target a specific element via items[] (Fire, Cold, …)
// or "All" for universal. `UniversalSpellPower` adds to every element.
// Crit chance comes from `SpellLore` (per-element) and `UniversalSpellLore`.
// Crit damage from `SpellCriticalDamage` and `UniversalSpellCriticalDamage`.
//
// Metamagic feats (Empower / Maximize / etc.) grant Universal Spell Power
// gated by their stance, but the in-game character sheet reports spell-damage
// totals WITHOUT metamagics applied — they only modify the spell at cast
// time, after this base value is read. We mirror that here by filtering out
// metamagic-feat-sourced bonuses from spell-damage breakdowns. The DPS
// calculator (Phase 5+) re-applies them on the cast pipeline instead.

const METAMAGIC_FEAT_NAMES: ReadonlySet<string> = new Set([
  'Empower Spell',
  'Empower Healing Spell',
  'Maximize Spell',
  'Heighten Spell',
  'Intensify Spell',
  'Quicken Spell',
  'Enlarge Spell',
  'Extend Spell',
  'Embolden Spell',
  'Accelerate Spell',
]);

function excludeMetamagic(bonuses: Bonus[]): Bonus[] {
  return bonuses.filter(b => !METAMAGIC_FEAT_NAMES.has(b.source));
}

export const SPELL_DAMAGE_TYPES = [
  'Acid', 'Chaos', 'Cold', 'Electric', 'Evil', 'Fire', 'Force',
  'Light/Alignment', 'Negative', 'Poison',
  'Positive', 'Repair', 'Sonic',
] as const;
export type SpellDamageType = typeof SPELL_DAMAGE_TYPES[number];

/**
 * Decide where a SpellPower-family bonus lives in the breakdown.
 *
 *  - "universal" : sits in the Universal pool (sums once, propagates to each
 *    element). Includes Universal* effects AND any per-element SpellPower
 *    targeting "All" sourced from a bonus type that DDO treats as universal-
 *    only (Reaper has no per-element flavor; the in-game character sheet
 *    rolls those into Universal Spell Power).
 *  - "per-element" : applied directly to each element so typed competition
 *    works correctly with element-specific same-type bonuses. Some bonus
 *    types only exist per-element on spell power (e.g. Exceptional Clouded
 *    Dreams — even though the data tags it `UniversalSpellPower`, the in-
 *    game effect is Exceptional to each element separately).
 *
 *  Other Highest-Only types (Feat, Enhancement, Destiny, Artifact …) DO have
 *  a real Universal flavor and stay where they are.
 */
const UNIVERSAL_ONLY_BONUS_TYPES: ReadonlySet<string> = new Set([
  'reaper',
]);

function spellPowerRouting(b: Bonus): 'universal' | 'per-element' | 'skip' {
  const bt = b.bonusType.toLowerCase();
  const isUniversalEffect = b.effectType === 'UniversalSpellPower'
                         || b.effectType === 'UniversalSpellLore'
                         || b.effectType === 'UniversalSpellCriticalDamage';
  const isPerElementEffect = b.effectType === 'SpellPower'
                          || b.effectType === 'SpellLore'
                          || b.effectType === 'SpellCriticalDamage';
  if (!isUniversalEffect && !isPerElementEffect) return 'skip';

  // Exceptional UniversalSpellPower routes per-element so Clouded Dreams'
  // "+15 Exceptional Universal Spell Power" gets Exceptional credit on each
  // element separately (matches in-game behavior — DDO has per-element
  // Exceptional spell-power gear, so Universal is shorthand for "applies to
  // all"). Crit-chance / crit-damage Universal* bonuses do NOT have this
  // remap (Clouded Dreams' UniversalSpellLore stays universal).
  if (bt === 'exceptional' && b.effectType === 'UniversalSpellPower') return 'per-element';
  if (UNIVERSAL_ONLY_BONUS_TYPES.has(bt))    return 'universal';

  // Per-element effects targeting "All":
  //  - Non-item source (feats, enhancements, destinies): route to the
  //    universal pool. Mental Toughness etc. deliver a universal +1% crit
  //    chance via SpellLore target=All; same idea for Reaper SpellPower.
  //  - Set-bonus sources (`[S]` item sets, `[FS]` filigree sets): also
  //    universal — Elemental Avatar's per-tier "+1 SpellLore All" is an
  //    aura-like effect that propagates to every element, not a typed gear
  //    bonus that competes element-by-element.
  //  - Individual item-effect source: stay per-element. Gear like Goggles
  //    Potency Quality SpellPower, Darstil's Equipment SpellLore, and Curse
  //    of Uncontrollable Energy Fortune SpellCriticalDamage need to compete
  //    via typed dominance against element-specific gear (Driftwood Quality
  //    +36 Force, Bangle KineticLore Equipment +24 Force, etc.). The
  //    universal subtotal injection still lands in each element's row as an
  //    untyped contributor, so non-item universal bonuses propagate cleanly.
  if (isPerElementEffect && b.target === 'All') {
    const isSetBonus = b.source.startsWith('[S] ') || b.source.startsWith('[FS] ');
    if (!b.isItemEffect || isSetBonus) return 'universal';
  }

  // Default: trust the effect type — Universal* in the universal pool, per-
  // element direct (target=specific element fires for that element; remaining
  // item-effect All-target SpellPower fires for every element).
  if (isUniversalEffect) return 'universal';
  return 'per-element';
}

function breakdownPerElement(
  perElementType: string,
  universalType: string,
  damageType: SpellDamageType,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  // Strip metamagic-gated contributions: the character-sheet view excludes
  // them — they layer onto the actual cast at DPS time, not the resting
  // breakdown the UI displays.
  const filtered = excludeMetamagic(bonuses);

  // Mirror DDOBuilderV2's BreakdownItemSpellPower (lines 151-165): the
  // universal breakdown is computed FIRST (with its own stacking), then
  // injected into the per-element breakdown as a single "Universal …" row.
  // This lets per-element bonuses with the same Bonus type as a universal
  // bonus stack with it instead of competing (e.g. Eminence of Autumn's
  // UniversalSpellLore 6 Artifact + Solar Gem's SpellLore 6 Artifact both
  // apply to Force; they would dominate each other if lumped together).
  //
  // Routing per `spellPowerRouting`:
  //  - Always-stacking SpellPower target=All → universal pool (Reaper et al.)
  //  - Highest-Only Universal* → per-element so it can compete with
  //    element-specific same-type bonuses (Clouded Dreams Exceptional).
  const universalBonuses: Bonus[] = [];
  const perElementBonuses: Bonus[] = [];
  for (const b of filtered) {
    const route = spellPowerRouting(b);
    if (route === 'skip') continue;
    if (route === 'universal') {
      // Filter to the matching universal/per-element type for this breakdown
      // (e.g. don't pull Universal Spell Lore into the Spell Power universal pool).
      if (b.effectType === universalType) universalBonuses.push(b);
      else if (b.effectType === perElementType) {
        // SpellPower target=All re-routed to universal — strip the target so
        // it doesn't double-fire as a per-element bonus.
        universalBonuses.push({ ...b, effectType: universalType, target: undefined });
      }
    } else {
      // per-element
      if (b.effectType === perElementType && (b.target === damageType || b.target === 'All')) {
        perElementBonuses.push(b);
      } else if (b.effectType === universalType) {
        // Universal* re-routed per-element — re-tag as per-element with All
        // target so each element picks it up via its filter.
        perElementBonuses.push({ ...b, effectType: perElementType, target: 'All' });
      }
    }
  }
  const universalResult = stackBonuses(universalBonuses, rules);

  const merged: Bonus[] = [...perElementBonuses];
  if (universalResult.total !== 0) {
    merged.push({
      bonusType: '',                        // untyped → always stacks
      value: universalResult.total,
      source: `Universal ${perElementType === 'SpellLore' ? 'Spell Lore' : perElementType === 'SpellPower' ? 'Spell Power' : perElementType === 'SpellCriticalDamage' ? 'Spell Critical Damage' : universalType}`,
      effectType: perElementType,
      target: damageType,
    });
  }
  return stackBonuses(merged, rules);
}

export function breakdownSpellPower(
  damageType: SpellDamageType,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  return breakdownPerElement('SpellPower', 'UniversalSpellPower', damageType, bonuses, rules);
}

/**
 * Universal Spell Power as its own breakdown — the raw pool that gets folded
 * into every per-element row inside `breakdownPerElement`. Surfaced separately
 * so the Breakdowns UI can show "where does my universal +X come from".
 * Metamagic-gated contributions are filtered out to match the character sheet.
 *
 * Pulls the same set the per-element pool would route to "universal" so the
 * total here matches the row that gets injected into each element.
 */
export function breakdownUniversalSpellPower(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return breakdownUniversalPool('SpellPower', 'UniversalSpellPower', bonuses, rules);
}

/**
 * Universal Spell Critical Chance / Critical Damage as their own breakdowns.
 * Same routing rules as Universal Spell Power: take the universal-pool subset
 * (UniversalSpellLore / UniversalSpellCriticalDamage effects, plus per-element
 * SpellLore / SpellCriticalDamage with target='All' from always-stacking
 * sources like Reaper). The Breakdowns UI surfaces each as its own row.
 */
export function breakdownUniversalSpellCriticalChance(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return breakdownUniversalPool('SpellLore', 'UniversalSpellLore', bonuses, rules);
}

export function breakdownUniversalSpellCriticalDamage(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return breakdownUniversalPool('SpellCriticalDamage', 'UniversalSpellCriticalDamage', bonuses, rules);
}

function breakdownUniversalPool(
  perElementType: string,
  universalType: string,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const filtered = excludeMetamagic(bonuses);
  const universalBonuses: Bonus[] = [];
  for (const b of filtered) {
    const route = spellPowerRouting(b);
    if (route !== 'universal') continue;
    if (b.effectType === universalType) universalBonuses.push(b);
    else if (b.effectType === perElementType) {
      universalBonuses.push({ ...b, effectType: universalType, target: undefined });
    }
  }
  return stackBonuses(universalBonuses, rules);
}

export function breakdownSpellCriticalChance(
  damageType: SpellDamageType,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  return breakdownPerElement('SpellLore', 'UniversalSpellLore', damageType, bonuses, rules);
}

export function breakdownSpellCriticalDamage(
  damageType: SpellDamageType,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  return breakdownPerElement('SpellCriticalDamage', 'UniversalSpellCriticalDamage', damageType, bonuses, rules);
}

// ── Spell Points ─────────────────────────────────────────────────────────
// Class table SP + casting-stat-mod × levels × 5, plus any `SpellPoints`
// effect bonuses (e.g. enhancements, gear, set bonuses). The seed is
// computed in `runEngine` from raw class data + final ability scores so this
// helper just stacks pre-built seed rows alongside effect bonuses.

export function breakdownSpellPoints(
  seedBonuses: Bonus[],
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const relevant = ofType(bonuses, 'SpellPoints');
  return stackBonuses([...seedBonuses, ...relevant], rules);
}

// ── Skills ────────────────────────────────────────────────────────────────
// Per-skill breakdown: ranks + ability mod + racial bonus + skill tome are
// folded in as untyped seed rows; on top, `SkillBonus` effects targeting the
// skill name (or "All") and `SkillBonusAbility` effects targeting the skill's
// key ability stack normally. Mirrors how the in-game character sheet builds
// up a skill total.
//
// SongSkillBonus (bardic Inspire Competence) is *not* included: it's a song
// buff that's only active when the song is sustained, not a permanent
// contribution to the resting skill total.

const ABILITY_FULL_NAME: Record<string, string> = {
  STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution',
  INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma',
};

export function breakdownSkill(
  skillName: string,
  keyAbility: string,
  ranks: number,
  abilityMod: number,
  racialBonus: number,
  tomeBonus: number,
  trainedOnly: boolean,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  // Trained-only skills (Disable Device, Open Lock, Use Magic Device, Perform,
  // Spellcraft, …) are unusable without at least one rank — and DDO mirrors
  // that by zeroing the entire skill total when ranks=0, ignoring ability mod,
  // racial bonus, tome, and effect-driven bonuses. Surface the zero with a
  // one-row "untrained" contributor so the breakdown UI explains why.
  if (trainedOnly && ranks === 0) {
    return {
      total: 0,
      contributors: [{
        bonusType: '',
        value: 0,
        source: 'Untrained — trained-only skill with 0 ranks',
        applied: true,
      }],
    };
  }

  const seed: Bonus[] = [];
  if (ranks > 0)        seed.push({ bonusType: '', value: ranks,      source: `Ranks (${ranks})` });
  if (abilityMod !== 0) seed.push({ bonusType: '', value: abilityMod, source: `${ABILITY_FULL_NAME[keyAbility] ?? keyAbility} modifier` });
  if (racialBonus > 0)  seed.push({ bonusType: '', value: racialBonus, source: 'Racial bonus' });
  if (tomeBonus > 0)    seed.push({ bonusType: '', value: tomeBonus,  source: 'Skill tome' });

  const fullAbility = ABILITY_FULL_NAME[keyAbility] ?? keyAbility;
  const direct  = bonuses.filter(b =>
    b.effectType === 'SkillBonus' && (b.target === skillName || b.target === 'All'));
  const viaAbility = bonuses.filter(b =>
    b.effectType === 'SkillBonusAbility' && b.target === fullAbility);

  return stackBonuses([...seed, ...direct, ...viaAbility], rules);
}

// ── Spell DC (per school) ────────────────────────────────────────────────
// `SpellDC` effects target a specific school via items[]. "All" applies to
// every school. Bonuses targeting a school AND universal "All" combine via
// the regular stacking rules — same-type still competes, different stacks.

export const SPELL_SCHOOLS = [
  'Abjuration',
  'Conjuration',
  'Divination',
  'Enchantment',
  'Evocation',
  'Illusion',
  'Necromancy',
  'Transmutation',
] as const;
export type SpellSchool = typeof SPELL_SCHOOLS[number];

export function breakdownSpellDC(
  school: SpellSchool,
  /** Sum of class casting-stat modifiers across all casting classes the
   *  build has — added as an untyped seed so the per-school DC reflects
   *  what the build will roll for spells of that school. */
  castingStatMod: number,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const relevant = bonuses.filter(b =>
    b.effectType === 'SpellDC' && (b.target === school || b.target === 'All'),
  );
  return stackBonuses(
    castingStatMod !== 0
      ? [{ bonusType: '', value: castingStatMod, source: `casting stat mod (+${castingStatMod})` }, ...relevant]
      : relevant,
    rules,
  );
}

// ── Spell Penetration ────────────────────────────────────────────────────
// One scalar — `SpellPenetrationBonus` effects almost never target a school.

export function breakdownSpellPenetration(
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'SpellPenetrationBonus'), rules);
}

// ── Spell Cooldown Reduction ────────────────────────────────────────
// Percentage reduction applied to every spell's base cooldown. Most data
// sources today only describe these in flavor text (Dragonsoul filigree
// 2pc/4pc, Shadowdancer Shadowcaster, Machrotechnic Maximum Overdrive,
// etc.); manual data patches are added in the parser layer when those
// sources are wanted in the simulation. The value is summed as a flat
// percent — e.g. 5 + 5 + 10 = 20% reduction → effective CD = base × 0.80.

export function breakdownSpellCooldownReduction(
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'SpellCooldownReduction'), rules);
}

// ── Caster Level ──────────────────────────────────────────────────────────
// CL = (sum of casting class levels) + CasterLevel-effect bonuses. Most
// casters use their own class level directly; multi-class adds them. The
// seed is approximated as character level since per-class CL formulas
// (e.g. Arcane Trickster's CL = AT level + ½ rogue level) are not yet
// modeled. `CasterLevelSchool` / `CasterLevelSpell` are deferred.

/**
 * Caster Level for the build's primary casting class.
 *
 * In DDO every casting class has its own caster level — for spell scaling,
 * the engine cares about (e.g.) "Wizard CL = 25", not a single character-
 * wide number. The Breakdowns UI surfaces the primary class's CL to keep the
 * display tractable.
 *
 * Filtering rules:
 *  - `CasterLevel` bonuses with no `target`, or `target === 'All'`, apply
 *    universally — kept.
 *  - Class-targeted bonuses (e.g. Epic Knowledge: Acolyte of the Skin) are
 *    kept only when the target matches the primary casting class. The data
 *    files emit one effect per class for each Epic/Legendary Knowledge tier;
 *    without this filter every untaken class would inflate the total.
 *
 * Seed:
 *  - Primary casting class's class level (typically the heroic max of 20 for
 *    pure casters; lower for splits). Falls back to character level when the
 *    build has no casting class so non-spell uses of CL (e.g. UMD scrolls)
 *    still show a sensible number.
 */
export function breakdownCasterLevel(
  primaryCastingClass: string | undefined,
  classLevel: number,
  characterLevel: number,
  buildClassNames: ReadonlySet<string>,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const relevant = bonuses.filter(b => {
    if (b.effectType !== 'CasterLevel') return false;
    if (!b.target || b.target === 'All') return true;
    if (primaryCastingClass !== undefined && b.target === primaryCastingClass) return true;
    // Drop class-targeted CL bonuses pointing at classes the build doesn't have
    // OR at classes the build has but aren't the primary caster (other spells
    // would use those, but the displayed CL is for the primary class).
    return false;
  });
  // Filter further: also drop bonuses targeting classes not in the build at
  // all (defensive — covers untargeted "All" bonuses gated on a class the
  // build doesn't have, though the requirements pass should already handle
  // that). The `buildClassNames` arg is reserved for future BaseClass logic.
  void buildClassNames;

  const seed = primaryCastingClass !== undefined
    ? { value: classLevel, source: `${primaryCastingClass} class level (${classLevel})` }
    : { value: characterLevel, source: `character level (${characterLevel})` };

  return stackBonuses(
    [{ bonusType: '', value: seed.value, source: seed.source }, ...relevant],
    rules,
  );
}
