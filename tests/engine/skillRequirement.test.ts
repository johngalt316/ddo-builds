// Verifies the requirement-gating cases in `passesRequirement`:
//   - <Type>Skill</Type>  — Slice 1, Issue 1
//   - <Type>BAB</Type>    — Slice 5
// These were both silently passing because the switch had no cases for
// them, and the default branch returns true. Each gate now correctly
// blocks effects when the build doesn't qualify.

import { describe, it, expect } from 'vitest';
import { passesRequirements } from '@/engine/evaluateEffect';
import type { BuildContext } from '@/engine/evaluateEffect';
import type { DDORequirements } from '@/types/ddoData';

function ctxWith(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    totalLevel: 20,
    classLevels: new Map(),
    baseClassLevels: new Map(),
    raceId: 'human',
    raceName: 'Human',
    feats: new Set(),
    abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    bab: 15,
    apSpentInTree: new Map(),
    activeStances: new Set(),
    skillRanks: new Map(),
    ...overrides,
  };
}

function ctxWithSkills(skillRanks: Record<string, number> = {}): BuildContext {
  return ctxWith({ skillRanks: new Map(Object.entries(skillRanks)) });
}

function reqs(type: string, item: string, value: number): DDORequirements {
  return { allOf: [{ type, item, value }] };
}

describe('passesRequirements — <Type>Skill</Type>', () => {
  it('passes when ranks meet the threshold', () => {
    const ctx = ctxWithSkills({ perform: 8 });
    expect(passesRequirements(reqs('Skill', 'Perform', 4), ctx)).toBe(true);
    expect(passesRequirements(reqs('Skill', 'Perform', 8), ctx)).toBe(true);
  });

  it('fails when ranks fall short', () => {
    const ctx = ctxWithSkills({ perform: 3 });
    expect(passesRequirements(reqs('Skill', 'Perform', 4), ctx)).toBe(false);
  });

  it('fails when the skill is untrained (missing key)', () => {
    const ctx = ctxWithSkills({});
    expect(passesRequirements(reqs('Skill', 'Perform', 1), ctx)).toBe(false);
  });

  it('fails when ranks are 0 explicitly', () => {
    // buildBuildContext omits 0-rank skills, but the check should be
    // defensive against either representation.
    const ctx = ctxWithSkills({ perform: 0 });
    expect(passesRequirements(reqs('Skill', 'Perform', 1), ctx)).toBe(false);
  });

  it('normalizes display names to lowercase snake_case skill ids', () => {
    const ctx = ctxWithSkills({ use_magic_device: 5, disable_device: 3 });
    expect(passesRequirements(reqs('Skill', 'Use Magic Device', 5), ctx)).toBe(true);
    expect(passesRequirements(reqs('Skill', 'Disable Device', 4), ctx)).toBe(false);
  });
});

describe('passesRequirements — <Type>BAB</Type>', () => {
  it('passes when the build BAB meets the threshold', () => {
    const ctx = ctxWith({ bab: 12 });
    expect(passesRequirements(reqs('BAB', '', 8),  ctx)).toBe(true);
    expect(passesRequirements(reqs('BAB', '', 12), ctx)).toBe(true);
  });

  it('fails when BAB falls short', () => {
    const ctx = ctxWith({ bab: 6 });
    expect(passesRequirements(reqs('BAB', '', 8), ctx)).toBe(false);
  });

  it('passes when value is 0 (no real threshold)', () => {
    const ctx = ctxWith({ bab: 0 });
    expect(passesRequirements(reqs('BAB', '', 0), ctx)).toBe(true);
  });
});
