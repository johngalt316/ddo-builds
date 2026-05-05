// Phase 6.4.7a — debuff catalog + aggregator.

import { describe, it, expect } from 'vitest';
import {
  DEBUFF_CATALOG,
  aggregateDebuffs,
  initialDebuffState,
  type DebuffState,
} from '@/engine/dps/debuffs';

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
    });
  });
});
