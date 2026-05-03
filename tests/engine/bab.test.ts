import { describe, it, expect } from 'vitest';
import { calculateBAB } from '../../src/engine/bab';
import type { DDOClass } from '../../src/types/gameData';

const fighter: DDOClass = {
  id: 'fighter', name: 'Fighter', description: '', hitDie: 10,
  babProgression: 'full', saveProgressions: { fortitude: 'high', reflex: 'low', will: 'low' },
  skillPointsPerLevel: 2, classSkills: [], spellcaster: false, spellcastingAbility: null,
  availableAlignments: [],
};
const wizard: DDOClass = {
  id: 'wizard', name: 'Wizard', description: '', hitDie: 6,
  babProgression: 'half', saveProgressions: { fortitude: 'low', reflex: 'low', will: 'high' },
  skillPointsPerLevel: 2, classSkills: [], spellcaster: true, spellcastingAbility: 'INT',
  availableAlignments: [],
};
const rogue: DDOClass = {
  id: 'rogue', name: 'Rogue', description: '', hitDie: 6,
  babProgression: 'three_quarter', saveProgressions: { fortitude: 'low', reflex: 'high', will: 'low' },
  skillPointsPerLevel: 8, classSkills: [], spellcaster: false, spellcastingAbility: null,
  availableAlignments: [],
};

describe('calculateBAB', () => {
  it('full BAB = level for fighter', () => {
    expect(calculateBAB([{ classId: 'fighter', levels: 10 }], [fighter])).toBe(10);
  });

  it('half BAB floors for wizard', () => {
    expect(calculateBAB([{ classId: 'wizard', levels: 7 }], [wizard])).toBe(3);
  });

  it('three-quarter BAB for rogue', () => {
    expect(calculateBAB([{ classId: 'rogue', levels: 8 }], [rogue])).toBe(6);
  });

  it('sums BAB for multiclass build', () => {
    // fighter 12 (BAB 12) + wizard 8 (BAB 4) = 16
    expect(calculateBAB(
      [{ classId: 'fighter', levels: 12 }, { classId: 'wizard', levels: 8 }],
      [fighter, wizard],
    )).toBe(16);
  });

  it('returns 0 for empty class list', () => {
    expect(calculateBAB([], [fighter])).toBe(0);
  });
});
