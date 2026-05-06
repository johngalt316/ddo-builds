// Phase 6.4.1 — `scaleMult` + `componentDamagePerTrigger` validation.
//
// All 5 expected values come from the "Copy of Proc Based Arcane Trickster
// DPS" reference spreadsheet's Components sheet. The formula was reverse-
// engineered from those rows and confirmed by the build's author:
//
//   ScaleMult = (1 + SP/100) × (1 + critChance × (critMultBonus + 2))
//
// where `critMultBonus = CritMultColumn − 1` (the spreadsheet shows 2.49
// for a typical kemton Force build → critMultBonus = 1.49).

import { describe, it, expect } from 'vitest';
import { scaleMult, componentDamagePerTrigger } from '@/engine/dps/damage';

describe('scaleMult', () => {
  // Values quoted at the spreadsheet's display precision (2 decimals) — so
  // we round to the same precision before asserting.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  it('reproduces Magic Missile (base) — Force, 1182 SP, 68% / 2.49×', () => {
    const m = scaleMult({ spellPower: 1182, critChance: 0.68, critMultBonus: 1.49 });
    expect(round2(m)).toBe(43.24);
  });

  it('reproduces Rupturing Echoes — Sonic, 300 SP, 75% / 2.04×', () => {
    const m = scaleMult({ spellPower: 300, critChance: 0.75, critMultBonus: 1.04 });
    expect(round2(m)).toBe(13.12);
  });

  it('reproduces Alchemical Earth Attunement — Acid, 300 SP, 75% / 2.29×', () => {
    const m = scaleMult({ spellPower: 300, critChance: 0.75, critMultBonus: 1.29 });
    expect(round2(m)).toBe(13.87);
  });

  it('reproduces Dark Imbuement — Force, 2895.9 SP, 68% / 2.04×', () => {
    const m = scaleMult({ spellPower: 2895.9, critChance: 0.68, critMultBonus: 1.04 });
    expect(round2(m)).toBe(91.89);
  });

  it('reproduces Woeful Energy — Force, 300 SP, 68% / 2.49×', () => {
    const m = scaleMult({ spellPower: 300, critChance: 0.68, critMultBonus: 1.49 });
    expect(round2(m)).toBe(13.49);
  });

  it('collapses to (1 + SP/100) when crit chance is 0', () => {
    expect(scaleMult({ spellPower: 1000, critChance: 0, critMultBonus: 5 })).toBe(11);
  });
});

describe('componentDamagePerTrigger', () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  it('reproduces Magic Missile (base) per-trigger damage — 5 × 18.5 × 43.24', () => {
    const d = componentDamagePerTrigger(
      { qtyPerTrigger: 5, avgDicePerHit: 18.5 },
      { spellPower: 1182, critChance: 0.68, critMultBonus: 1.49 },
    );
    expect(round2(d)).toBeCloseTo(4000.11, 1);
  });

  it('reproduces Force Missile (base) per-trigger damage — 4 × 49 × 43.24', () => {
    const d = componentDamagePerTrigger(
      { qtyPerTrigger: 4, avgDicePerHit: 49 },
      { spellPower: 1182, critChance: 0.68, critMultBonus: 1.49 },
    );
    expect(round2(d)).toBeCloseTo(8475.91, 1);
  });

  it('reproduces Rupturing Echoes per-trigger damage — 1 × 525 × 13.12', () => {
    const d = componentDamagePerTrigger(
      { qtyPerTrigger: 1, avgDicePerHit: 525 },
      { spellPower: 300, critChance: 0.75, critMultBonus: 1.04 },
    );
    expect(round2(d)).toBeCloseTo(6888, 1);
  });

  it('reproduces Dark Imbuement per-trigger damage — 1 × 133 × 91.89', () => {
    const d = componentDamagePerTrigger(
      { qtyPerTrigger: 1, avgDicePerHit: 133 },
      { spellPower: 2895.9, critChance: 0.68, critMultBonus: 1.04 },
    );
    expect(round2(d)).toBeCloseTo(12221.40, 1);
  });
});
