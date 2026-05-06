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
  rotationDPS,
  totalCastsPerMinute,
  type Rotation,
  type Debuffs,
} from '@/engine/dps/calculator';
import type { DamageComponent } from '@/engine/dps/damage';
import type { EngineResult } from '@/engine/runEngine';
import type { MagicAbility } from '@/engine/dps/abilities';
import type { Build } from '@/types/build';
import { newRotationStep } from '@/engine/dps/rotation';

// Minimal engine factory — only the fields resolveScaleInputs reads.
function engine(opts: {
  spellPower?:      Partial<Record<string, number>>;
  critChance?:      Partial<Record<string, number>>;   // % values, e.g. 68 for 68%
  critDamage?:      Partial<Record<string, number>>;   // % bonus, e.g. 149 for +149%
  meleePower?:      number;
  rangedPower?:     number;
  casterLevel?:     number;
  sneakAttackDice?: number;
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
    casterLevel:           r(opts.casterLevel ?? 20),
    sneakAttackDice:       r(opts.sneakAttackDice ?? 0),
  } as unknown as EngineResult;
}

// Minimal ability factory for rotationDPS tests.
function ability(name: string, opts: Partial<MagicAbility> = {}): MagicAbility {
  return {
    id: name,
    source: 'spell',
    name,
    displayName: name,
    icon: '',
    school: 'Evocation',
    className: 'Wizard',
    spellLevel: 1,
    cost: 10,
    cooldown: 0,
    charges: 0,
    maxCasterLevel: 20,
    castTime: 1,
    damages: [{
      damageType: 'Force',
      spellPower: 'Force',
      dice: { number: 1, sides: 6, bonus: 0 },   // avg 3.5 per cast
    }],
    ...opts,
  };
}

// Minimal build for rotationDPS — no class/destiny/gear so no procs fire.
const EMPTY_BUILD = {
  classes: [],
  gearSets: [],
  activeGearSet: '',
  destinyEnhancements: [],
} as unknown as Build;

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
  it('halves the metamagic-included Force SP', () => {
    const e = engine({
      spellPower: { Force: 1182 },
      critChance: { Force: 68 },
      critDamage: { Force: 149 },
    });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'sneak' };
    // (1182 + 300 metamagic) × 0.5 = 741
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 38, metamagicSP: 300 }))
      .toEqual({ spellPower: 741, critChance: 0.68, critMultBonus: 1.49 });
  });
  it('with no metamagic, falls back to plain 0.5 × element SP', () => {
    const e = engine({
      spellPower: { Force: 1182 },
      critChance: { Force: 68 },
      critDamage: { Force: 149 },
    });
    const comp: DamageComponent = { ...baseComponent, damageType: 'Force', scaleProfile: 'sneak' };
    expect(resolveScaleInputs(comp, e, { sneakAttackDice: 38, metamagicSP: 0 }))
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
        // (1182 + 300 metamagic) × 2.42 = 1482 × 2.42 = 3586.44
        spellPower: 1482 * 2.42,
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
  // The spreadsheet's "Magic Missile (base)" row treats 1182 SP as the
  // already-with-metamagic total, so set metamagicSP to 0 here to avoid
  // double-counting when checking the calibration.
  const ctx = { sneakAttackDice: 38, metamagicSP: 0 };

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

  it('rotationDPS — empty rotation returns null', () => {
    const out = rotationDPS([], [ability('A')], EMPTY_BUILD, e, ctx,
      { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0 }, 0);
    expect(out).toBeNull();
  });

  it('rotationDPS — single-spell rotation', () => {
    // 1s cast, 0 CD → 60 cpm cycle. Force SP 1182, crit 68%, critBonus 1.49.
    // scaleMult = (1 + 1182/100) × (1 + 0.68 × (1.49 + 2)) = 12.82 × 3.3732 = 43.247
    // perCast = 1 × 3.5 × 43.247 = 151.36
    // perMin = 151.36 × 60 = 9081.5 (no debuffs, no procs)
    const A = ability('A', { castTime: 1, cooldown: 0 });
    const out = rotationDPS(
      [newRotationStep('A')],
      [A], EMPTY_BUILD, e, ctx,
      { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0 }, 0,
    );
    expect(out).not.toBeNull();
    expect(out!.byComponent).toHaveLength(1);
    expect(out!.byComponent[0]!.component.label).toBe('A (base)');
    expect(out!.byComponent[0]!.damagePerTrigger).toBeCloseTo(151.36, 1);
    expect(out!.byComponent[0]!.triggersPerMinute).toBeCloseTo(60, 1);
    expect(out!.totalPerMinute).toBeCloseTo(9081.55, 0);
    expect(out!.totalDPS).toBeCloseTo(151.36, 1);
  });

  it('rotationDPS — multi-spell rotation splits cpm across spells', () => {
    // Rotation [A, B] both 1s cast, 0 CD → cycle 2s, cpm each = 30.
    // Each contributes (1 × 3.5 × 43.247) × 30 = 4540.78 / min.
    // Total = 9081.55.
    const A = ability('A', { castTime: 1, cooldown: 0 });
    const B = ability('B', { castTime: 1, cooldown: 0 });
    const out = rotationDPS(
      [newRotationStep('A'), newRotationStep('B')],
      [A, B], EMPTY_BUILD, e, ctx,
      { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0 }, 0,
    );
    expect(out).not.toBeNull();
    expect(out!.byComponent).toHaveLength(2);
    for (const c of out!.byComponent) {
      expect(c.triggersPerMinute).toBeCloseTo(30, 1);
      expect(c.damagePerMinute).toBeCloseTo(4540.78, 0);
    }
    expect(out!.totalPerMinute).toBeCloseTo(9081.55, 0);
  });

  it('rotationDPS — repeated spell sums casts in one component, doubled cpm', () => {
    // Rotation [A, A] both 1s cast, 0 CD → cycle 2s, A appears twice.
    // A's cpm = 60. Same total per minute as a single A at 60 cpm.
    const A = ability('A', { castTime: 1, cooldown: 0 });
    const out = rotationDPS(
      [newRotationStep('A'), newRotationStep('A')],
      [A], EMPTY_BUILD, e, ctx,
      { genericVulnPct: 0, sonicVulnPct: 0, effectiveMRR: 0 }, 0,
    );
    expect(out).not.toBeNull();
    expect(out!.byComponent).toHaveLength(1);
    expect(out!.byComponent[0]!.triggersPerMinute).toBeCloseTo(60, 1);
    expect(out!.totalPerMinute).toBeCloseTo(9081.55, 0);
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
