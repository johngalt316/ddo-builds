import { describe, it, expect } from 'vitest';
import { computeFeatSlots, groupSlotsByLevel, shortFeatType } from '@/utils/featSlots';
import type { DDOClassData, DDORaceData } from '@/types/ddoData';

const fighter: DDOClassData = {
  name: 'Fighter', baseClass: null, description: '', smallIcon: '', largeIcon: '',
  hitDie: 10, skillPointsPerLevel: 2, classSkills: [],
  babPerLevel: [], fortSave: 'high', refSave: 'low', willSave: 'low',
  spellPointsPerLevel: [], castingStat: null, automaticFeats: [],
  featSlots: [
    { level: 1, featType: 'Fighter Bonus Feat', options: ['Cleave', 'Power Attack'] },
    { level: 2, featType: 'Fighter Bonus Feat', options: ['Cleave', 'Power Attack'] },
    { level: 4, featType: 'Fighter Bonus Feat', options: ['Cleave', 'Power Attack'] },
  ],
  classSpecificFeatType: null,
};

const human: DDORaceData = {
  name: 'Human', shortName: 'Human', description: '',
  startingWorld: '', buildPoints: [], bonusSkillPoints: 1,
  featSlots: [
    { level: 1, featType: 'Human Bonus Feat', options: ['Cleave'] },
  ],
  pastLifeFeat: null,
};

describe('computeFeatSlots', () => {
  it('grants a Standard heroic slot at character level 1, 3, 6, 9, 12, 15, 18', () => {
    const slots = computeFeatSlots(
      [{ classId: 'fighter', levels: 20 }],
      [fighter],
      [human],
      'human',
    );
    const standardLevels = slots
      .filter(s => s.featType === 'Standard')
      .map(s => s.characterLevel)
      .sort((a, b) => a - b);
    expect(standardLevels).toEqual([1, 3, 6, 9, 12, 15, 18]);
  });

  it('grants a class slot at the Nth level of that class', () => {
    const slots = computeFeatSlots(
      [{ classId: 'fighter', levels: 5 }],
      [fighter],
      [human],
      'human',
    );
    const fighterSlots = slots.filter(s => s.featType === 'Fighter Bonus Feat');
    // Fighter has slots at class-level 1, 2, 4 → character levels 1, 2, 4
    expect(fighterSlots.map(s => s.characterLevel).sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });

  it('grants the race feat slot at character level 1 only', () => {
    const slots = computeFeatSlots(
      [{ classId: 'fighter', levels: 5 }],
      [fighter],
      [human],
      'human',
    );
    const racial = slots.filter(s => s.featType === 'Human Bonus Feat');
    expect(racial).toHaveLength(1);
    expect(racial[0]?.characterLevel).toBe(1);
  });

  it('multiclass: class slot fires at the Nth level of THAT class, not character level', () => {
    // Take 2 levels of Fighter at the END (positions 4 and 5).
    // Aggregation order from classes[]: rogue first, then fighter.
    // levelClasses derives as [rogue, rogue, rogue, fighter, fighter].
    // Fighter L1 slot fires at character level 4; Fighter L2 at 5.
    const rogue: DDOClassData = {
      ...fighter, name: 'Rogue', featSlots: [],
    };
    const slots = computeFeatSlots(
      [{ classId: 'rogue', levels: 3 }, { classId: 'fighter', levels: 2 }],
      [fighter, rogue],
      [human],
      'human',
    );
    const fighterSlots = slots
      .filter(s => s.featType === 'Fighter Bonus Feat')
      .map(s => s.characterLevel)
      .sort((a, b) => a - b);
    expect(fighterSlots).toEqual([4, 5]);
  });

  it('slot keys are deterministic and unique', () => {
    const slots = computeFeatSlots(
      [{ classId: 'fighter', levels: 5 }],
      [fighter],
      [human],
      'human',
    );
    const keys = slots.map(s => s.slotKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('groupSlotsByLevel', () => {
  it('groups by characterLevel preserving order within a level', () => {
    const slots = computeFeatSlots(
      [{ classId: 'fighter', levels: 1 }],
      [fighter],
      [human],
      'human',
    );
    const grouped = groupSlotsByLevel(slots);
    // Level 1 has Standard heroic + Human bonus + Fighter L1 bonus = 3 slots.
    expect(grouped.get(1)).toHaveLength(3);
  });
});

describe('shortFeatType', () => {
  it('Standard → S', () => expect(shortFeatType('Standard')).toBe('S'));
  it('Fighter Bonus Feat → F (drops "Bonus" + "Feat")', () =>
    expect(shortFeatType('Fighter Bonus Feat')).toBe('F'));
  it('Human Bonus Feat → H', () =>
    expect(shortFeatType('Human Bonus Feat')).toBe('H'));
  it('Wizard Metamagic → WM (caps two significant words)', () =>
    expect(shortFeatType('Wizard Metamagic')).toBe('WM'));
});
