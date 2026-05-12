// Verifies <Type>GrantFeat</Type> expansion in collectEffects:
//   1. The granted feat's own effects are fired (e.g. Magical Training adds
//      +5 universal spell crit chance via the granted feat's effects, even
//      when granted through an enhancement instead of being a selected feat).
//   2. The granted feat name lands in ctx.feats, so a downstream
//      <Type>Feat</Type> requirement gating on the granted name passes.
//   3. The grant's own requirements gate the cascade (a grant whose
//      requirements fail must not fire the granted feat's effects).
//   4. Unknown feat names go to unmatchedFeats — no crash.
//
// Audit reference: docs/audits/slice-06-granted-abilities.md, Issue 1.

import { describe, it, expect } from 'vitest';
import { collectEffects, buildBuildContext } from '@/engine/collectEffects';
import { evaluateEffect } from '@/engine/evaluateEffect';
import type { DDOFeatData, DDOEffect, DDORequirements } from '@/types/ddoData';
import type { Build } from '@/types/build';

const noReqs: DDORequirements = { allOf: [], oneOf: [], noneOf: [] };

function effect(over: Partial<DDOEffect> = {}): DDOEffect {
  return {
    types: ['AbilityBonus'],
    bonus: 'Enhancement',
    items: [],
    amount: [],
    amountType: 'Simple',
    requirements: noReqs,
    ...over,
  };
}

function grantFeatEffect(featName: string, reqs: DDORequirements = noReqs): DDOEffect {
  return effect({
    types: ['GrantFeat'],
    bonus: 'Enhancement',
    items: [featName],
    amount: [],
    amountType: 'NotNeeded',
    requirements: reqs,
  });
}

/** Minimal stub build — just enough fields to call collectEffects.
 *  Most lists are empty; we drive grants through synthetic class autofeats. */
function stubBuild(over: Partial<Build> = {}): Build {
  return {
    raceId: 'human',
    abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    abilityTomes: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
    levelUps: [],
    classes: [{ classId: 'fighter', levels: 1 }],
    epicLevels: 0,
    feats: [],
    specialFeats: [],
    gearSets: [{ name: 'default', items: [] }],
    activeGearSet: 'default',
    skillRanks: {},
    activeStances: [],
    enhancements: [],
    destinyEnhancements: [],
    reaperEnhancements: [],
    activePartyBuffs: [],
    applyGuildBuffs: false,
    guildLevel: 0,
    ...over,
  } as Build;
}

/** A class XML stub that grants the named feat at level 1 via automaticFeats. */
function stubClass(featName: string) {
  return {
    name: 'Fighter',
    id: 'fighter',
    baseClass: 'Fighter',
    automaticFeats: [{ level: 1, feats: [featName] }],
    classFeats: [],
    skillsPerLevel: 2,
    hitDie: 10,
    bab: 'Full',
    levelChoices: [],
    spellLevels: {},
    optionalBuffs: [],
  } as any;
}

/** Synthetic feat data — one slot in the feat index. */
function stubFeatData(over: Partial<DDOFeatData>): DDOFeatData {
  return {
    name: 'Test',
    description: '',
    icon: '',
    type: 'Class',
    acquire: 'Train',
    automaticAcquisition: undefined,
    maxTimesAcquire: 1,
    requirements: { allOf: [], oneOf: [], noneOf: [] } as any,
    effects: [],
    stances: [],
    ...over,
  } as DDOFeatData;
}

const emptyInput = {
  itemBuffs: {} as any,
  setBonuses: [],
  itemSetIndex: {},
  augments: [],
  filigrees: [],
  filigreeSetBonuses: [],
  selfPartyBuffs: [],
  guildBuffs: [],
  enhancementTrees: [],
  races: [],
};

describe('collectEffects — GrantFeat expansion', () => {
  it('fires the granted feat\'s own effects', () => {
    // A Fighter level-1 autofeat grants "Magical Training"; Magical Training's
    // data has a +5 UniversalSpellCriticalChance effect. The grant should fire
    // that effect into the sourced list.
    const magicalTraining = stubFeatData({
      name: 'Magical Training',
      effects: [effect({
        types: ['UniversalSpellCriticalChance'],
        amount: [5],
        amountType: 'Simple',
      })],
    });
    // Grant carrier: a "feat" whose only effect is GrantFeat(Magical Training).
    const grantCarrier = stubFeatData({
      name: 'Grant Carrier',
      effects: [grantFeatEffect('Magical Training')],
    });
    const build = stubBuild();
    const classes = [stubClass('Grant Carrier')];

    const result = collectEffects({
      build,
      feats: [grantCarrier, magicalTraining],
      classes,
      ...emptyInput,
    });

    // The expanded effect is appended with source "<grant source> → Magical Training"
    const expanded = result.effects.find(e =>
      e.source.includes('→ Magical Training') &&
      e.effect.types.includes('UniversalSpellCriticalChance'),
    );
    expect(expanded).toBeDefined();
    expect(expanded?.effect.amount).toEqual([5]);
    expect(result.grantedFeats).toContain('Magical Training');
  });

  it('adds the granted feat name to ctx.feats', () => {
    const ctx = buildBuildContext({
      build: stubBuild(),
      classes: [],
      effectiveScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      bab: 0,
      grantedFeats: ['Magical Training'],
    });
    expect(ctx.feats.has('Magical Training')).toBe(true);
  });

  it('inherits the grant\'s requirements onto the granted feat\'s effects', () => {
    // The grant requires Level 5; the build is Level 1, so the cascaded
    // effect's merged requirements must fail.
    const lvl5Req: DDORequirements = {
      allOf: [{ type: 'TotalLevel', value: 5 }],
      oneOf: [],
      noneOf: [],
    };
    const target = stubFeatData({
      name: 'Diehard',
      effects: [effect({ types: ['Hitpoints'], amount: [10], amountType: 'Simple' })],
    });
    const carrier = stubFeatData({
      name: 'Carrier',
      effects: [grantFeatEffect('Diehard', lvl5Req)],
    });
    const build = stubBuild();
    const result = collectEffects({
      build,
      feats: [carrier, target],
      classes: [stubClass('Carrier')],
      ...emptyInput,
    });
    const expanded = result.effects.find(e =>
      e.source.includes('→ Diehard'));
    expect(expanded).toBeDefined();
    // The grant's TotalLevel>=5 must be carried onto the inherited effect.
    expect(expanded?.effect.requirements.allOf).toContainEqual(
      { type: 'TotalLevel', value: 5 },
    );

    // And evaluateEffect must skip it for a level-1 build.
    const ctx = buildBuildContext({
      build, classes: [],
      effectiveScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      bab: 0,
      grantedFeats: result.grantedFeats,
    });
    const evald = evaluateEffect(expanded!.effect, ctx, expanded!.source, 1);
    expect(evald.skipped).toBe('requirements-failed');
  });

  it('reports unknown feat names in unmatchedFeats and emits no expansion', () => {
    const carrier = stubFeatData({
      name: 'Carrier',
      effects: [grantFeatEffect('Nonexistent Feat')],
    });
    const result = collectEffects({
      build: stubBuild(),
      feats: [carrier],
      classes: [stubClass('Carrier')],
      ...emptyInput,
    });
    expect(result.unmatchedFeats).toContain('Nonexistent Feat');
    expect(result.grantedFeats).not.toContain('Nonexistent Feat');
    expect(result.effects.find(e => e.source.includes('→ Nonexistent Feat'))).toBeUndefined();
  });
});
