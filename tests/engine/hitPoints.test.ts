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
    expect(calculateHitPoints([{ classId: 'fighter', levels: 1 }], [fighter], 10)).toBe(10);
  });

  it('adds CON modifier per level', () => {
    // d10 * 5 = 50, CON 14 = +2 * 5 = +10 → 60
    expect(calculateHitPoints([{ classId: 'fighter', levels: 5 }], [fighter], 14)).toBe(60);
  });

  it('includes epic levels (10 HP/level + CON mod)', () => {
    // 20 fighter d10 = 200, CON 16 = +3 × (20+14) = 102, 14 epic × 10 = 140 → 442
    expect(calculateHitPoints(
      [{ classId: 'fighter', levels: 20 }],
      [fighter],
      16,
      14,
    )).toBe(200 + 140 + 3 * 34);
  });

  it('omitting epicLevels defaults to 0', () => {
    // No epic levels: 20 fighter, CON 14 → 200 + 2*20 = 240
    expect(calculateHitPoints(
      [{ classId: 'fighter', levels: 20 }],
      [fighter],
      14,
    )).toBe(240);
  });
});
