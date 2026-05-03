import { describe, it, expect } from 'vitest';
import { abilityModifier, pointBuyCost, totalPointBuyCost, applyRacialBonuses } from '../../src/engine/abilityScores';
import type { AbilityScores } from '../../src/types/build';
import type { Race } from '../../src/types/gameData';

describe('abilityModifier', () => {
  it('returns 0 for score 10', () => expect(abilityModifier(10)).toBe(0));
  it('returns 0 for score 11', () => expect(abilityModifier(11)).toBe(0));
  it('returns 1 for score 12', () => expect(abilityModifier(12)).toBe(1));
  it('returns 1 for score 13', () => expect(abilityModifier(13)).toBe(1));
  it('returns 4 for score 18', () => expect(abilityModifier(18)).toBe(4));
  it('returns -1 for score 8', () => expect(abilityModifier(8)).toBe(-1));
  it('returns -1 for score 9', () => expect(abilityModifier(9)).toBe(-1));
  it('returns -5 for score 1', () => expect(abilityModifier(1)).toBe(-5));
  it('returns 5 for score 20', () => expect(abilityModifier(20)).toBe(5));
});

describe('pointBuyCost', () => {
  it('costs 0 for score 8',  () => expect(pointBuyCost(8)).toBe(0));
  it('costs 6 for score 14', () => expect(pointBuyCost(14)).toBe(6));
  it('costs 16 for score 18',() => expect(pointBuyCost(18)).toBe(16));
});

describe('totalPointBuyCost', () => {
  it('costs 0 for all 8s', () => {
    const scores: AbilityScores = { STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 };
    expect(totalPointBuyCost(scores)).toBe(0);
  });

  it('tallies individual costs correctly', () => {
    const scores: AbilityScores = { STR: 14, DEX: 14, CON: 14, INT: 8, WIS: 8, CHA: 8 };
    expect(totalPointBuyCost(scores)).toBe(18); // 6 + 6 + 6
  });
});

describe('applyRacialBonuses', () => {
  const base: AbilityScores = { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };

  it('applies a positive racial bonus', () => {
    const dwarf = { abilityBonuses: { CON: 2, CHA: -2 } } as unknown as Race;
    const result = applyRacialBonuses(base, dwarf);
    expect(result.CON).toBe(12);
    expect(result.CHA).toBe(8);
    expect(result.STR).toBe(10);
  });

  it('applies any-stat bonus to specified stat', () => {
    const human = { abilityBonuses: { any: 2 } } as unknown as Race;
    const result = applyRacialBonuses(base, human, 'STR');
    expect(result.STR).toBe(12);
    expect(result.DEX).toBe(10);
  });

  it('applies no any-stat bonus when no choice is given', () => {
    const human = { abilityBonuses: { any: 2 } } as unknown as Race;
    const result = applyRacialBonuses(base, human);
    expect(result.STR).toBe(10);
  });
});
