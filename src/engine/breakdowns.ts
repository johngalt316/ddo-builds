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

export const SPELL_DAMAGE_TYPES = [
  'Acid', 'Cold', 'Electric', 'Fire', 'Force',
  'Light/Alignment', 'Negative', 'Poison',
  'Positive', 'Repair', 'Rust', 'Sonic',
] as const;
export type SpellDamageType = typeof SPELL_DAMAGE_TYPES[number];

function breakdownPerElement(
  perElementType: string,
  universalType: string,
  damageType: SpellDamageType,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  // Mirror DDOBuilderV2's BreakdownItemSpellPower (lines 151-165): the
  // universal breakdown is computed FIRST (with its own stacking), then
  // injected into the per-element breakdown as a single "Universal …" row.
  // This lets per-element bonuses with the same Bonus type as a universal
  // bonus stack with it instead of competing (e.g. Eminence of Autumn's
  // UniversalSpellLore 6 Artifact + Solar Gem's SpellLore 6 Artifact both
  // apply to Force; they would dominate each other if lumped together).
  const universalBonuses = bonuses.filter(b => b.effectType === universalType);
  const universalResult = stackBonuses(universalBonuses, rules);

  const perElementBonuses = bonuses.filter(b =>
    b.effectType === perElementType && (b.target === damageType || b.target === 'All'));

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

// ── Caster Level ──────────────────────────────────────────────────────────
// CL = (sum of casting class levels) + CasterLevel-effect bonuses. Most
// casters use their own class level directly; multi-class adds them. The
// seed is approximated as character level since per-class CL formulas
// (e.g. Arcane Trickster's CL = AT level + ½ rogue level) are not yet
// modeled. `CasterLevelSchool` / `CasterLevelSpell` are deferred.

export function breakdownCasterLevel(
  charLevel: number,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const relevant = ofType(bonuses, 'CasterLevel');
  return stackBonuses(
    [{ bonusType: '', value: charLevel, source: `character level (${charLevel})` }, ...relevant],
    rules,
  );
}
