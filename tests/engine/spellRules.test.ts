// Phase 6.4.2 — projectile count + per-projectile damage rules.
//
// Expected values are derived directly from ddowiki.com — wiki-canonical
// at clean caster levels — so the tests pass regardless of any specific
// build's spell power, crit, or enhancement bonuses.

import { describe, it, expect } from 'vitest';
import {
  projectileCount,
  avgPerHit,
  avgFromXmlDice,
  hasSpellRule,
} from '@/engine/dps/spellRules';
import type { DDOSpellDice } from '@/types/ddoData';

const dice = (
  number: number, sides: number, bonus = 0,
  perCasterLevels?: number, cap?: number,
): DDOSpellDice => ({ number, sides, bonus, perCasterLevels, cap });

describe('projectileCount — Magic Missile', () => {
  it('1 missile at CL 1', () => expect(projectileCount('Magic Missile', 1)).toBe(1));
  it('2 missiles at CL 3',  () => expect(projectileCount('Magic Missile', 3)).toBe(2));
  it('3 missiles at CL 5',  () => expect(projectileCount('Magic Missile', 5)).toBe(3));
  it('4 missiles at CL 7',  () => expect(projectileCount('Magic Missile', 7)).toBe(4));
  it('5 missiles at CL 9',  () => expect(projectileCount('Magic Missile', 9)).toBe(5));
  it('caps at 5 at CL 20',  () => expect(projectileCount('Magic Missile', 20)).toBe(5));
});

describe('projectileCount — Force Missiles', () => {
  it('1 missile at CL 1',  () => expect(projectileCount('Force Missiles', 1)).toBe(1));
  it('1 missile at CL 3',  () => expect(projectileCount('Force Missiles', 3)).toBe(1));
  it('2 missiles at CL 4', () => expect(projectileCount('Force Missiles', 4)).toBe(2));
  it('3 missiles at CL 8', () => expect(projectileCount('Force Missiles', 8)).toBe(3));
  it('4 missiles at CL 12', () => expect(projectileCount('Force Missiles', 12)).toBe(4));
  it('caps at 4 at CL 20', () => expect(projectileCount('Force Missiles', 20)).toBe(4));
});

describe('projectileCount — Scorching Ray', () => {
  it('1 ray at CL 6',  () => expect(projectileCount('Scorching Ray', 6)).toBe(1));
  it('2 rays at CL 7', () => expect(projectileCount('Scorching Ray', 7)).toBe(2));
  it('2 rays at CL 10', () => expect(projectileCount('Scorching Ray', 10)).toBe(2));
  it('3 rays at CL 11', () => expect(projectileCount('Scorching Ray', 11)).toBe(3));
  it('caps at 3 at CL 20', () => expect(projectileCount('Scorching Ray', 20)).toBe(3));
});

describe('projectileCount — fallback', () => {
  it('returns 1 for spells without an explicit rule', () => {
    expect(projectileCount('Fireball', 20)).toBe(1);
    expect(projectileCount('Disintegrate', 20)).toBe(1);
  });
});

describe('avgPerHit — Magic Missile', () => {
  // 1d2 averages 1.5; bonus = 3 at CL1, then 3 + floor(CL/2) for CL >= 2.
  const mmDice = dice(1, 2, 3, 2);  // (irrelevant; rule overrides)

  it('1d2+3 at CL 1 (avg 4.5)',  () => expect(avgPerHit('Magic Missile', mmDice, 1, 20)).toBe(4.5));
  it('1d2+4 at CL 2 (avg 5.5)',  () => expect(avgPerHit('Magic Missile', mmDice, 2, 20)).toBe(5.5));
  it('1d2+5 at CL 4 (avg 6.5)',  () => expect(avgPerHit('Magic Missile', mmDice, 4, 20)).toBe(6.5));
  it('1d2+7 at CL 9 (avg 8.5)',  () => expect(avgPerHit('Magic Missile', mmDice, 9, 20)).toBe(8.5));
  it('1d2+13 at CL 20 (avg 14.5)', () => expect(avgPerHit('Magic Missile', mmDice, 20, 20)).toBe(14.5));
});

describe('avgPerHit — Force Missiles', () => {
  // 1d4+1 averages 3.5; floor(CL/2) sets per missile, MCL 12.
  const fmDice = dice(1, 4, 1, 2);
  it('1d4+1 at CL 2 (avg 3.5)',   () => expect(avgPerHit('Force Missiles', fmDice, 2, 12)).toBe(3.5));
  it('2d4+2 at CL 4 (avg 7.0)',   () => expect(avgPerHit('Force Missiles', fmDice, 4, 12)).toBe(7));
  it('4d4+4 at CL 8 (avg 14.0)',  () => expect(avgPerHit('Force Missiles', fmDice, 8, 12)).toBe(14));
  it('6d4+6 at CL 12 (avg 21.0)', () => expect(avgPerHit('Force Missiles', fmDice, 12, 12)).toBe(21));
  it('still 6d4+6 above MCL 12',  () => expect(avgPerHit('Force Missiles', fmDice, 20, 12)).toBe(21));
});

describe('avgPerHit — Scorching Ray', () => {
  // 1d6+6 averages 9.5; floor(CL/2) sets per ray, capped at 10 sets.
  const srDice = dice(1, 6, 6, 2);
  it('1d6+6 at CL 2 (avg 9.5)',     () => expect(avgPerHit('Scorching Ray', srDice, 2, 20)).toBe(9.5));
  it('3d6+18 at CL 6 (avg 28.5)',   () => expect(avgPerHit('Scorching Ray', srDice, 6, 20)).toBe(28.5));
  it('5d6+30 at CL 11 (avg 47.5)',  () => expect(avgPerHit('Scorching Ray', srDice, 11, 20)).toBe(47.5));
  it('10d6+60 at CL 20 (avg 95.0)', () => expect(avgPerHit('Scorching Ray', srDice, 20, 20)).toBe(95));
});

describe('avgFromXmlDice — standard spells', () => {
  it('Fireball: 1d6 per CL, capped at 10 dice (avg 35 at cap)', () => {
    const d = dice(1, 6, 0, 1, 10);
    expect(avgFromXmlDice(d, 20, 20)).toBe(35);
    expect(avgFromXmlDice(d, 5, 20)).toBe(17.5);   // 5d6 avg
  });

  it('Shocking Grasp: 1d6+1 per CL, capped at MCL=5', () => {
    const d = dice(1, 6, 1, 1);
    expect(avgFromXmlDice(d, 5, 5)).toBe(22.5);   // 5×(3.5+1) = 22.5
    expect(avgFromXmlDice(d, 20, 5)).toBe(22.5);  // MCL caps
  });

  it('flat-damage spell (no perCasterLevels) applies once', () => {
    const d = dice(1, 4, 1);  // 1d4+1, no scaling
    expect(avgFromXmlDice(d, 20, 20)).toBe(3.5);
  });
});

describe('hasSpellRule', () => {
  it('flags the three multi-projectile spells', () => {
    expect(hasSpellRule('Magic Missile')).toBe(true);
    expect(hasSpellRule('Force Missiles')).toBe(true);
    expect(hasSpellRule('Scorching Ray')).toBe(true);
  });
  it('no override for standard spells', () => {
    expect(hasSpellRule('Fireball')).toBe(false);
  });
});
