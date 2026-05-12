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
    mainHandWeapon: '',
    offHandWeapon: '',
    dynamicWeaponGroups: new Map(),
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

describe('passesRequirements — <Type>GroupMember</Type>', () => {
  it('passes when the mainhand weapon\'s static group includes the item', () => {
    // Handwraps → [Unarmed, Light, Melee, Simple]
    const ctx = ctxWith({ mainHandWeapon: 'Handwraps' });
    expect(passesRequirements(reqs('GroupMember', 'Unarmed', 0), ctx)).toBe(true);
    expect(passesRequirements(reqs('GroupMember', 'Melee',   0), ctx)).toBe(true);
  });

  it('fails when the mainhand weapon does not belong to the group', () => {
    // Handwraps are not Slashing in our static registry.
    const ctx = ctxWith({ mainHandWeapon: 'Handwraps' });
    expect(passesRequirements(reqs('GroupMember', 'Slashing', 0), ctx)).toBe(false);
    expect(passesRequirements(reqs('GroupMember', 'Bow',      0), ctx)).toBe(false);
  });

  it('passes when the group is a dynamic group that includes the weapon', () => {
    // Simulate Kensei's AddGroupWeapon: Focus Weapon = { Falchion }
    const dyn = new Map<string, Set<string>>([['Focus Weapon', new Set(['Falchion'])]]);
    const ctx = ctxWith({
      mainHandWeapon: 'Falchion',
      dynamicWeaponGroups: dyn,
    });
    expect(passesRequirements(reqs('GroupMember', 'Focus Weapon', 0), ctx)).toBe(true);
  });

  it('fails when the dynamic group does not include the wielded weapon', () => {
    const dyn = new Map<string, Set<string>>([['Focus Weapon', new Set(['Falchion'])]]);
    const ctx = ctxWith({
      mainHandWeapon: 'Khopesh',
      dynamicWeaponGroups: dyn,
    });
    expect(passesRequirements(reqs('GroupMember', 'Focus Weapon', 0), ctx)).toBe(false);
  });

  it('passes via the dynamic "All" wildcard regardless of weapon', () => {
    // Favored Weapon enhancements with universal grants use the All sentinel.
    const dyn = new Map<string, Set<string>>([['Favored Weapon', new Set(['All'])]]);
    const ctx = ctxWith({
      mainHandWeapon: 'Falchion',
      dynamicWeaponGroups: dyn,
    });
    expect(passesRequirements(reqs('GroupMember', 'Favored Weapon', 0), ctx)).toBe(true);
  });

  it('fails for any group when nothing is equipped', () => {
    // Empty mainhand can't satisfy any group — neither static nor dynamic.
    const ctx = ctxWith({ mainHandWeapon: '' });
    expect(passesRequirements(reqs('GroupMember', 'Melee', 0), ctx)).toBe(false);
  });
});

describe('passesRequirements — <Type>GroupMember2</Type>', () => {
  it('checks the offhand weapon, not mainhand', () => {
    // Mainhand handwraps would satisfy "Unarmed", but the OFFhand is empty.
    const ctx = ctxWith({
      mainHandWeapon: 'Handwraps',
      offHandWeapon:  '',
    });
    expect(passesRequirements(reqs('GroupMember2', 'Unarmed', 0), ctx)).toBe(false);
  });

  it('passes when the offhand weapon is in the named group', () => {
    // Dual short swords: offhand is a Short Sword.
    const ctx = ctxWith({
      mainHandWeapon: 'Shortsword',
      offHandWeapon:  'Shortsword',
    });
    // Shortsword → ['One Handed', 'Piercing', 'Martial', 'Melee', 'Sword', ...]
    expect(passesRequirements(reqs('GroupMember2', 'One Handed', 0), ctx)).toBe(true);
  });
});
