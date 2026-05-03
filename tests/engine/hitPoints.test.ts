import { describe, it, expect } from 'vitest';
import { calculateHitPoints } from '../../src/engine/hitPoints';
import type { DDOClass } from '../../src/types/gameData';

const fighter: DDOClass = {
  id: 'fighter', name: 'Fighter', description: '', hitDie: 10,
  babProgression: 'full', saveProgressions: { fortitude: 'high', reflex: 'low', will: 'low' },
  skillPointsPerLevel: 2, classSkills: [], spellcaster: false, spellcastingAbility: null,
  availableAlignments: [],
};

describe('calculateHitPoints', () => {
  it('pure fighter level 1 with neutral CON', () => {
    // d10 * 1 + CON 10 mod 0 = 10
    expect(calculateHitPoints([{ classId: 'fighter', levels: 1 }], [fighter], 10, [])).toBe(10);
  });

  it('adds CON modifier per level', () => {
    // d10 * 5 = 50, CON 14 = +2 * 5 = +10 → 60
    expect(calculateHitPoints([{ classId: 'fighter', levels: 5 }], [fighter], 14, [])).toBe(60);
  });

  it('toughness adds 3 + 1 per level', () => {
    // d10 * 2 = 20, CON 10 = 0, toughness 1 stack = 3 + (2*1 per level) ... wait
    // toughness: count * (3 + totalLevels)
    // 1 toughness, 2 levels: 1 * (3 + 2) = 5
    expect(calculateHitPoints(
      [{ classId: 'fighter', levels: 2 }],
      [fighter],
      10,
      [{ slotIndex: 0, featId: 'toughness' }],
    )).toBe(20 + 5); // 25
  });
});
