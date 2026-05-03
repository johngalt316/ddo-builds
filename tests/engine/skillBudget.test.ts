import { describe, it, expect } from 'vitest';
import { calculateSkillPointBudget } from '../../src/engine/skills';
import type { DDOClass } from '../../src/types/gameData';

const fighter: DDOClass = {
  id: 'fighter', name: 'Fighter', description: '', hitDie: 10,
  babProgression: 'full', saveProgressions: { fortitude: 'high', reflex: 'low', will: 'low' },
  skillPointsPerLevel: 2, classSkills: [], spellcaster: false, spellcastingAbility: null,
  availableAlignments: [],
};
const rogue: DDOClass = {
  id: 'rogue', name: 'Rogue', description: '', hitDie: 6,
  babProgression: 'three_quarter', saveProgressions: { fortitude: 'low', reflex: 'high', will: 'low' },
  skillPointsPerLevel: 8, classSkills: [], spellcaster: false, spellcastingAbility: null,
  availableAlignments: [],
};

describe('calculateSkillPointBudget', () => {
  it('fighter level 1 with INT 10: 2 SP/level × 4 = 8', () => {
    const total = calculateSkillPointBudget(
      [{ classId: 'fighter', levels: 1 }],
      [fighter],
      0, // INT 10 → mod 0
    );
    // perLevel = max(1, 2 + 0) = 2; total = 2 + 3*2 (level-1 bonus) = 8
    expect(total).toBe(8);
  });

  it('fighter level 20 with INT 10: 2 SP/level × 20 + level-1 bonus 3×2 = 46', () => {
    const total = calculateSkillPointBudget(
      [{ classId: 'fighter', levels: 20 }],
      [fighter],
      0,
    );
    // base: 2 × 20 = 40; level-1 bonus: 2 × 3 = 6; total 46
    expect(total).toBe(46);
  });

  it('rogue level 20 with INT 18 (mod +4): 12 SP/level × 20 + level-1 bonus 36 = 276', () => {
    const total = calculateSkillPointBudget(
      [{ classId: 'rogue', levels: 20 }],
      [rogue],
      4,
    );
    // perLevel = max(1, 8 + 4) = 12; total = 12 × 20 + 12 × 3 = 240 + 36 = 276
    expect(total).toBe(276);
  });

  it('clamps SP/level to a minimum of 1 even with very negative INT mod', () => {
    const total = calculateSkillPointBudget(
      [{ classId: 'fighter', levels: 1 }],
      [fighter],
      -3, // INT 4: 2 + (-3) = -1 → clamped to 1
    );
    // perLevel = max(1, -1) = 1; total = 1 + 1*3 = 4
    expect(total).toBe(4);
  });

  it('multiclass: each class contributes its own SP/level; level-1 bonus from classes[0] only', () => {
    const total = calculateSkillPointBudget(
      [{ classId: 'fighter', levels: 4 }, { classId: 'rogue', levels: 4 }],
      [fighter, rogue],
      0,
    );
    // fighter 2×4 = 8, rogue 8×4 = 32, level-1 bonus from fighter: 2×3 = 6 → 46
    expect(total).toBe(46);
  });

  it('multiclass with rogue first: bigger level-1 bonus', () => {
    const total = calculateSkillPointBudget(
      [{ classId: 'rogue', levels: 4 }, { classId: 'fighter', levels: 4 }],
      [fighter, rogue],
      0,
    );
    // rogue 8×4 = 32, fighter 2×4 = 8, level-1 bonus from rogue: 8×3 = 24 → 64
    expect(total).toBe(64);
  });

  it('returns 0 for empty class list', () => {
    expect(calculateSkillPointBudget([], [], 0)).toBe(0);
  });

  it('skips classes not in classData rather than crashing', () => {
    expect(calculateSkillPointBudget(
      [{ classId: 'fake', levels: 5 }],
      [fighter],
      0,
    )).toBe(0);
  });
});
