import { describe, it, expect } from 'vitest';
import { resolveTimeline, findFirstAvailableSlot } from '../../src/engine/dps/timing';
import type { MagicAbility } from '../../src/engine/dps/abilities';
import type { RotationStep } from '../../src/engine/dps/rotation';

function ability(id: string, opts: Partial<MagicAbility> = {}): MagicAbility {
  return {
    id,
    source: 'spell',
    name: id,
    displayName: id,
    icon: '',
    school: 'Evocation',
    className: 'Wizard',
    spellLevel: 1,
    cost: 10,
    cooldown: 0,
    charges: 0,
    maxCasterLevel: 20,
    damages: [],
    castTime: 1,
    ...opts,
  };
}

function rot(...ids: string[]): RotationStep[] {
  return ids.map((id, i) => ({ key: `${id}-${i}`, abilityId: id }));
}

describe('resolveTimeline', () => {
  it('places sequential casts back-to-back when no cooldowns', () => {
    const map = new Map([
      ['A', ability('A', { castTime: 1 })],
      ['B', ability('B', { castTime: 2 })],
    ]);
    const t = resolveTimeline(rot('A', 'B', 'A'), map, 0);
    expect(t.steps.map(s => s.startTime)).toEqual([0, 1, 3]);
    expect(t.totalSeconds).toBe(4);
    expect(t.steps.every(s => !s.hasGap)).toBe(true);
  });

  it('inserts a CD-driven gap when re-casting same ability too early', () => {
    // Magic Missile-style: 1s cast, 5s CD. Filler in between.
    const map = new Map([
      ['MM', ability('MM', { castTime: 1, cooldown: 5 })],
      ['F',  ability('F',  { castTime: 1 })],
    ]);
    const t = resolveTimeline(rot('MM', 'F', 'MM'), map, 0);
    expect(t.steps[0]!.startTime).toBe(0);
    expect(t.steps[1]!.startTime).toBe(1);
    // Second MM held until 0+5=5 even though previous cast ended at t=2.
    expect(t.steps[2]!.startTime).toBe(5);
    expect(t.steps[2]!.hasGap).toBe(true);
    expect(t.totalSeconds).toBe(6);
  });

  it('cooldown reduction shortens the gap', () => {
    const map = new Map([
      ['MM', ability('MM', { castTime: 1, cooldown: 10 })],
    ]);
    // 50% CD reduction → 5s effective CD.
    const t = resolveTimeline(rot('MM', 'MM'), map, 50);
    expect(t.steps[0]!.effectiveCooldown).toBe(5);
    expect(t.steps[1]!.startTime).toBe(5);
  });

  it('100% CD reduction collapses CD to 0 (back-to-back recasts)', () => {
    const map = new Map([
      ['MM', ability('MM', { castTime: 1, cooldown: 30 })],
    ]);
    const t = resolveTimeline(rot('MM', 'MM'), map, 100);
    expect(t.steps[1]!.startTime).toBe(1);
    expect(t.steps[1]!.hasGap).toBe(false);
  });

  it('drops steps whose ability is unknown without disrupting timing', () => {
    const map = new Map([
      ['A', ability('A', { castTime: 1 })],
      ['B', ability('B', { castTime: 1 })],
    ]);
    const t = resolveTimeline(rot('A', 'GHOST', 'B'), map, 0);
    expect(t.steps.map(s => s.ability.id)).toEqual(['A', 'B']);
    // Global cursor advances only across the *known* casts.
    expect(t.steps[1]!.startTime).toBe(1);
  });

  it('cooldown is measured from cast start, not cast end', () => {
    // 2s cast, 5s CD. Re-ready at t=5 (start), not t=7 (end + CD).
    const map = new Map([
      ['L', ability('L', { castTime: 2, cooldown: 5 })],
      ['F', ability('F', { castTime: 1 })],
    ]);
    const t = resolveTimeline(rot('L', 'F', 'F', 'F', 'L'), map, 0);
    // First L: 0..2, ready at t=5.
    // Three F's at 2..3, 3..4, 4..5. Cursor at 5, L ready at 5 → no gap.
    expect(t.steps[4]!.startTime).toBe(5);
    expect(t.steps[4]!.hasGap).toBe(false);
  });

  it('charge-limited abilities exhaust after N casts and skip', () => {
    const map = new Map([
      ['MM', ability('MM', { castTime: 1, cooldown: 0, charges: 3 })],
    ]);
    const t = resolveTimeline(rot('MM', 'MM', 'MM', 'MM', 'MM'), map, 0);
    expect(t.steps).toHaveLength(3);             // first 3 fire
    expect(t.skipped).toHaveLength(2);           // last 2 skipped
    expect(t.skipped[0]!.reason).toBe('no-charges');
    expect(t.steps[2]!.chargesRemaining).toBe(0);
  });

  it('charge counter is per-ability, not shared across abilities', () => {
    const map = new Map([
      ['A', ability('A', { castTime: 1, charges: 1 })],
      ['B', ability('B', { castTime: 1, charges: 1 })],
    ]);
    const t = resolveTimeline(rot('A', 'B', 'A', 'B'), map, 0);
    // A and B each fire once then deplete; second A and second B both skip.
    expect(t.steps.map(s => s.ability.id)).toEqual(['A', 'B']);
    expect(t.skipped).toHaveLength(2);
  });

  it('unlimited-charge abilities (charges=0) report Infinity remaining', () => {
    const map = new Map([
      ['MM', ability('MM', { castTime: 1, cooldown: 0, charges: 0 })],
    ]);
    const t = resolveTimeline(rot('MM', 'MM'), map, 0);
    expect(t.steps[0]!.chargesRemaining).toBe(Infinity);
    expect(t.skipped).toHaveLength(0);
  });
});

describe('findFirstAvailableSlot', () => {
  it('appends to an empty rotation', () => {
    const A = ability('A', { castTime: 1, cooldown: 0 });
    expect(findFirstAvailableSlot([], A, new Map([['A', A]]), 0)).toBe(0);
  });

  it('appends when no cooldown gaps exist', () => {
    // Two no-CD spells back-to-back; adding a third no-CD spell appends.
    const A = ability('A', { castTime: 1, cooldown: 0 });
    const B = ability('B', { castTime: 1, cooldown: 0 });
    const C = ability('C', { castTime: 1, cooldown: 0 });
    const map = new Map([['A', A], ['B', B], ['C', C]]);
    expect(findFirstAvailableSlot(rot('A', 'B'), C, map, 0)).toBe(2);
  });

  it('fills the cooldown gap of a same-spell repeat', () => {
    // MM has 2s CD, 1s cast. Rotation [MM, MM] forces a 1s gap before
    // the second MM. A 1s no-CD filler should drop into that gap.
    const MM = ability('MM', { castTime: 1, cooldown: 2 });
    const F  = ability('F',  { castTime: 1, cooldown: 0 });
    const map = new Map([['MM', MM], ['F', F]]);
    expect(findFirstAvailableSlot(rot('MM', 'MM'), F, map, 0)).toBe(1);
  });

  it('skips a gap that is too narrow for the new cast', () => {
    // 1s gap but new ability has 2s cast time → can't fit; appends.
    const MM   = ability('MM',   { castTime: 1, cooldown: 2 });
    const SLOW = ability('SLOW', { castTime: 2, cooldown: 0 });
    const map = new Map([['MM', MM], ['SLOW', SLOW]]);
    expect(findFirstAvailableSlot(rot('MM', 'MM'), SLOW, map, 0)).toBe(2);
  });

  it("won't insert into a gap when the new ability's own CD blocks it", () => {
    // Rotation [F, MM] — no gap before MM. Adding another MM: earliest
    // gap candidate is *after* MM (no MM CD competition there yet, but
    // there's no gap at all to fit into) → append.
    const F  = ability('F',  { castTime: 1, cooldown: 0 });
    const MM = ability('MM', { castTime: 1, cooldown: 2 });
    const map = new Map([['F', F], ['MM', MM]]);
    expect(findFirstAvailableSlot(rot('F', 'MM'), MM, map, 0)).toBe(2);
  });

  it("respects the new ability's own CD when picking which gap to fill", () => {
    // Rotation [MM, F, MM] — MM CD 4s. Gap before second MM (cursor=2,
    // second MM starts at t=4): 2s wide. A new MM cast there would
    // require its own CD elapsed by t=2 — but the first MM's CD only
    // ends at t=4. So the gap is unfillable by another MM; append.
    const MM = ability('MM', { castTime: 1, cooldown: 4 });
    const F  = ability('F',  { castTime: 1, cooldown: 0 });
    const map = new Map([['MM', MM], ['F', F]]);
    expect(findFirstAvailableSlot(rot('MM', 'F', 'MM'), MM, map, 0)).toBe(3);
  });

  it('cooldown-reduction shrinks the gap requirement', () => {
    // 50% CDR: MM's 2s CD → 1s effective. Rotation [MM, MM] → no gap
    // (cursor=1, CD-ready=1). New 1s no-CD spell can no longer fit
    // anywhere mid-rotation — appends.
    const MM = ability('MM', { castTime: 1, cooldown: 2 });
    const F  = ability('F',  { castTime: 1, cooldown: 0 });
    const map = new Map([['MM', MM], ['F', F]]);
    expect(findFirstAvailableSlot(rot('MM', 'MM'), F, map, 50)).toBe(2);
  });
});
