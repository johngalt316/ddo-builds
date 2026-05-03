import { describe, it, expect } from 'vitest';
import { calculateSaves } from '../../src/engine/saves';
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

describe('calculateSaves', () => {
  it('high fortitude save for fighter at level 1 is 2 + con mod', () => {
    const { fortitude } = calculateSaves([{ classId: 'fighter', levels: 1 }], [fighter], 14, 10, 10);
    // high(1) = 2 + floor(1/2) = 2 + 0 = 2, CON 14 = +2 mod → 4
    expect(fortitude).toBe(4);
  });

  it('low will save for fighter at level 4 is floor(4/3) + wis mod', () => {
    const { will } = calculateSaves([{ classId: 'fighter', levels: 4 }], [fighter], 10, 10, 10);
    // low(4) = floor(4/3) = 1, WIS 10 = 0 mod → 1
    expect(will).toBe(1);
  });

  it('high will save for wizard at level 4', () => {
    const { will } = calculateSaves([{ classId: 'wizard', levels: 4 }], [wizard], 10, 10, 10);
    // high(4) = 2 + floor(4/2) = 2 + 2 = 4, WIS 10 = 0 → 4
    expect(will).toBe(4);
  });

  it('multiclass combines both save progressions', () => {
    const saves = calculateSaves(
      [{ classId: 'fighter', levels: 4 }, { classId: 'wizard', levels: 4 }],
      [fighter, wizard],
      10, 10, 10,
    );
    // fortitude: high(4)=4 + low(4)=1 + con 0 = 5
    expect(saves.fortitude).toBe(5);
    // will: low(4)=1 + high(4)=4 + wis 0 = 5
    expect(saves.will).toBe(5);
  });
});
