// Phase 6.4.8 — Buff system tests.
//
// Covers:
//   - DARK_IMBUEMENT.isAvailable / appliedBy / toComponents shape
//   - computeActiveBuffs window math + uptime fraction + benefiting cast set
//     (with steady-state wrap-around handling)

import { describe, it, expect } from 'vitest';
import { DARK_IMBUEMENT, computeActiveBuffs } from '@/engine/dps/buffs';
import type { Build, EnhancementSelection } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import type { ResolvedStep } from '@/engine/dps/timing';
import type { MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';

function build(opts: { destinyEnhancements?: EnhancementSelection[] } = {}): Build {
  return {
    classes:             [],
    gearSets:            [],
    activeGearSet:       '',
    enhancementSets:     [{
      name: 'Default',
      enhancements:             [],
      destinyEnhancements:      opts.destinyEnhancements ?? [],
      reaperEnhancements:       [],
      selectedEnhancementTrees: [],
    }],
    activeEnhancementSet: 'Default',
  } as unknown as Build;
}

function destinyTree(treeId: string, selection: string): EnhancementSelection {
  return {
    treeId,
    enhancements: [{ enhancementId: 'sel', selection, tier: 4, rank: 1 }],
  };
}

const ENGINE = {} as unknown as EngineResult;

// Test ability factories.
function ability(opts: Partial<MagicAbility> & { id: string; cooldown: number; castTime: number }): MagicAbility {
  return {
    source:        'sla',
    name:          opts.id,
    displayName:   opts.id,
    icon:          '',
    school:        '',
    cost:          0,
    charges:       0,
    maxCasterLevel: 30,
    damages:       [],
    ...opts,
  } as MagicAbility;
}

function step(key: string, abilityId: string, startTime: number, castTime = 1): ResolvedStep {
  return {
    step: { key, abilityId } as RotationStep,
    ability: ability({ id: abilityId, cooldown: 8, castTime, slaSource: '[D] Shadowdancer: Shadowdancer: Epic Strike → Nightmare Lance', cooldownGroup: 'epic-strike' }),
    startTime,
    endTime:           startTime + castTime,
    effectiveCooldown: 8,
    cdReadyAt:         startTime + 8,
    hasGap:            false,
    chargesRemaining:  Infinity,
  };
}

// ── DARK_IMBUEMENT shape ──────────────────────────────────────────────────

describe('DARK_IMBUEMENT', () => {
  const sd = build({ destinyEnhancements: [destinyTree('shadowdancer', 'Dark Imbuement')] });

  it('isAvailable only when the Dark Imbuement enhancement is selected', () => {
    expect(DARK_IMBUEMENT.isAvailable(sd, ENGINE)).toBe(true);
    expect(DARK_IMBUEMENT.isAvailable(
      build({ destinyEnhancements: [destinyTree('shadowdancer', 'Paranoia')] }),
      ENGINE,
    )).toBe(false);
    expect(DARK_IMBUEMENT.isAvailable(build(), ENGINE)).toBe(false);
  });

  it('appliedBy fires for Shadowdancer Epic Strike abilities, not other Epic Strikes', () => {
    const shadowdancerStrike = ability({
      id: 'sla::Nightmare Lance::SD',
      cooldown: 8, castTime: 1,
      slaSource: '[D] Shadowdancer: Shadowdancer: Epic Strike → Nightmare Lance',
      cooldownGroup: 'epic-strike',
    });
    const exaltedAngelStrike = ability({
      id: 'sla::Flame Pillar::EA',
      cooldown: 6, castTime: 1,
      slaSource: '[D] Exalted Angel: Exalted Angel: Holy Strike → Flame Pillar',
      cooldownGroup: 'epic-strike',
    });
    const classSpell = ability({
      id: 'Wizard::Magic Missile',
      cooldown: 0, castTime: 1,
    });
    expect(DARK_IMBUEMENT.appliedBy(shadowdancerStrike, sd, ENGINE)).toBe(true);
    expect(DARK_IMBUEMENT.appliedBy(exaltedAngelStrike, sd, ENGINE)).toBe(false);
    expect(DARK_IMBUEMENT.appliedBy(classSpell, sd, ENGINE)).toBe(false);
  });

  it('emits one per-cast component scaled to sneak dice', () => {
    const [c] = DARK_IMBUEMENT.toComponents(sd, ENGINE, { sneakAttackDice: 38 });
    expect(c).toMatchObject({
      trigger: { kind: 'per-cast' },
      qtyPerTrigger: 1,
      avgDicePerHit: 133,             // 38 × 3.5
      damageType: 'Force',
      scaleProfile: 'dark-imbuement',
    });
    expect(c?.useGenericVuln).toBeUndefined();
    expect(c?.useSonicVuln).toBeUndefined();
    expect(c?.useMRR).toBeUndefined();
  });

  it('emits nothing when sneak dice is 0', () => {
    expect(DARK_IMBUEMENT.toComponents(sd, ENGINE, { sneakAttackDice: 0 })).toEqual([]);
  });
});

// ── computeActiveBuffs ────────────────────────────────────────────────────

describe('computeActiveBuffs', () => {
  const sd = build({ destinyEnhancements: [destinyTree('shadowdancer', 'Dark Imbuement')] });

  it('returns empty when buff is unavailable', () => {
    const noBuff = build();
    const timeline = [step('s1', 'a', 0)];
    const res = computeActiveBuffs([DARK_IMBUEMENT], timeline, 8, noBuff, ENGINE);
    expect(res).toEqual([]);
  });

  it('returns empty when no cast applies the buff', () => {
    // Class spell — appliedBy returns false.
    const classSpellStep: ResolvedStep = {
      step: { key: 'mm', abilityId: 'Wizard::Magic Missile' } as RotationStep,
      ability: ability({ id: 'Wizard::Magic Missile', cooldown: 0, castTime: 1 }),
      startTime: 0, endTime: 1,
      effectiveCooldown: 0, cdReadyAt: 1, hasGap: false, chargesRemaining: Infinity,
    };
    const res = computeActiveBuffs([DARK_IMBUEMENT], [classSpellStep], 1, sd, ENGINE);
    expect(res).toEqual([]);
  });

  it('100% uptime when cast cycle is shorter than buff duration (steady-state)', () => {
    // 1 Nightmare Lance cast at t=0, cycleSeconds=8, buff duration=10.
    // Wrap-around: previous cycle's window covers [-8..2), this cycle's covers [0..10).
    // Together they always cover [0..8). 100% uptime.
    const timeline = [step('nl', 'NL', 0)];
    const [active] = computeActiveBuffs([DARK_IMBUEMENT], timeline, 8, sd, ENGINE);
    expect(active?.uptimeFraction).toBeCloseTo(1.0, 5);
    expect(active?.benefitingStepKeys.has('nl')).toBe(true);
    expect(active?.windows).toHaveLength(1);
  });

  it('partial uptime when cycle is longer than buff duration', () => {
    // 1 cast at t=0, cycleSeconds=20, duration=10. Window [0,10) covers half
    // the cycle. No wrap-around contribution beyond [0,10) since the
    // previous cycle's copy at [-20, -10) is before this cycle.
    const timeline = [step('nl', 'NL', 0)];
    const [active] = computeActiveBuffs([DARK_IMBUEMENT], timeline, 20, sd, ENGINE);
    expect(active?.uptimeFraction).toBeCloseTo(0.5, 5);
    expect(active?.benefitingStepKeys.size).toBe(1);
  });

  it('two casts within one cycle merge their windows for uptime', () => {
    // Casts at t=0 and t=8, cycle=16, duration=10.
    // Windows: [0,10) and [8,18). [8,18) clips to [8,16) in cycle. Union = [0,16) = full.
    const timeline = [step('a', 'NL', 0), step('b', 'NL', 8)];
    const [active] = computeActiveBuffs([DARK_IMBUEMENT], timeline, 16, sd, ENGINE);
    expect(active?.uptimeFraction).toBeCloseTo(1.0, 5);
    expect(active?.benefitingStepKeys.size).toBe(2);
  });

  it('cast outside any active window does not benefit', () => {
    // 1 strike at t=0, then a class spell at t=12. cycleSeconds=20, duration=10.
    // The strike's window covers [0,10). At t=12 the buff has expired.
    const strikeStep = step('nl', 'NL', 0);
    const classStep: ResolvedStep = {
      step: { key: 'mm', abilityId: 'MM' } as RotationStep,
      ability: ability({ id: 'MM', cooldown: 0, castTime: 1 }),
      startTime: 12, endTime: 13,
      effectiveCooldown: 0, cdReadyAt: 13, hasGap: false, chargesRemaining: Infinity,
    };
    const [active] = computeActiveBuffs([DARK_IMBUEMENT], [strikeStep, classStep], 20, sd, ENGINE);
    expect(active?.benefitingStepKeys.has('nl')).toBe(true);
    expect(active?.benefitingStepKeys.has('mm')).toBe(false);
  });

  it('class spell within active buff window does benefit', () => {
    // Strike at t=0, class spell at t=4. cycleSeconds=20, duration=10.
    // Class spell falls inside [0,10) → benefits.
    const strikeStep = step('nl', 'NL', 0);
    const classStep: ResolvedStep = {
      step: { key: 'mm', abilityId: 'MM' } as RotationStep,
      ability: ability({ id: 'MM', cooldown: 0, castTime: 1 }),
      startTime: 4, endTime: 5,
      effectiveCooldown: 0, cdReadyAt: 5, hasGap: false, chargesRemaining: Infinity,
    };
    const [active] = computeActiveBuffs([DARK_IMBUEMENT], [strikeStep, classStep], 20, sd, ENGINE);
    expect(active?.benefitingStepKeys.has('mm')).toBe(true);
  });
});
