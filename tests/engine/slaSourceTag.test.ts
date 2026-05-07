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

  it('heroic enhancement trees use the scope letter E', () => {
    expect(deriveSlaTag('[E] Arcane Trickster: Stolen Spell I', 'enhancement')).toBe('E');
    expect(deriveSlaTag('[E] Mechanic: Tanglefoot', 'enhancement')).toBe('E');
    expect(deriveSlaTag('[E] Shadowdancer: Foo', 'enhancement')).toBe('E');
  });

  it('destiny trees use the scope letter D', () => {
    expect(deriveSlaTag('[D] Shiradi Champion: Friend or Foe → Magic Missile', 'enhancement')).toBe('D');
    expect(deriveSlaTag('[D] Fury of the Wild: Strength or Swiftness → Quick Cutter', 'enhancement')).toBe('D');
  });

  it('reaper trees use the scope letter R', () => {
    expect(deriveSlaTag('[R] Dire Thaumaturge: Foo', 'enhancement')).toBe('R');
  });

  it('gear-category SLAs tag as Gear', () => {
    expect(deriveSlaTag('[G] Trinket: Some Item', 'gear')).toBe('Gear');
    expect(deriveSlaTag('[A] Boots: Foo → Bar', 'gear')).toBe('Gear');
  });
});
