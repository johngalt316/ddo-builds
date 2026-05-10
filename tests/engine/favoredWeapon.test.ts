// Verifies the favored-weapon resolution machinery:
//   1. Static weapon → group registry covers the catalog's weapon types.
//   2. Dynamic groups built from `AddGroupWeapon` augment static membership.
//   3. The "All" wildcard in dynamic groups makes every weapon match.
//
// Audit reference: docs/audits/slice-02-weapon-mechanics.md, Issue 3.

import { describe, it, expect } from 'vitest';
import { weaponInGroup, staticGroupsFor } from '@/engine/weaponGroups';

describe('weaponGroups — staticGroupsFor', () => {
  it('classifies handwraps as Unarmed / Light / Melee / Simple', () => {
    const groups = staticGroupsFor('Handwraps');
    expect(groups).toContain('Unarmed');
    expect(groups).toContain('Light');
    expect(groups).toContain('Melee');
    expect(groups).toContain('Simple');
  });

  it('classifies Great Sword as Two Handed / Sword / Heavy Blades / Martial / Slashing', () => {
    const groups = staticGroupsFor('Great Sword');
    expect(groups).toContain('Two Handed');
    expect(groups).toContain('Sword');
    expect(groups).toContain('Heavy Blades');
    expect(groups).toContain('Martial');
    expect(groups).toContain('Slashing');
    expect(groups).not.toContain('One Handed');
  });

  it('classifies Longbow as Ranged / Bows / Bow / Two Handed / Martial', () => {
    const groups = staticGroupsFor('Longbow');
    expect(groups).toContain('Ranged');
    expect(groups).toContain('Bows');
    expect(groups).toContain('Two Handed');
    expect(groups).toContain('Martial');
    expect(groups).not.toContain('Melee');
  });

  it('returns empty for unknown weapon types', () => {
    expect(staticGroupsFor('Plasma Cannon')).toEqual([]);
  });
});

describe('weaponGroups — weaponInGroup', () => {
  const noDyn = new Map<string, ReadonlySet<string>>();

  it('matches via static membership', () => {
    expect(weaponInGroup('Great Sword', 'Two Handed', noDyn)).toBe(true);
    expect(weaponInGroup('Handwraps',   'Unarmed',    noDyn)).toBe(true);
    expect(weaponInGroup('Longbow',     'Ranged',     noDyn)).toBe(true);
  });

  it('rejects when neither static nor dynamic match', () => {
    expect(weaponInGroup('Handwraps',   'Two Handed', noDyn)).toBe(false);
    expect(weaponInGroup('Great Sword', 'One Handed', noDyn)).toBe(false);
  });

  it('matches via dynamic group (Kensei "Focus Weapon" pattern)', () => {
    // Kensei Focus Weapon group with Bastard Sword + Khopesh selected.
    const dyn = new Map([['Focus Weapon', new Set(['Bastard Sword', 'Khopesh'])]]);
    expect(weaponInGroup('Bastard Sword', 'Focus Weapon', dyn)).toBe(true);
    expect(weaponInGroup('Khopesh',       'Focus Weapon', dyn)).toBe(true);
    expect(weaponInGroup('Long Sword',    'Focus Weapon', dyn)).toBe(false);
  });

  it('matches every weapon when the dynamic group includes "All"', () => {
    const dyn = new Map([['Favored Weapon', new Set(['All'])]]);
    expect(weaponInGroup('Bastard Sword', 'Favored Weapon', dyn)).toBe(true);
    expect(weaponInGroup('Handwraps',     'Favored Weapon', dyn)).toBe(true);
    expect(weaponInGroup('Plasma Cannon', 'Favored Weapon', dyn)).toBe(true);
  });

  it('static membership wins even when the dynamic map lacks the group', () => {
    const dyn = new Map([['Some Other Group', new Set(['Foo'])]]);
    expect(weaponInGroup('Great Sword', 'Two Handed', dyn)).toBe(true);
  });
});
