// Phase 6.4.2 — Per-spell scaling rules.
//
// For most spells the XML's <SpellDice> shape (number, sides, bonus,
// perCasterLevels, cap) is enough to derive average damage at a given
// caster level. Some spells scale in ways the XML doesn't capture:
//
//   • Magic Missile  — fires multiple missiles whose count grows with CL,
//                      AND each missile's flat bonus grows with CL.
//   • Force Missiles — fires multiple missiles whose count grows with CL,
//                      independent of per-missile dice growth.
//   • Scorching Ray  — fires multiple rays whose count grows with CL,
//                      independent of per-ray dice growth.
//
// These get explicit overrides keyed by spell name. Per-hit procs (like
// Ambush) consult `projectileCount` so they fire once per missile/ray.
//
// Reference: ddowiki.com pages for each spell. MCL caps follow the XML's
// <MaxCasterLevel>; post-U78.1 above-MCL extensions are deferred until
// the user wires up explicit MCL overrides per build.

import type { DDOSpellDice } from '@/types/ddoData';

/**
 * Number of independent hits a single cast produces (missiles/rays). For
 * single-target spells without multi-projectile behaviour this is 1.
 */
export function projectileCount(spellName: string, casterLevel: number): number {
  const rule = SPELL_RULES[spellName];
  return rule ? rule.projectileCount(casterLevel) : 1;
}

/**
 * Average damage of a single missile/ray (for spells with overrides) or
 * the entire spell hit (for standard spells), pre-spell-power and pre-crit.
 *
 * For non-overridden spells this is `avgFromXmlDice(dice, casterLevel, mcl)`.
 */
export function avgPerHit(
  spellName: string,
  dice: DDOSpellDice,
  casterLevel: number,
  maxCasterLevel: number,
): number {
  const rule = SPELL_RULES[spellName];
  if (rule) return rule.avgPerProjectile(Math.min(casterLevel, maxCasterLevel));
  return avgFromXmlDice(dice, casterLevel, maxCasterLevel);
}

/**
 * Standard XML-driven average: `<dice.number> d <dice.sides> + <dice.bonus>`
 * accumulated per `<dice.perCasterLevels>` set, capped at `<dice.cap>` sets
 * (or by `maxCasterLevel`). Both `number` dice AND `bonus` scale per set —
 * matches DDO's "1d6+1 per caster level" pattern (Shocking Grasp et al).
 */
export function avgFromXmlDice(
  dice: DDOSpellDice,
  casterLevel: number,
  maxCasterLevel: number,
): number {
  const effectiveCL = maxCasterLevel > 0
    ? Math.min(casterLevel, maxCasterLevel)
    : casterLevel;
  const perCL = dice.perCasterLevels ?? 0;
  const sets  = perCL > 0
    ? Math.min(Math.floor(effectiveCL / perCL), dice.cap ?? Number.POSITIVE_INFINITY)
    : 1;
  const avgPerDie = (dice.sides + 1) / 2;
  return sets * (dice.number * avgPerDie + dice.bonus);
}

// ── Per-spell overrides ─────────────────────────────────────────────────

interface SpellRule {
  /** Missiles/rays at the given caster level (already capped at MCL). */
  projectileCount: (casterLevel: number) => number;
  /** Average damage per single missile/ray (pre-SP, pre-crit). */
  avgPerProjectile: (casterLevel: number) => number;
}

/** Magic Missile: 1 missile + 1 per 2 CL up to 5 at CL 9.
 *  Per-missile damage 1d2+B where B = +3 at CL1, +4 at CL2, then +1 per 2 CL. */
const magicMissile: SpellRule = {
  projectileCount: cl => Math.min(1 + Math.floor((cl - 1) / 2), 5),
  avgPerProjectile: cl => {
    const bonus = cl <= 1 ? 3 : 3 + Math.floor(cl / 2);
    return 1.5 + bonus;   // 1d2 avg = 1.5
  },
};

/** Past Life: Arcane Initiate Magic Missile SLA — same per-missile dice
 *  formula as the regular spell, but caps at 10 missiles instead of 5
 *  (per the feat description "maximum 10 missiles" + the reference
 *  spreadsheet's "Arcane Initiate" row showing 10 hits at CL 20). */
const arcaneInitiate: SpellRule = {
  projectileCount: cl => Math.min(1 + Math.floor((cl - 1) / 2), 10),
  avgPerProjectile: cl => {
    const bonus = cl <= 1 ? 3 : 3 + Math.floor(cl / 2);
    return 1.5 + bonus;   // 1d2 avg = 1.5
  },
};

/** Force Missiles: 1 missile + 1 per 4 CL up to 4 at CL 12.
 *  Per-missile damage = floor(CL/2) sets of 1d4+1 (capped at MCL). */
const forceMissiles: SpellRule = {
  projectileCount: cl => Math.min(1 + Math.floor(cl / 4), 4),
  avgPerProjectile: cl => Math.floor(cl / 2) * (2.5 + 1),  // 1d4+1 avg = 3.5
};

/** Scorching Ray: 1 ray, +1 at CL 7, +1 at CL 11 (max 3).
 *  Per-ray damage = floor(CL/2) sets of 1d6+6 capped at 10 sets (MCL 20). */
const scorchingRay: SpellRule = {
  projectileCount: cl => (cl >= 11 ? 3 : cl >= 7 ? 2 : 1),
  avgPerProjectile: cl => {
    const sets = Math.min(Math.floor(cl / 2), 10);
    return sets * (3.5 + 6);  // 1d6+6 avg = 9.5
  },
};

const SPELL_RULES: Record<string, SpellRule> = {
  'Magic Missile':   magicMissile,
  'Arcane Initiate': arcaneInitiate,
  'Force Missiles':  forceMissiles,
  'Scorching Ray':   scorchingRay,
};

/** True if a spell has a registered multi-projectile / non-standard rule. */
export function hasSpellRule(spellName: string): boolean {
  return spellName in SPELL_RULES;
}
