import { describe, it, expect } from 'vitest';
import {
  stackBonuses,
  stackBonusesByTarget,
  buildStackingRules,
} from '@/engine/bonusStacking';
import type { Bonus } from '@/engine/bonusStacking';

const RULES = buildStackingRules([
  { name: 'Insight',     stacking: 'Highest Only' },
  { name: 'Enhancement', stacking: 'Highest Only' },
  { name: 'Feat',        stacking: 'Highest Only' },
  { name: 'Stacking',    stacking: 'Always' },
  { name: 'Destiny',     stacking: 'Always' },
  { name: 'Equipment',   stacking: 'Highest Only' },
]);

function b(bonusType: string, value: number, source: string, target?: string): Bonus {
  return { bonusType, value, source, target };
}

describe('stackBonuses', () => {
  it('untyped bonuses always stack', () => {
    const r = stackBonuses(
      [b('', 2, 'A'), b('', 3, 'B'), b('', 5, 'C')],
      RULES,
    );
    expect(r.total).toBe(10);
    expect(r.contributors.every(c => c.applied)).toBe(true);
  });

  it('Highest Only: only the largest positive applies', () => {
    const r = stackBonuses(
      [b('Insight', 2, 'cheap item'), b('Insight', 5, 'good item'), b('Insight', 3, 'mid item')],
      RULES,
    );
    expect(r.total).toBe(5);
    const applied = r.contributors.filter(c => c.applied);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.source).toBe('good item');
    expect(r.contributors.filter(c => !c.applied).map(c => c.dominatedBy)).toEqual([
      'good item', 'good item',
    ]);
  });

  it('Highest Only: penalties always stack alongside the winning positive', () => {
    const r = stackBonuses(
      [
        b('Enhancement', 4, 'enhancement A'),
        b('Enhancement', 6, 'enhancement B'),
        b('Enhancement', -2, 'penalty'),
      ],
      RULES,
    );
    expect(r.total).toBe(6 - 2);
    expect(r.contributors.filter(c => c.applied)).toHaveLength(2);
  });

  it('Always: all sum regardless of type clash', () => {
    const r = stackBonuses(
      [b('Stacking', 5, 'A'), b('Stacking', 10, 'B'), b('Stacking', -3, 'C')],
      RULES,
    );
    expect(r.total).toBe(12);
    expect(r.contributors.every(c => c.applied)).toBe(true);
  });

  it('mixed types: each type evaluated independently', () => {
    const r = stackBonuses(
      [
        b('Insight',     3, 'I-low'),
        b('Insight',     5, 'I-high'),
        b('Enhancement', 4, 'E1'),
        b('Stacking',    2, 'S1'),
        b('Stacking',    1, 'S2'),
      ],
      RULES,
    );
    // Insight: 5 wins. Enhancement: 4 (only one). Stacking: 3.
    expect(r.total).toBe(5 + 4 + 3);
  });

  it('unknown bonus type defaults to always-stack', () => {
    const r = stackBonuses(
      [b('NewlyAddedType', 2, 'A'), b('NewlyAddedType', 3, 'B')],
      RULES,
    );
    expect(r.total).toBe(5);
  });

  it('records dominatedBy on losers', () => {
    const r = stackBonuses(
      [b('Insight', 2, 'A'), b('Insight', 6, 'B')],
      RULES,
    );
    const loser = r.contributors.find(c => c.source === 'A');
    expect(loser?.applied).toBe(false);
    expect(loser?.dominatedBy).toBe('B');
  });
});

describe('stackBonusesByTarget', () => {
  it('separate targets do not compete', () => {
    const r = stackBonusesByTarget(
      [
        b('Enhancement', 2, 'gloves',  'Strength'),
        b('Enhancement', 4, 'belt',    'Strength'),
        b('Enhancement', 3, 'goggles', 'Dexterity'),
      ],
      RULES,
    );
    expect(r.get('Strength')?.total).toBe(4);
    expect(r.get('Dexterity')?.total).toBe(3);
  });

  it('same target: stacking applies as usual', () => {
    const r = stackBonusesByTarget(
      [
        b('Stacking', 2, 'A', 'Jump'),
        b('Stacking', 5, 'B', 'Jump'),
      ],
      RULES,
    );
    expect(r.get('Jump')?.total).toBe(7);
  });
});
