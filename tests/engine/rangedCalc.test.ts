// Unit tests for the ranged DPS MVP.
//
// Strategy mirrors the melee tests: synthesize a weapon + stats block,
// run rangedDPS, and check key invariants. The exact damage numbers
// would change with table-tuning passes; what we lock down is structural
// behavior (Doubleshot scales APM, crit math, alacrity cap, category
// classification, no-weapon empty state).

import { describe, it, expect } from 'vitest';
import {
  rangedCategoryFromName, rangedBaseAPM, rangedAttacksPerMin,
  rangedDPS, rangedWeaponInfoFromGearItem,
  type RangedWeaponInfo, type RangedBuildStats,
} from '@/engine/dps/rangedCalc';
import type { GearItem } from '@/types/build';

function weapon(over: Partial<RangedWeaponInfo> = {}): RangedWeaponInfo {
  return {
    name: 'Test Bow',
    weaponType: 'Longbow',
    category: 'bow',
    wScalar: 1,
    diceNum: 1,
    diceSides: 8,
    diceBonus: 0,
    enchantBonus: 5,
    critThreatBase: 1,
    critMultiplier: 3,
    attackStat: 'Dexterity',
    ...over,
  };
}

function stats(over: Partial<RangedBuildStats> = {}): RangedBuildStats {
  return {
    statMod: 10,
    damageStat: 'DEX',
    rangedPower: 100,
    doubleshot: 0,
    rangedAlacrity: 0,
    actionBoostAlacrity: 0,
    seeker: 0,
    hasImprovedCritical: false,
    critRangeBonus: 0,
    critMultBonus: 0,
    critMult1920Bonus: 0,
    wBonus: 0,
    flatDmgBonus: 0,
    physDamagePct: 0,
    ...over,
  };
}

describe('rangedCategoryFromName', () => {
  it('classifies the five ranged categories from common names', () => {
    expect(rangedCategoryFromName('Longbow')).toBe('bow');
    expect(rangedCategoryFromName('Shortbow')).toBe('bow');
    expect(rangedCategoryFromName('Heavy Crossbow')).toBe('crossbow');
    expect(rangedCategoryFromName('Light Crossbow')).toBe('crossbow');
    expect(rangedCategoryFromName('Great Crossbow')).toBe('great-crossbow');
    expect(rangedCategoryFromName('Greatbow')).toBe('bow');
    expect(rangedCategoryFromName('Repeating Light Crossbow')).toBe('repeating-crossbow');
    expect(rangedCategoryFromName('Repeating Heavy Crossbow')).toBe('repeating-crossbow');
    expect(rangedCategoryFromName('Throwing Axe')).toBe('thrown');
    expect(rangedCategoryFromName('Shuriken')).toBe('thrown');
    expect(rangedCategoryFromName('Dart')).toBe('thrown');
  });

  it('returns null for non-ranged weapons (melee falls through)', () => {
    expect(rangedCategoryFromName('Handwraps')).toBe(null);
    expect(rangedCategoryFromName('Great Sword')).toBe(null);
    expect(rangedCategoryFromName('Quarterstaff')).toBe(null);
  });

  it('routes "Repeating ..." before plain "Crossbow"', () => {
    // A repeating heavy crossbow contains both "repeating" and "crossbow"
    // keywords — the repeating-crossbow branch must win for correct APM.
    expect(rangedCategoryFromName('Repeating Heavy Crossbow')).toBe('repeating-crossbow');
  });
});

describe('rangedBaseAPM', () => {
  it('returns positive APMs for each ranged category', () => {
    expect(rangedBaseAPM('bow')).toBeGreaterThan(0);
    expect(rangedBaseAPM('crossbow')).toBeGreaterThan(0);
    expect(rangedBaseAPM('repeating-crossbow')).toBeGreaterThan(0);
    expect(rangedBaseAPM('thrown')).toBeGreaterThan(0);
  });

  it('applies passive alacrity multiplicatively, capped at 15%', () => {
    const base = rangedBaseAPM('bow');
    expect(rangedAttacksPerMin('bow', 0)).toBe(base);
    expect(rangedAttacksPerMin('bow', 15)).toBeCloseTo(base * 1.15);
    // Over-cap clamps to 15%
    expect(rangedAttacksPerMin('bow', 30)).toBeCloseTo(base * 1.15);
    // Negative alacrity floors at 0
    expect(rangedAttacksPerMin('bow', -5)).toBe(base);
  });
});

describe('rangedDPS — base mechanics', () => {
  it('produces nonzero DPS with sensible inputs', () => {
    const r = rangedDPS(weapon(), stats());
    expect(r.totalAutoDPS).toBeGreaterThan(0);
    expect(r.avgPerHit).toBeGreaterThan(0);
    expect(r.apm).toBeGreaterThan(0);
  });

  it('Doubleshot scales effective shots multiplicatively', () => {
    const noDs = rangedDPS(weapon(), stats({ doubleshot: 0 }));
    const ds50 = rangedDPS(weapon(), stats({ doubleshot: 50 }));
    // 50% doubleshot means each shot has a 50% chance of an extra
    // projectile → 1.5× effective rate.
    expect(ds50.effectivePerMin).toBeCloseTo(noDs.effectivePerMin * 1.5);
    expect(ds50.totalAutoDPS).toBeCloseTo(noDs.totalAutoDPS * 1.5);
  });

  it('Improved Critical doubles base threat range before flat bonuses', () => {
    // Longbow base crit range 1 (20-only). With IC → 2 (19-20). Plus
    // +1 flat from a feat → 3 (18-20).
    const r = rangedDPS(
      weapon({ critThreatBase: 1 }),
      stats({ hasImprovedCritical: true, critRangeBonus: 1 }),
    );
    expect(r.critThreatFaces).toBe(3);
    expect(r.critChance).toBeCloseTo(3 / 20);
  });

  it('passive alacrity caps at 15%; action-boost stacks on top', () => {
    const a = rangedDPS(weapon(), stats({ rangedAlacrity: 0, actionBoostAlacrity: 0 }));
    const b = rangedDPS(weapon(), stats({ rangedAlacrity: 15, actionBoostAlacrity: 0 }));
    const c = rangedDPS(weapon(), stats({ rangedAlacrity: 100, actionBoostAlacrity: 0 }));
    const d = rangedDPS(weapon(), stats({ rangedAlacrity: 15, actionBoostAlacrity: 30 }));
    expect(b.apm).toBeCloseTo(a.apm * 1.15);
    // Over-cap passive: clamps to 15%
    expect(c.apm).toBeCloseTo(b.apm);
    // Boost layered on capped passive: ×1.30 on top
    expect(d.apm).toBeCloseTo(b.apm * 1.30);
  });

  it('Ranged Power scales avgPerHit linearly', () => {
    const rp0   = rangedDPS(weapon(), stats({ rangedPower: 0 }));
    const rp100 = rangedDPS(weapon(), stats({ rangedPower: 100 }));
    expect(rp100.avgPerHit).toBeCloseTo(rp0.avgPerHit * 2);
  });
});

describe('rangedWeaponInfoFromGearItem', () => {
  function item(over: Partial<GearItem> = {}): GearItem {
    return {
      slot: 'MainHand',
      name: 'Test',
      icon: '',
      buffs: [],
      weapon: 'Longbow',
      baseDice: { number: 1, sides: 8 },
      weaponDamage: 1,
      criticalThreatRange: 1,
      criticalMultiplier: 3,
      ...over,
    };
  }

  it('builds info from a longbow gear item with DEX default attack stat', () => {
    const wi = rangedWeaponInfoFromGearItem(item());
    expect(wi).not.toBeNull();
    expect(wi!.category).toBe('bow');
    expect(wi!.attackStat).toBe('Dexterity');
  });

  it('returns null for melee weapons (Handwraps, Great Sword)', () => {
    expect(rangedWeaponInfoFromGearItem(item({ weapon: 'Handwraps', baseDice: { number: 1, sides: 6 } }))).toBeNull();
    expect(rangedWeaponInfoFromGearItem(item({ weapon: 'Great Sword', baseDice: { number: 2, sides: 6 } }))).toBeNull();
  });

  it('returns null when the item has no weapon field', () => {
    expect(rangedWeaponInfoFromGearItem(item({ weapon: undefined }))).toBeNull();
  });

  it('honors attackModifier override (mighty composite bow → STR)', () => {
    const wi = rangedWeaponInfoFromGearItem(item({
      weapon: 'Longbow', attackModifier: 'Strength',
    }));
    expect(wi!.attackStat).toBe('Strength');
  });
});
