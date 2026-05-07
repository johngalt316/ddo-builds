// Phase 6.4.7a — debuff catalog + aggregator.

import { describe, it, expect } from 'vitest';
import {
  DEBUFF_CATALOG,
  aggregateDebuffs,
  autoActiveDebuffIds,
  averageStackFraction,
  initialDebuffState,
  type DebuffState,
} from '@/engine/dps/debuffs';
import type { Build, GearItem } from '@/types/build';
import { DEFAULT_BUILD } from '@/types/build';

const enable = (state: DebuffState, ...ids: string[]): DebuffState => {
  const out = { ...state };
  for (const id of ids) {
    const cur = out[id];
    if (cur) out[id] = { ...cur, enabled: true };
  }
  return out;
};

describe('initialDebuffState', () => {
  it('covers every catalog entry, disabled, seeded with defaultScope', () => {
    const s = initialDebuffState();
    for (const entry of DEBUFF_CATALOG) {
      expect(s[entry.id]).toEqual({ enabled: false, scope: entry.defaultScope });
    }
  });
});

describe('aggregateDebuffs — empty / disabled', () => {
  it('all-disabled state is a no-op', () => {
    expect(aggregateDebuffs(initialDebuffState())).toEqual({
      genericVulnPct: 0,
      sonicVulnPct:   0,
      effectiveMRR:   0,
      effectivePRR:   0,
    });
  });
});

describe('aggregateDebuffs — single debuff', () => {
  it('Improved Sunder subtracts 25 from effective MRR', () => {
    const state = enable(initialDebuffState(), 'improved-sunder');
    expect(aggregateDebuffs(state).effectiveMRR).toBe(-25);
  });

  it('Curse of Vulnerability adds 20% generic vuln', () => {
    const state = enable(initialDebuffState(), 'curse-of-vulnerability');
    expect(aggregateDebuffs(state).genericVulnPct).toBe(20);
  });

  it('Word of Detonation (Sonic) routes to sonicVulnPct', () => {
    const state = enable(initialDebuffState(), 'word-of-detonation-sonic');
    expect(aggregateDebuffs(state).sonicVulnPct).toBe(25);
  });

  it('Word of Detonation (Fire) does NOT contribute to genericVulnPct or sonicVulnPct', () => {
    // Fire-only vuln has no calculator slot yet — it stays informational
    // until the Debuffs shape grows per-element flags.
    const state = enable(initialDebuffState(), 'word-of-detonation-fire');
    const out = aggregateDebuffs(state);
    expect(out.genericVulnPct).toBe(0);
    expect(out.sonicVulnPct).toBe(0);
  });
});

describe('aggregateDebuffs — stacking', () => {
  it('multiple MRR debuffs subtract additively', () => {
    const state = enable(initialDebuffState(), 'improved-sunder', 'sundering-words');
    expect(aggregateDebuffs(state).effectiveMRR).toBe(-(25 + 20));
  });

  it('multiple generic vulns add', () => {
    const state = enable(initialDebuffState(), 'curse-of-vulnerability', 'expose-weakness');
    expect(aggregateDebuffs(state).genericVulnPct).toBe(20 + 10);
  });

  it('vulnerability + MRR + sonic vuln all coexist', () => {
    const state = enable(
      initialDebuffState(),
      'curse-of-vulnerability',
      'improved-sunder',
      'word-of-detonation-sonic',
    );
    expect(aggregateDebuffs(state)).toEqual({
      genericVulnPct: 20,
      sonicVulnPct:   25,
      effectiveMRR:   -25,
      effectivePRR:   -25,    // Improved Sunder also subtracts 25 PRR
      elementVulnPct: { Sonic: 25 },
    });
  });

  it('Word of Detonation (Fire) routes to elementVulnPct.Fire', () => {
    const state = enable(initialDebuffState(), 'word-of-detonation-fire');
    const out = aggregateDebuffs(state);
    expect(out.elementVulnPct?.Fire).toBe(25);
  });

  it('Legendary Ash stacks +21 MRR reduction', () => {
    const state = enable(initialDebuffState(), 'legendary-ash');
    expect(aggregateDebuffs(state).effectiveMRR).toBe(-21);
  });

  it('Harmonic Resonance routes to Sonic via both new + legacy fields', () => {
    const state = enable(initialDebuffState(), 'harmonic-resonance');
    const out = aggregateDebuffs(state);
    expect(out.sonicVulnPct).toBe(30);
    expect(out.elementVulnPct?.Sonic).toBe(30);
  });
});

describe('auto-apply detection', () => {
  function buildWithAugment(augmentName: string): Build {
    const item: GearItem = {
      slot: 'MainHand',
      name: 'Test Weapon', icon: '',
      buffs: [],
      augmentSlots: [{ slotType: 'Yellow', selectedAugment: augmentName }],
    };
    return {
      ...DEFAULT_BUILD,
      gearSets: [{ name: 'Test', items: [item] }],
      activeGearSet: 'Test',
    };
  }

  function buildWithItemBuff(buffType: string): Build {
    const item: GearItem = {
      slot: 'MainHand',
      name: 'Test Weapon', icon: '',
      buffs: [{ type: buffType }],
    };
    return {
      ...DEFAULT_BUILD,
      gearSets: [{ name: 'Test', items: [item] }],
      activeGearSet: 'Test',
    };
  }

  it('Flamehorn augment auto-applies Legendary Ash', () => {
    const build = buildWithAugment('Flamehorn');
    const ids = autoActiveDebuffIds(build);
    expect(ids.has('legendary-ash')).toBe(true);
  });

  it('Mind Tear item buff auto-applies Legendary Ash', () => {
    const build = buildWithItemBuff('Mind Tear');
    expect(autoActiveDebuffIds(build).has('legendary-ash')).toBe(true);
  });

  it('aggregateDebuffs with build picks up auto-applied Ash even when state is empty', () => {
    const build = buildWithAugment('Flamehorn');
    const out = aggregateDebuffs(initialDebuffState(), undefined, build);
    expect(out.effectiveMRR).toBe(-21);
  });

  it('build with no triggering gear yields no auto-apply', () => {
    const build: Build = { ...DEFAULT_BUILD, gearSets: [], activeGearSet: '' };
    expect(autoActiveDebuffIds(build).size).toBe(0);
  });
});

describe('averageStackFraction', () => {
  it('infinite fight = full stacks', () => {
    expect(averageStackFraction(40, Infinity)).toBe(1);
  });

  it('fight equal to ramp = 0.5 average', () => {
    // Linear ramp from 0 to full over [0, T]; average = T/(2T) = 0.5
    expect(averageStackFraction(40, 40)).toBeCloseTo(0.5, 5);
  });

  it('fight much shorter than ramp = small fraction', () => {
    // 5s of a 40s ramp → reaches 5/40 = 0.125 at end, average 0.0625
    expect(averageStackFraction(40, 5)).toBeCloseTo(0.0625, 5);
  });

  it('fight much longer than ramp = near-1.0', () => {
    // 60s fight, 40s ramp: 1 - 40/(2×60) = 0.667
    expect(averageStackFraction(40, 60)).toBeCloseTo(0.6667, 3);
    // 240s fight, 6s ramp: 1 - 6/480 = 0.9875
    expect(averageStackFraction(6, 240)).toBeCloseTo(0.9875, 4);
  });

  it('zero ramp = full stacks even on short fights', () => {
    expect(averageStackFraction(0, 5)).toBe(1);
  });
});

describe('aggregateDebuffs — ramping debuffs', () => {
  it('ramping debuff scales by averageStackFraction over fightSeconds', () => {
    // Legendary Ash: ramp 6s, magnitude -21 MRR.
    // Fight = 6s → average 0.5 → -10.5 MRR (rounded by addition).
    const state = enable(initialDebuffState(), 'legendary-ash');
    const out = aggregateDebuffs(state, undefined, undefined, 6);
    expect(out.effectiveMRR).toBeCloseTo(-21 * 0.5, 4);
  });

  it('instant debuffs ignore fightSeconds', () => {
    const state = enable(initialDebuffState(), 'curse-of-vulnerability');
    const out = aggregateDebuffs(state, undefined, undefined, 1);
    expect(out.genericVulnPct).toBe(20);
  });

  it('default (no fightSeconds) = steady-state full stacks', () => {
    const state = enable(initialDebuffState(), 'legendary-ash');
    expect(aggregateDebuffs(state).effectiveMRR).toBe(-21);
  });
});
