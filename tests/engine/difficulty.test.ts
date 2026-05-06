import { describe, it, expect } from 'vitest';
import {
  spellDamageMultiplier,
  physicalDamageMultiplier,
} from '@/engine/dps/difficulty';
import {
  componentDebuffMultiplier,
  type Debuffs,
} from '@/engine/dps/calculator';
import type { DamageComponent } from '@/engine/dps/damage';

describe('spellDamageMultiplier', () => {
  it('Elite (0) and pre-Elite difficulties never reduce damage', () => {
    expect(spellDamageMultiplier(0)).toBe(1.0);
    expect(spellDamageMultiplier(-3)).toBe(1.0);
  });

  it('matches the ddowiki Player-Damage column for R1-R6', () => {
    expect(spellDamageMultiplier(1)).toBeCloseTo(0.769, 3);
    expect(spellDamageMultiplier(2)).toBeCloseTo(0.667, 3);
    expect(spellDamageMultiplier(3)).toBeCloseTo(0.556, 3);
    expect(spellDamageMultiplier(4)).toBeCloseTo(0.455, 3);
    expect(spellDamageMultiplier(5)).toBeCloseTo(0.370, 3);
    expect(spellDamageMultiplier(6)).toBeCloseTo(0.303, 3);
  });

  it('uses the wiki Spells column for R7-R10 (additional caster penalty)', () => {
    expect(spellDamageMultiplier(7)).toBeCloseTo(0.230, 3);
    expect(spellDamageMultiplier(8)).toBeCloseTo(0.188, 3);
    expect(spellDamageMultiplier(9)).toBeCloseTo(0.149, 3);
    expect(spellDamageMultiplier(10)).toBeCloseTo(0.106, 3);
  });

  it('saturates at R10 for out-of-range inputs', () => {
    expect(spellDamageMultiplier(11)).toBe(spellDamageMultiplier(10));
    expect(spellDamageMultiplier(99)).toBe(spellDamageMultiplier(10));
  });
});

describe('physicalDamageMultiplier', () => {
  it('matches the wiki Player-Damage column at every difficulty (no R7+ split)', () => {
    expect(physicalDamageMultiplier(0)).toBe(1.0);
    expect(physicalDamageMultiplier(7)).toBeCloseTo(0.250, 3);
    expect(physicalDamageMultiplier(8)).toBeCloseTo(0.208, 3);
    expect(physicalDamageMultiplier(9)).toBeCloseTo(0.179, 3);
    expect(physicalDamageMultiplier(10)).toBeCloseTo(0.156, 3);
  });
});

describe('componentDebuffMultiplier — damageDealtMultiplier path', () => {
  // A bare component with no vuln/MRR opt-ins: only the
  // damageDealtMultiplier should affect the result.
  const bare: DamageComponent = {
    label: 'Test',
    trigger: { kind: 'per-cast' },
    qtyPerTrigger: 1,
    avgDicePerHit: 100,
    damageType: 'Force',
    scaleProfile: 'spell',
  };

  it('returns 1 when difficulty is Elite (multiplier = 1)', () => {
    const d: Debuffs = { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0,
      damageDealtMultiplier: 1 };
    expect(componentDebuffMultiplier(bare, d)).toBe(1);
  });

  it('returns 1 when damageDealtMultiplier is undefined (back-compat)', () => {
    const d: Debuffs = { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0 };
    expect(componentDebuffMultiplier(bare, d)).toBe(1);
  });

  it('applies the spell multiplier at R10 (≈0.106)', () => {
    const d: Debuffs = {
      genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0,
      damageDealtMultiplier: spellDamageMultiplier(10),
    };
    expect(componentDebuffMultiplier(bare, d)).toBeCloseTo(0.106, 3);
  });

  it('stacks multiplicatively with vuln + MRR debuffs', () => {
    const c: DamageComponent = { ...bare, useGenericVuln: true, useMRR: true };
    const d: Debuffs = {
      genericVulnPct: 50,        // ×1.50
      sonicVulnPct:    0,
      effectiveMRR: -100,        // ×100/(−100+100) → div-by-0; bump it
      damageDealtMultiplier: 0.5,// ×0.50
    };
    // Use a sane MRR (-50 → ×100/50 = 2.0) to avoid the singular case.
    d.effectiveMRR = -50;
    // Expected: 1.50 × 2.0 × 0.50 = 1.5
    expect(componentDebuffMultiplier(c, d)).toBeCloseTo(1.5, 6);
  });
});
