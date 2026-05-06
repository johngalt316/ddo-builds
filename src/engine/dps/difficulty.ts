// Reaper-difficulty damage-dealt multipliers.
//
// DDO scales the damage players deal down as Reaper difficulty climbs.
// Source: https://ddowiki.com/page/Reaper_difficulty (Player Damage Dealt
// Multiplier table). At R7+, spell damage gets an additional reduction
// on top of the base column ("caster damage has an additional reduction
// in high reaper" since U59) — these split values are listed in the
// "Spells" column at R7-R10.
//
// Elite (index 0) and lower-than-Elite difficulties have no reduction.
// Casual / Normal / Hard aren't represented in the calculator's
// DifficultyIndex (the slider starts at Elite), so the table starts at
// Elite = 1.0 and goes through R10.
//
// Note: in our DPS model so far, every DamageComponent is spell damage
// (Acid/Cold/Fire/Force/Negative/Sonic/etc.). Bludgeoning, piercing,
// and slashing are the only "physical" types — none of those land in
// the calculator yet, but `physicalDamageMultiplier` is provided for
// when melee/ranged rotations come online (Phase 6.7+).

/** R0 (Elite) … R10. Mirrors `DifficultyIndex` in DPSCalculatorPanel. */
type DiffIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** "Player Damage Dealt" column from the wiki — used for physical damage. */
const PHYSICAL_TABLE: Record<DiffIndex, number> = {
   0: 1.000,
   1: 0.769,
   2: 0.667,
   3: 0.556,
   4: 0.455,
   5: 0.370,
   6: 0.303,
   7: 0.250,
   8: 0.208,
   9: 0.179,
  10: 0.156,
};

/** "Spells" column from the wiki — only differs from PHYSICAL_TABLE at
 *  R7+. Below R7 caster and physical damage take the same reduction. */
const SPELL_TABLE: Record<DiffIndex, number> = {
   0: 1.000,
   1: 0.769,
   2: 0.667,
   3: 0.556,
   4: 0.455,
   5: 0.370,
   6: 0.303,
   7: 0.230,
   8: 0.188,
   9: 0.149,
  10: 0.106,
};

function clampIdx(idx: number): DiffIndex {
  if (idx <= 0) return 0;
  if (idx >= 10) return 10;
  return Math.round(idx) as DiffIndex;
}

/** Multiplier applied to all spell-typed damage at the given difficulty.
 *  Elite = 1.0; R10 = 0.106 (i.e. spells deal 10.6% of their base value). */
export function spellDamageMultiplier(idx: number): number {
  return SPELL_TABLE[clampIdx(idx)];
}

/** Multiplier for physical (bludgeoning / piercing / slashing) damage.
 *  Elite = 1.0; R10 = 0.156. Reserved for the future melee/ranged path. */
export function physicalDamageMultiplier(idx: number): number {
  return PHYSICAL_TABLE[clampIdx(idx)];
}
