import { describe, it, expect } from 'vitest';
import { computeDefaultEnhancementTrees } from '@/utils/defaultEnhancementTrees';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build } from '@/types/build';
import type { DDOClassData, EnhancementTreeData } from '@/types/ddoData';

const ROGUE: DDOClassData = {
  name: 'Rogue', baseClass: null, description: '', smallIcon: '', largeIcon: '',
  hitDie: 6, skillPointsPerLevel: 8, classSkills: [],
  babPerLevel: [], fortSave: 'low', refSave: 'high', willSave: 'low',
  spellPointsPerLevel: [], castingStat: null, automaticFeats: [],
  featSlots: [], classSpecificFeatType: null,
};
const ARCANE_TRICKSTER: DDOClassData = {
  ...ROGUE, name: 'Arcane Trickster', baseClass: 'Rogue',
};
const FIGHTER: DDOClassData = {
  ...ROGUE, name: 'Fighter', baseClass: null, hitDie: 10,
};

const tree = (
  name: string,
  opts: Partial<EnhancementTreeData> = {},
): EnhancementTreeData => ({
  name, version: 1, icon: '', background: '',
  classReqs: [], raceReq: null,
  isUniversal: false, isRacialTree: false,
  isDestinyTree: false, isReaperTree: false,
  items: [],
  ...opts,
});

const TREES: EnhancementTreeData[] = [
  // Racial
  tree('Bladeforged', { isRacialTree: true }),
  tree('Eladrin',     { isRacialTree: true }),
  // Class-specific (Rogue)
  tree('Assassin',     { classReqs: [{ matchType: 'Class', className: 'Rogue' }] }),
  tree('Mechanic',     { classReqs: [{ matchType: 'Class', className: 'Rogue' }] }),
  tree('Thief Acrobat',{ classReqs: [{ matchType: 'Class', className: 'Rogue' }] }),
  // Prestige sharing base via BaseClass
  tree('Acrobat AT',   { classReqs: [{ matchType: 'BaseClass', className: 'Rogue' }] }),
  // Class (Fighter)
  tree('Stalwart Defender', { classReqs: [{ matchType: 'Class', className: 'Fighter' }] }),
  tree('Kensei',           { classReqs: [{ matchType: 'Class', className: 'Fighter' }] }),
  tree('Vanguard',         { classReqs: [{ matchType: 'Class', className: 'Fighter' }] }),
  tree('Tactician',        { classReqs: [{ matchType: 'Class', className: 'Fighter' }] }),
  // Universal — should not appear in defaults
  tree('Falconry', { isUniversal: true }),
  // Destiny / Reaper — should not appear
  tree('Fatesinger', { isDestinyTree: true }),
  tree('Dread Adversary', { isReaperTree: true }),
];

describe('computeDefaultEnhancementTrees', () => {
  it('returns race tree + top class\'s 3 trees', () => {
    const build: Build = {
      ...DEFAULT_BUILD,
      raceId: 'bladeforged',
      classes: [{ classId: 'fighter', levels: 20 }],
    };
    const defaults = computeDefaultEnhancementTrees(build, [FIGHTER], TREES);
    expect(defaults).toContain('Bladeforged');
    // Sorted alphabetically; 4 Fighter trees defined → take first 3
    const fighterPart = defaults.filter(n => n !== 'Bladeforged');
    expect(fighterPart).toHaveLength(3);
    // 4 Fighter trees, alphabetic sort, take first 3 → drops Vanguard.
    expect(fighterPart).toEqual(['Kensei', 'Stalwart Defender', 'Tactician']);
  });

  it('picks the class with the most levels for multiclass builds', () => {
    const build: Build = {
      ...DEFAULT_BUILD,
      raceId: 'bladeforged',
      classes: [
        { classId: 'fighter', levels: 2 },
        { classId: 'rogue',   levels: 18 },
      ],
    };
    const defaults = computeDefaultEnhancementTrees(build, [FIGHTER, ROGUE], TREES);
    expect(defaults).toContain('Bladeforged');
    // Rogue trees should appear, not Fighter trees
    expect(defaults).not.toContain('Kensei');
    // 4 Rogue-matching trees alphabetically, first 3 → 'Acrobat AT', 'Assassin', 'Mechanic'
    expect(defaults.filter(n => n !== 'Bladeforged')).toEqual(
      ['Acrobat AT', 'Assassin', 'Mechanic'],
    );
  });

  it('prestige class falls back to base-class trees via BaseClass requirement', () => {
    const build: Build = {
      ...DEFAULT_BUILD,
      raceId: 'bladeforged',
      classes: [{ classId: 'arcane_trickster', levels: 20 }],
    };
    const defaults = computeDefaultEnhancementTrees(
      build, [ROGUE, ARCANE_TRICKSTER], TREES,
    );
    // Should pick up trees with BaseClass=Rogue
    expect(defaults).toContain('Acrobat AT');
  });

  it('excludes universal, destiny, reaper trees', () => {
    const build: Build = {
      ...DEFAULT_BUILD,
      raceId: 'bladeforged',
      classes: [{ classId: 'rogue', levels: 20 }],
    };
    const defaults = computeDefaultEnhancementTrees(build, [ROGUE], TREES);
    expect(defaults).not.toContain('Falconry');
    expect(defaults).not.toContain('Fatesinger');
    expect(defaults).not.toContain('Dread Adversary');
  });

  it('returns [] when no game data is loaded', () => {
    expect(computeDefaultEnhancementTrees(DEFAULT_BUILD, [], [])).toEqual([]);
  });

  it('returns just the class trees if no race tree matches', () => {
    const build: Build = {
      ...DEFAULT_BUILD,
      raceId: 'unknown_race',
      classes: [{ classId: 'fighter', levels: 20 }],
    };
    const defaults = computeDefaultEnhancementTrees(build, [FIGHTER], TREES);
    // No race tree for 'unknown_race'
    expect(defaults).not.toContain('Bladeforged');
    expect(defaults).toHaveLength(3);
  });
});
