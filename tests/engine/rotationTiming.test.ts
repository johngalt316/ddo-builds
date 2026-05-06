import { describe, it, expect } from 'vitest';
import { resolveTimeline, findFirstAvailableSlot, fillToOneMinute, FILL_TARGET_SECONDS } from '../../src/engine/dps/timing';
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

  it("can wait inside a wide gap for the new ability's own CD to elapse", () => {
    // Rotation [NL, MM, NL] — NL is 1s/8s, MM is 1s/2s.
    // Resolved timeline: NL@0, MM@1, NL@8 (group/own CD).
    // Cursor before NL@8 = 2; gap = 6s.
    // Adding another MM: its CD-ready time is 1+2=3. cursor=2.
    // The old logic required CD-ready ≤ cursor; new logic allows the
    // cast to start at max(cursor, CD-ready)=3 and finish at 4 ≤ 8.
    // Should fit at idx 2 (between MM and NL).
    const NL = ability('NL', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const MM = ability('MM', { castTime: 1, cooldown: 2 });
    const map = new Map([['NL', NL], ['MM', MM]]);
    expect(findFirstAvailableSlot(rot('NL', 'MM', 'NL'), MM, map, 0)).toBe(2);
  });

  it('NL+MM scenario: clicking MM after a full NL rotation fills inter-NL gaps', () => {
    // 8 NLs spaced 8s apart (kemton-style cycle). Click MM (2s CD, 1s
    // cast) → first MM fits in idx 1 (the 7s gap between NL@0 and NL@8).
    const NL = ability('NL', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const MM = ability('MM', { castTime: 1, cooldown: 2 });
    const map = new Map([['NL', NL], ['MM', MM]]);
    const eightNLs = rot('NL', 'NL', 'NL', 'NL', 'NL', 'NL', 'NL', 'NL');
    expect(findFirstAvailableSlot(eightNLs, MM, map, 0)).toBe(1);
    // After fillToOneMinute completes, MMs should outnumber NLs.
    const filled = fillToOneMinute(eightNLs, MM, map, 0);
    const mmCount = filled.filter(s => s.abilityId === 'MM').length;
    const nlCount = filled.filter(s => s.abilityId === 'NL').length;
    expect(nlCount).toBe(8);
    expect(mmCount).toBeGreaterThanOrEqual(20);   // ~3-4 MMs per inter-NL gap
    expect(resolveTimeline(filled, map, 0).totalSeconds).toBeLessThanOrEqual(60);
  });
});

// ── Shared cooldown groups (Epic Strike pool) ────────────────────────

describe('cooldownGroup — shared cooldown pool', () => {
  it('firing one Epic Strike puts every member of the group on cooldown', () => {
    // ES1 has 8s CD, ES2 has 3s CD. Firing ES1 should block ES2 for 8s.
    const ES1 = ability('ES1', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const ES2 = ability('ES2', { castTime: 1, cooldown: 3, cooldownGroup: 'epic-strike' });
    const map = new Map([['ES1', ES1], ['ES2', ES2]]);
    const t = resolveTimeline(rot('ES1', 'ES2'), map, 0);
    expect(t.steps[0]!.startTime).toBe(0);
    // ES2 must wait until ES1's group CD elapses (start=0, CD=8 → ready=8).
    expect(t.steps[1]!.startTime).toBe(8);
    expect(t.steps[1]!.hasGap).toBe(true);
  });

  it('a member with shorter own CD still respects the longer group CD', () => {
    // ES1 self-CD 4s, group CD 8s after ES_LONG. ES1 cannot fire at t=4
    // because the group is still on its 8s CD from ES_LONG.
    const ES_LONG = ability('ES_LONG', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const ES1     = ability('ES1',     { castTime: 1, cooldown: 4, cooldownGroup: 'epic-strike' });
    const map = new Map([['ES_LONG', ES_LONG], ['ES1', ES1]]);
    const t = resolveTimeline(rot('ES_LONG', 'ES1'), map, 0);
    expect(t.steps[1]!.startTime).toBe(8);   // group CD wins over own CD
  });

  it('abilities outside the group are unaffected by group cooldown', () => {
    const ES = ability('ES', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const F  = ability('F',  { castTime: 1, cooldown: 0 });
    const map = new Map([['ES', ES], ['F', F]]);
    const t = resolveTimeline(rot('ES', 'F'), map, 0);
    expect(t.steps[1]!.startTime).toBe(1);   // F fires right after ES ends
    expect(t.steps[1]!.hasGap).toBe(false);
  });

  it("findFirstAvailableSlot: a new Epic Strike won't slot during the group's cooldown", () => {
    // [ES1@0, F@1] — group ready at t=8. Adding ES2 (8s own CD) should
    // not fit between ES1 and F (would land at t=1, but group blocks
    // until t=8). Appends.
    const ES1 = ability('ES1', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const ES2 = ability('ES2', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const F   = ability('F',   { castTime: 1, cooldown: 0 });
    const map = new Map([['ES1', ES1], ['ES2', ES2], ['F', F]]);
    expect(findFirstAvailableSlot(rot('ES1', 'F'), ES2, map, 0)).toBe(2);
  });
});

describe('findFirstAvailableSlot — charge accounting', () => {
  it('finds the gap that opens up because charge-depleted steps are skipped', () => {
    // PL: 1s cast, 2s CD, 2 charges. A rotation that packs 5 PLs in a
    // row only fires the first two; the rest are charge-depleted skips
    // that don't consume cursor time. Without the charge fix,
    // findFirstAvailableSlot would walk the cursor through all 5 PLs
    // (cursor ~ 11s at the end of them); with the fix, cursor stops
    // at 4s and the wide gap before the trailing F is correctly
    // detected.
    const PL = ability('PL', { castTime: 1, cooldown: 2, charges: 2 });
    const F  = ability('F',  { castTime: 1, cooldown: 10 });
    const MM = ability('MM', { castTime: 1, cooldown: 0 });
    const map = new Map([['PL', PL], ['F', F], ['MM', MM]]);

    // Resolved timeline:
    //   F@0 (CD 10), PL@1 (2→1), PL@3 (1→0, ends 4), PL skipped × 3,
    //   F@10 (own CD 10s, fires at 10, gap from 4..10 = 6s).
    // Insert a new MM somewhere before the trailing F. The first
    // fillable position is BETWEEN the firing PLs (idx 2: cursor=2,
    // PL@3 startTime=3, fits in 1s gap). What this test really checks
    // is that the algorithm DOESN'T fall through to append past the
    // depleted PLs and instead respects the real timeline shape.
    const seq = rot('F', 'PL', 'PL', 'PL', 'PL', 'PL', 'F');
    const idx = findFirstAvailableSlot(seq, MM, map, 0);
    // Real fillable gaps (in array-index terms): idx 2 (between firing
    // PLs) or idx 6 (before trailing F). The algorithm picks the
    // earliest fitting one.
    expect(idx).toBe(2);
  });

  it('fillToOneMinute keeps growing the rotation across charge-limited fillers', () => {
    // Reproduces the user-reported flow:
    //   1. Click NL  → rotation fills with 8 NLs (cycle ≈ 57s).
    //   2. Click PL  → fills inter-NL gaps; only first 2 PLs fire,
    //                  rest are charge-depleted no-ops.
    //   3. Click MM  → must still find unfilled real-time gaps and
    //                  bring cycle close to the 60s target.
    const NL = ability('NL', { castTime: 1, cooldown: 8, cooldownGroup: 'epic-strike' });
    const PL = ability('PL', { castTime: 1, cooldown: 2, charges: 2 });
    const MM = ability('MM', { castTime: 1, cooldown: 0 });
    const map = new Map([['NL', NL], ['PL', PL], ['MM', MM]]);

    let r = fillToOneMinute([], NL, map, 0);
    r = fillToOneMinute(r, PL, map, 0);
    r = fillToOneMinute(r, MM, map, 0);

    const t = resolveTimeline(r, map, 0);
    // After all three fills the rotation should approach the 60s cap.
    expect(t.totalSeconds).toBeGreaterThanOrEqual(55);
    expect(t.totalSeconds).toBeLessThanOrEqual(60 + 1e-6);
    // And contain at least one MM (i.e. step 3 actually inserted).
    expect(r.some(s => s.abilityId === 'MM')).toBe(true);
  });
});

describe('fillToOneMinute', () => {
  it('fills an empty rotation with N copies of a 1s-cast spell up to 60s', () => {
    const A = ability('A', { castTime: 1, cooldown: 0 });
    const map = new Map([['A', A]]);
    const out = fillToOneMinute([], A, map, 0);
    expect(out).toHaveLength(FILL_TARGET_SECONDS);                        // exactly 60 casts
    expect(resolveTimeline(out, map, 0).totalSeconds).toBeCloseTo(60, 5);
  });

  it('respects cooldown — slots only as many casts as the rotation can take in 60s', () => {
    // 1s cast, 8s CD ability with no filler → first cast at 0, then forced
    // to wait 8s each. With CD measured from cast start: t=0,8,16,…,56 →
    // 8 casts (next would land at t=64, past target).
    const NL = ability('NL', { castTime: 1, cooldown: 8 });
    const map = new Map([['NL', NL]]);
    const out = fillToOneMinute([], NL, map, 0);
    expect(out.length).toBe(8);
    expect(resolveTimeline(out, map, 0).totalSeconds).toBeLessThanOrEqual(60);
  });

  it('appending after an existing rotation does not exceed target', () => {
    // Pre-fill with 50 1s casts of A (totalSeconds=50). Add B (1s cast, 0 CD)
    // → fills the remaining 10s with 10 B casts.
    const A = ability('A', { castTime: 1, cooldown: 0 });
    const B = ability('B', { castTime: 1, cooldown: 0 });
    const map = new Map([['A', A], ['B', B]]);
    const seedSteps: RotationStep[] = Array.from({ length: 50 }, (_, i) => ({
      key: `A-${i}`, abilityId: 'A',
    }));
    const out = fillToOneMinute(seedSteps, B, map, 0);
    const aCount = out.filter(s => s.abilityId === 'A').length;
    const bCount = out.filter(s => s.abilityId === 'B').length;
    expect(aCount).toBe(50);
    expect(bCount).toBe(10);
    expect(resolveTimeline(out, map, 0).totalSeconds).toBeLessThanOrEqual(60);
  });

  it('returns input unchanged if rotation is already at or past 60s', () => {
    const A = ability('A', { castTime: 1, cooldown: 0 });
    const B = ability('B', { castTime: 1, cooldown: 0 });
    const map = new Map([['A', A], ['B', B]]);
    const seedSteps: RotationStep[] = Array.from({ length: 60 }, (_, i) => ({
      key: `A-${i}`, abilityId: 'A',
    }));
    const out = fillToOneMinute(seedSteps, B, map, 0);
    expect(out).toHaveLength(60);
    expect(out.every(s => s.abilityId === 'A')).toBe(true);
  });
});
