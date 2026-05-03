import { describe, it, expect } from 'vitest';
import { applyAbilityTomes, applyLevelUps } from '../../src/engine/abilityScores';

const BASE = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };

describe('applyAbilityTomes', () => {
  it('adds the tome bonus to each stat', () => {
    expect(applyAbilityTomes(BASE, { STR: 4, CON: 2 })).toEqual({
      ...BASE, STR: 14, CON: 12,
    });
  });

  it('returns the input unchanged when tomes is undefined', () => {
    expect(applyAbilityTomes(BASE, undefined)).toEqual(BASE);
  });

  it('skips entries with non-numeric values', () => {
    // @ts-expect-error — runtime tolerance test
    expect(applyAbilityTomes(BASE, { STR: '4' })).toEqual(BASE);
  });
});

describe('applyLevelUps', () => {
  it('adds +1 per assigned tier', () => {
    expect(applyLevelUps(BASE, { 4: 'STR', 8: 'STR', 12: 'CON' })).toEqual({
      ...BASE, STR: 12, CON: 11,
    });
  });

  it('returns the input unchanged when levelUps is undefined', () => {
    expect(applyLevelUps(BASE, undefined)).toEqual(BASE);
  });

  it('ignores undefined entries', () => {
    expect(applyLevelUps(BASE, { 4: undefined })).toEqual(BASE);
  });
});

describe('tome + level-up composition', () => {
  it('+8 STR tome + STR level-up at 20 lifts STR by 9 from base', () => {
    const afterTomes = applyAbilityTomes(BASE, { STR: 8 });
    const final = applyLevelUps(afterTomes, { 20: 'STR' });
    expect(final.STR).toBe(19);
  });
});
