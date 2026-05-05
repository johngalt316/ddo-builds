// Phase 6.4.5 — DPS calculator.
// 6.4.5a: resolveScaleInputs (scale-profile dispatch).
// 6.4.5b: trigger rate, debuff multiplier, evaluateComponent / evaluateAll.

import { describe, it, expect } from 'vitest';
import {
  resolveScaleInputs,
  componentTriggersPerMinute,
  componentDebuffMultiplier,
  evaluateComponent,
  evaluateAll,
  totalCastsPerMinute,
  type Rotation,
  type Debuffs,
} from '@/engine/dps/calculator';
import type { DamageComponent } from '@/engine/dps/damage';
import type { EngineResult } from '@/engine/runEngine';

// Minimal engine factory — only the fields resolveScaleInputs reads.
function engine(opts: {
  spellPower?:    Partial<Record<string, number>>;
  critChance?:    Partial<Record<string, number>>;   // % values, e.g. 68 for 68%
  critDamage?:    Partial<Record<string, number>>;   // % bonus, e.g. 149 for +149%
  meleePower?:    number;
  rangedPower?:   number;
}): EngineResult {
  const r = (n = 0) => ({ total: n, contributors: [] });
  const sp = opts.spellPower ?? {};
  const cc = opts.critChance ?? {};
  const cd = opts.critDamage ?? {};
  return {
    spellPowers:           Object.fromEntries(Object.keys(sp).map(k => [k, r(sp[k])])),
    spellCriticalChance:   Object.fromEntries(Object.keys(cc).map(k => [k, r(cc[k])])),
    spellCriticalDamage:   Object.fromEntries(Object.keys(cd).map(k => [k, r(cd[k])])),
    meleePower:            r(opts.meleePower  ?? 0),
    rangedPower:           r(opts.rangedPower ?? 0),
  } as unknown as EngineResult;
}

const baseComponent: Omit<DamageComponent, 'scaleProfile' | 'damageType'> = {
  label: 'test',
  trigger: { kind: 'per-cast' },
  qtyPerTrigger: 1,
  avgDicePerHit: 1,
};

describe("resolveScaleInputs — 'spell' profile", () => {
  it('uses element SP and crit numbers for the component damage type', () => {
    const e = engine({
      spellPower:  { Force: 1182, Fire: 800 },
      critChance:  { Force: 68 },
      critDamage:  { Force: 149 },
    });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'spell' };
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 0, metamagicSP: 0 })).toEqual({
      spellPower: 1182,
      critChance: 0.68,
      critMultBonus: 1.49,
    });
  });

  it('returns zero SP when the element is absent from the breakdown', () => {
    const e = engine({});
    const comp: DamageComponent = { ...baseComponent, damageType: 'Acid', scaleProfile: 'spell' };
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 0, metamagicSP: 0 })).toEqual({
      spellPower: 0, critChance: 0, critMultBonus: 0,
    });
  });
});

describe("resolveScaleInputs — 'sneak' profile (Magical Ambush)", () => {
  it('halves element SP, crit comes from the same element', () => {
    const e = engine({
      spellPower: { Force: 1182 },
      critChance: { Force: 68 },
      critDamage: { Force: 149 },
    });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'sneak' };
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 38, metamagicSP: 300 }))
      .toEqual({ spellPower: 591, critChance: 0.68, critMultBonus: 1.49 });
  });
});

describe("resolveScaleInputs — 'proc' profile", () => {
  it('uses metamagic SP only — element SP is ignored', () => {
    const e = engine({
      spellPower: { Sonic: 947 },           // ignored by proc profile
      critChance: { Sonic: 75 },
      critDamage: { Sonic: 104 },
    });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Sonic', scaleProfile: 'proc' };
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 0, metamagicSP: 300 }))
      .toEqual({ spellPower: 300, critChance: 0.75, critMultBonus: 1.04 });
  });

  it('zero metamagic SP yields the no-SP baseline', () => {
    const e = engine({ critChance: { Force: 68 }, critDamage: { Force: 149 } });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'proc' };
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 0, metamagicSP: 0 }))
      .toEqual({ spellPower: 0, critChance: 0.68, critMultBonus: 1.49 });
  });
});

describe("resolveScaleInputs — 'dark-imbuement' profile (bug-modeled)", () => {
  it('Force SP × (1 + max(MP, RP)/100), crit from Force', () => {
    const e = engine({
      spellPower:  { Force: 1182 },
      critChance:  { Force: 68 },
      critDamage:  { Force: 104 },
      meleePower:  142,
      rangedPower: 80,
    });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'dark-imbuement' };
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 38, metamagicSP: 300 }))
      .toEqual({
        spellPower: 1182 * 2.42,        // = 2860.44
        critChance: 0.68,
        critMultBonus: 1.04,
      });
  });

  it('takes the higher of melee vs ranged power', () => {
    const e = engine({
      spellPower: { Force: 1000 },
      meleePower: 50,
      rangedPower: 200,
    });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'dark-imbuement' };
    const out = resolveScaleInputs(comp, e, { sneakAttackDice: 0, metamagicSP: 0 });
    expect(out.spellPower).toBe(3000);  // 1000 × (1 + 200/100)
  });
});

// ── Trigger-rate dispatch ────────────────────────────────────────────────

describe('componentTriggersPerMinute', () => {
  const rotation: Rotation = {
    spells: [
      { name: 'Magic Missile',  casterLevel: 9,  castsPerMinute: 30 },
      { name: 'Force Missiles', casterLevel: 12, castsPerMinute: 23 },
    ],
  };

  it('per-cast (no spell) = total rotation cpm', () => {
    const c: DamageComponent = { ...baseComponent,
      damageType: 'Force', scaleProfile: 'proc',
      trigger: { kind: 'per-cast' } };
    expect(componentTriggersPerMinute(c, rotation)).toBe(53);
  });

  it('per-cast (with spell) = that spell\'s cpm', () => {
    const c: DamageComponent = { ...baseComponent,
      damageType: 'Force', scaleProfile: 'spell',
      trigger: { kind: 'per-cast', spell: 'Magic Missile' } };
    expect(componentTriggersPerMinute(c, rotation)).toBe(30);
  });

  it('per-cast (unknown spell) → 0', () => {
    const c: DamageComponent = { ...baseComponent,
      damageType: 'Force', scaleProfile: 'spell',
      trigger: { kind: 'per-cast', spell: 'Unknown Spell' } };
    expect(componentTriggersPerMinute(c, rotation)).toBe(0);
  });

  it('per-hit (Magic Missile @ CL 9) = 30 × 5 missiles = 150', () => {
    const c: DamageComponent = { ...baseComponent,
      damageType: 'Force', scaleProfile: 'spell',
      trigger: { kind: 'per-hit', spell: 'Magic Missile' } };
    expect(componentTriggersPerMinute(c, rotation)).toBe(150);
  });

  it('icd defers to 6.4.4 (returns 0)', () => {
    const c: DamageComponent = { ...baseComponent,
      damageType: 'Force', scaleProfile: 'proc',
      trigger: { kind: 'icd', cooldownSec: 10, chance: 0.07 } };
    expect(componentTriggersPerMinute(c, rotation)).toBe(0);
  });

  it('totalCastsPerMinute matches the rotation sum', () => {
    expect(totalCastsPerMinute(rotation)).toBe(53);
    expect(totalCastsPerMinute({ spells: [] })).toBe(0);
  });
});

// ── Debuff multiplier ────────────────────────────────────────────────────

describe('componentDebuffMultiplier', () => {
  const noDebuffs: Debuffs = { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0 };

  it('unflagged component → 1', () => {
    const c: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'spell' };
    expect(componentDebuffMultiplier(c, { genericVulnPct: 30, sonicVulnPct: 30, effectiveMRR: -50 })).toBe(1);
  });

  it('useGenericVuln only → +30% with 30% vuln', () => {
    const c: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'spell',
      useGenericVuln: true };
    expect(componentDebuffMultiplier(c, { ...noDebuffs, genericVulnPct: 30 })).toBeCloseTo(1.3, 4);
  });

  it('useMRR with effectiveMRR=0 → 1.0 (baseline)', () => {
    const c: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'spell', useMRR: true };
    expect(componentDebuffMultiplier(c, noDebuffs)).toBe(1);
  });

  it('useMRR with effectiveMRR=-21 → 100/79 ≈ 1.266 (matches spreadsheet 1.27)', () => {
    const c: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'spell', useMRR: true };
    expect(componentDebuffMultiplier(c, { ...noDebuffs, effectiveMRR: -21 })).toBeCloseTo(100 / 79, 4);
  });

  it('combined flags multiply', () => {
    const c: DamageComponent = { ...baseComponent, damageType: 'Sonic', scaleProfile: 'proc',
      useGenericVuln: true, useSonicVuln: true, useMRR: true };
    const m = componentDebuffMultiplier(c, { genericVulnPct: 20, sonicVulnPct: 10, effectiveMRR: -21 });
    expect(m).toBeCloseTo(1.2 * 1.1 * (100 / 79), 4);
  });
});

// ── End-to-end ───────────────────────────────────────────────────────────

describe('evaluateComponent / evaluateAll', () => {
  const e = engine({
    spellPower:  { Force: 1182 },
    critChance:  { Force: 68 },
    critDamage:  { Force: 149 },
  });
  const ctx = { sneakAttackDice: 38, metamagicSP: 300 };

  it('reproduces the spreadsheet\'s Magic Missile (base) row to within rounding', () => {
    // Spreadsheet: scale 43.24 × qty 5 × avg 18.5 = 4000.11 / cast
    // × 30 casts/min × 1.27 MRR debuff = 151,902.88 / min.
    const mm: DamageComponent = {
      label: 'Magic Missile (base)',
      trigger: { kind: 'per-cast', spell: 'Magic Missile' },
      qtyPerTrigger: 5,
      avgDicePerHit: 18.5,
      damageType: 'Force',
      scaleProfile: 'spell',
      useGenericVuln: true,
      useMRR: true,
    };
    const rotation: Rotation = { spells: [{ name: 'Magic Missile', casterLevel: 9, castsPerMinute: 30 }] };
    const debuffs: Debuffs = { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: -21 };

    const r = evaluateComponent(mm, e, ctx, rotation, debuffs);
    expect(r.scaleInputs).toEqual({ spellPower: 1182, critChance: 0.68, critMultBonus: 1.49 });
    expect(r.damagePerTrigger).toBeCloseTo(4000.11, 1);
    expect(r.triggersPerMinute).toBe(30);
    expect(r.debuffMultiplier).toBeCloseTo(100 / 79, 4);
    expect(r.damagePerMinute).toBeCloseTo(151_902.88, 0);
  });

  it('evaluateAll sums per-component damage and reports DPS = perMinute / 60', () => {
    const cs: DamageComponent[] = [
      { label: 'A', trigger: { kind: 'per-cast' }, qtyPerTrigger: 1, avgDicePerHit: 100,
        damageType: 'Force', scaleProfile: 'proc' },
      { label: 'B', trigger: { kind: 'per-cast' }, qtyPerTrigger: 1, avgDicePerHit: 50,
        damageType: 'Force', scaleProfile: 'proc' },
    ];
    const r = evaluateAll(cs, e, ctx, { spells: [{ name: 'X', casterLevel: 1, castsPerMinute: 60 }] },
      { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0 });
    expect(r.byComponent).toHaveLength(2);
    expect(r.totalPerMinute).toBeCloseTo(
      r.byComponent[0]!.damagePerMinute + r.byComponent[1]!.damagePerMinute,
    );
    expect(r.totalDPS).toBeCloseTo(r.totalPerMinute / 60);
  });
});
