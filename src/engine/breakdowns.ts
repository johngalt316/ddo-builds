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

/** Filter bonuses by EffectType AND target (e.g. AbilityBonus targeting "Strength"). */
function ofTypeAndTarget(bonuses: Bonus[], type: string, target: string): Bonus[] {
  return bonuses.filter(b => b.effectType === type && b.target === target);
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

const HP_TYPES = ['HitPoints', 'FalseLife'];

export function breakdownHitPoints(
  seed: number,
  bonuses: Bonus[],
  rules: StackingRules,
): BreakdownResult {
  const relevant = bonuses.filter(b => b.effectType !== undefined && HP_TYPES.includes(b.effectType));
  return stackBonuses(withSeed(relevant, seed, 'class hit dice + CON'), rules);
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
  const relevant = ofTypeAndTarget(bonuses, 'AbilityBonus', target);
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

// ── Healing Amplification ────────────────────────────────────────────────

export function breakdownHealingAmp(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  return stackBonuses(ofType(bonuses, 'HealingAmplification'), rules);
}
