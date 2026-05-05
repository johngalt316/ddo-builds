import { describe, it, expect } from 'vitest';
import { deriveSlaTag } from '../../src/engine/dps/abilities';

describe('deriveSlaTag', () => {
  it('past-life sources collapse to PL', () => {
    expect(deriveSlaTag('[PL] Past Life: Arcane Initiate', 'feat')).toBe('PL');
    expect(deriveSlaTag('[PL] Past Life: Arcane Initiate ×3', 'feat')).toBe('PL');
  });

  it('feat-category SLAs without [PL] prefix still tag PL', () => {
    expect(deriveSlaTag('Past Life: Arcane Initiate', 'feat')).toBe('PL');
  });

  it('multi-word heroic enhancement trees use initials', () => {
    expect(deriveSlaTag('[E] Arcane Trickster: Stolen Spell I', 'enhancement')).toBe('AT');
  });

  it('multi-word destinies use initials', () => {
    expect(deriveSlaTag('[D] Shiradi Champion: Friend or Foe → Magic Missile', 'enhancement')).toBe('SC');
  });

  it('multi-word reaper trees use initials', () => {
    expect(deriveSlaTag('[R] Dire Thaumaturge: Foo', 'enhancement')).toBe('DT');
  });

  it('single-word short tree names are kept whole', () => {
    expect(deriveSlaTag('[E] Mechanic: Tanglefoot', 'enhancement')).toBe('Mech');
  });

  it('single-word longer tree names truncate', () => {
    expect(deriveSlaTag('[E] Shadowdancer: Foo', 'enhancement')).toBe('Shad');
  });

  it('gear-category SLAs tag as Gear', () => {
    expect(deriveSlaTag('[G] Trinket: Some Item', 'gear')).toBe('Gear');
    expect(deriveSlaTag('[A] Boots: Foo → Bar', 'gear')).toBe('Gear');
  });

  it('caps initials at 4 chars for very long names', () => {
    expect(deriveSlaTag('[E] One Two Three Four Five: Foo', 'enhancement')).toBe('OTTF');
  });
});
