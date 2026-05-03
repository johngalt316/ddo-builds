// @vitest-environment happy-dom
//
// Verifies (1) the parser groups <SpecialFeats><TrainedFeat> entries
// by feat-name+type into rank counts, and (2) the engine source walker
// emits one SourcedEffect per Effect on each special feat with
// rankCount=rank.
import { describe, it, expect } from 'vitest';
import { collectEffects } from '@/engine/collectEffects';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build } from '@/types/build';
import type { DDOFeatData, DDOEffect } from '@/types/ddoData';

const PAST_LIFE_FEAT: DDOFeatData = {
  name: 'Past Life: Bladeforged',
  description: '+10 HP per rank.',
  icon: 'BladeforgePastLife',
  groups: ['Heroic Past Life'],
  acquire: 'HeroicPastLife',
  maxTimesAcquire: 3,
  requirements: { allOf: [], oneOf: [], noneOf: [] },
  hasSubItems: false,
  effects: [
    {
      types: ['HitPoints'],
      bonus: 'Past Life',
      amountType: 'Stacks',
      amount: [10, 20, 30],
      items: [],
      requirements: { allOf: [], oneOf: [], noneOf: [] },
      values: [],
    } as DDOEffect,
  ],
};

const EMPTY_GAME_DATA = {
  feats: [PAST_LIFE_FEAT],
  classes: [],
  races: [],
  enhancementTrees: [],
  itemBuffs: {},
  setBonuses: [],
  itemSetIndex: {},
};

function buildWithSpecial(rank: number): Build {
  return {
    ...DEFAULT_BUILD,
    classes: [{ classId: 'fighter', levels: 1 }],
    specialFeats: [{ featId: 'Past Life: Bladeforged', type: 'HeroicPastLife', rank }],
  };
}

describe('special feat source walker', () => {
  it('emits an effect with rankCount=rank for a 3-rank past life', () => {
    const build = buildWithSpecial(3);
    const r = collectEffects({ build, ...EMPTY_GAME_DATA });
    const plEffects = r.effects.filter(e => e.source.startsWith('[PL]'));
    expect(plEffects).toHaveLength(1);
    expect(plEffects[0]?.rankCount).toBe(3);
    expect(plEffects[0]?.source).toContain('Past Life: Bladeforged');
    expect(plEffects[0]?.source).toContain('×3');
  });

  it('emits no effects when rank is 0', () => {
    const build = buildWithSpecial(0);
    const r = collectEffects({ build, ...EMPTY_GAME_DATA });
    const plEffects = r.effects.filter(e => e.source.startsWith('[PL]'));
    expect(plEffects).toHaveLength(0);
  });

  it('records unmatched feat names into unmatchedFeats', () => {
    const build: Build = {
      ...DEFAULT_BUILD,
      classes: [{ classId: 'fighter', levels: 1 }],
      specialFeats: [{ featId: 'Nonexistent Past Life', type: 'HeroicPastLife', rank: 1 }],
    };
    const r = collectEffects({ build, ...EMPTY_GAME_DATA });
    expect(r.unmatchedFeats).toContain('Nonexistent Past Life');
  });

  it('omits the ×N suffix when rank is 1', () => {
    const build = buildWithSpecial(1);
    const r = collectEffects({ build, ...EMPTY_GAME_DATA });
    const plEffects = r.effects.filter(e => e.source.startsWith('[PL]'));
    expect(plEffects[0]?.source).not.toContain('×');
  });
});
