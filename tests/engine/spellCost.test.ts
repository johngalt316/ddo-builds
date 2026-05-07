// SP cost — base + modifiers, with metamagic surcharges and reductions.

import { describe, it, expect } from 'vitest';
import { spellCostBreakdown, aggregateSpellCostReductions } from '@/engine/dps/spellCost';
import type { MagicAbility } from '@/engine/dps/abilities';
import type { Build } from '@/types/build';
import { DEFAULT_BUILD } from '@/types/build';
import type {
  EngineResult,
  CollectedSLA,
} from '@/engine/runEngine';
import type { AvailableStance } from '@/engine/collectEffects';
import type {
  DDOClassData,
  DDOMetamagicData,
  DDOSpellData,
} from '@/types/ddoData';
import type { Bonus, BreakdownResult } from '@/engine/bonusStacking';

const METAMAGICS: DDOMetamagicData[] = [
  { name: 'Empower Spell',  shortName: 'Empower',  baseSPCost: 15, costFormula: 'flat',
    spellEligibilityFlag: 'empower',  costReductionEffect: 'MetamagicCostEmpower' },
  { name: 'Maximize Spell', shortName: 'Maximize', baseSPCost: 25, costFormula: 'flat',
    spellEligibilityFlag: 'maximize', costReductionEffect: 'MetamagicCostMaximize' },
  { name: 'Heighten Spell', shortName: 'Heighten', baseSPCost: 1,  costFormula: 'per-level',
    spellEligibilityFlag: 'heighten', costReductionEffect: 'MetamagicCostHeighten' },
];

const EMPTY_BREAKDOWN: BreakdownResult = { total: 0, contributors: [] };
const EMPTY_BR_RECORD = new Proxy({}, { get: () => EMPTY_BREAKDOWN }) as Record<string, BreakdownResult>;

function makeEngine(allBonuses: Bonus[]): EngineResult {
  return {
    abilityScores: EMPTY_BR_RECORD as never,
    hitPoints: EMPTY_BREAKDOWN,
    saves: { Fortitude: EMPTY_BREAKDOWN, Reflex: EMPTY_BREAKDOWN, Will: EMPTY_BREAKDOWN },
    meleePower: EMPTY_BREAKDOWN, rangedPower: EMPTY_BREAKDOWN,
    doublestrike: EMPTY_BREAKDOWN, doubleshot: EMPTY_BREAKDOWN,
    sneakAttackDice: EMPTY_BREAKDOWN, imbueDice: EMPTY_BREAKDOWN,
    meleeSpeed: EMPTY_BREAKDOWN, rangedSpeed: EMPTY_BREAKDOWN,
    healingAmp: EMPTY_BREAKDOWN, negativeHealingAmp: EMPTY_BREAKDOWN, repairAmp: EMPTY_BREAKDOWN,
    ac: EMPTY_BREAKDOWN, dodge: EMPTY_BREAKDOWN, prr: EMPTY_BREAKDOWN, mrr: EMPTY_BREAKDOWN,
    spellResistance: EMPTY_BREAKDOWN, arcaneSpellFailure: EMPTY_BREAKDOWN,
    spellDCs: EMPTY_BR_RECORD as never, spellPenetration: EMPTY_BREAKDOWN, casterLevel: EMPTY_BREAKDOWN,
    spellPoints: EMPTY_BREAKDOWN, spellCooldownReduction: EMPTY_BREAKDOWN,
    universalSpellPower: EMPTY_BREAKDOWN, universalSpellCriticalChance: EMPTY_BREAKDOWN,
    universalSpellCriticalDamage: EMPTY_BREAKDOWN,
    skills: {}, spellPowers: EMPTY_BR_RECORD as never,
    spellCriticalChance: EMPTY_BR_RECORD as never, spellCriticalDamage: EMPTY_BR_RECORD as never,
    slas: [] as CollectedSLA[], availableStances: [] as AvailableStance[],
    allBonuses,
    diagnostics: {
      unmatchedFeats: [], unmatchedTrees: [], unmatchedEnhancements: [],
      unmatchedItemBuffs: [], unmatchedSets: [], unmatchedAugments: [],
      unmatchedFiligrees: [], unmatchedFiligreeSets: [],
      unmodeledAmountTypes: {}, requirementsFailedCount: 0,
      totalSourcedEffects: 0, totalAppliedBonuses: 0,
    },
  };
}

const SPELLS: DDOSpellData[] = [
  {
    name: 'Magic Missile', description: '', icon: '', school: 'Evocation',
    cost: 7, maxCasterLevel: 5, cooldown: 2, damages: [],
    metamagic: { empower: true, maximize: true, heighten: true, quicken: true } as never,
  } as DDOSpellData,
  {
    name: 'Sonic Blast', description: '', icon: '', school: 'Evocation',
    cost: 25, maxCasterLevel: 15, cooldown: 6, damages: [],
    // No empower / maximize eligibility — only heighten + quicken.
    metamagic: { heighten: true, quicken: true } as never,
  } as DDOSpellData,
];

const CLASSES: DDOClassData[] = [
  {
    name: 'Wizard', baseClass: 'Wizard', description: '', smallIcon: '', largeIcon: '',
    classSpecificFeatType: '', skillPoints: 2, hitPoints: 4,
    classSkills: [], alignment: '',
    fortitude: 'low', reflex: 'low', will: 'high',
    spellPointsPerLevel: [],
    castingStat: 'Intelligence',
    autoBuySkills: [],
    spells: [], spellSlotsByLevel: [
      [3,0,0,0,0,0,0,0,0],          // L1: max spell level 1
      ...Array.from({ length: 19 }, () => [4,4,4,4,4,4,4,4,4] as number[]),
    ],
    spellLevels: [], requirements: { all: [], oneOf: [] },
    automaticFeats: [], featSlots: [],
    abilities: [], lifeStyles: [], grantedFeats: [], specificFeats: [],
  } as never,
];

const wizardBuild: Build = {
  ...DEFAULT_BUILD,
  classes: [{ classId: 'wizard', levels: 20 }],
};

const mmAbility: MagicAbility = {
  id: 'wizard::Magic Missile',
  source: 'spell',
  name: 'Magic Missile',
  displayName: 'Magic Missile',
  icon: '', school: 'Evocation',
  cost: 7, cooldown: 2, charges: 0,
  maxCasterLevel: 5, damages: [], castTime: 1.0,
  className: 'Wizard', spellLevel: 1,
  category: 'damage',
};

describe('spellCostBreakdown', () => {
  it('returns base only when no metamagics are active', () => {
    const out = spellCostBreakdown(
      mmAbility, wizardBuild, makeEngine([]),
      SPELLS, CLASSES, METAMAGICS, { perMetamagic: {}, percentReduction: 0 },
    );
    expect(out).toMatchObject({ base: 7, modifiers: 0, total: 7 });
  });

  it('adds Empower (+15) when active and the spell is eligible', () => {
    const build = { ...wizardBuild, activeMetamagics: ['Empower Spell'] };
    const out = spellCostBreakdown(
      mmAbility, build, makeEngine([]),
      SPELLS, CLASSES, METAMAGICS, { perMetamagic: {}, percentReduction: 0 },
    );
    expect(out.base).toBe(7);
    expect(out.modifiers).toBe(15);
    expect(out.total).toBe(22);
    expect(out.perMetamagic).toEqual([
      { name: 'Empower', surcharge: 15, reduction: 0, net: 15 },
    ]);
  });

  it('skips metamagics the spell is not eligible for', () => {
    const sonicBlast: MagicAbility = {
      ...mmAbility, id: 'wizard::Sonic Blast', name: 'Sonic Blast',
      cost: 25, spellLevel: 4,
    };
    const build = { ...wizardBuild,
      activeMetamagics: ['Empower Spell', 'Maximize Spell', 'Quicken Spell'] };
    const out = spellCostBreakdown(
      sonicBlast, build, makeEngine([]),
      SPELLS, CLASSES, METAMAGICS, { perMetamagic: {}, percentReduction: 0 },
    );
    // Sonic Blast accepts neither Empower nor Maximize; only Quicken.
    // Quicken isn't in our test catalog, so 0 surcharges land.
    expect(out.modifiers).toBe(0);
    expect(out.total).toBe(25);
  });

  it('subtracts per-metamagic cost reductions', () => {
    const build = { ...wizardBuild, activeMetamagics: ['Empower Spell'] };
    const out = spellCostBreakdown(
      mmAbility, build, makeEngine([]),
      SPELLS, CLASSES, METAMAGICS, { perMetamagic: { 'Empower Spell': 5 }, percentReduction: 0 },
    );
    expect(out.modifiers).toBe(10);     // 15 - 5
    expect(out.total).toBe(17);
  });

  it('Heighten scales by max-castable - spell-level', () => {
    // Wizard 20 → max spell level 9 (per the spellSlotsByLevel fixture).
    // Magic Missile is L1 → Heighten raises by 8 levels → +8 SP.
    const build = { ...wizardBuild, activeMetamagics: ['Heighten Spell'] };
    const out = spellCostBreakdown(
      mmAbility, build, makeEngine([]),
      SPELLS, CLASSES, METAMAGICS, { perMetamagic: {}, percentReduction: 0 },
    );
    expect(out.modifiers).toBe(8);
    expect(out.total).toBe(15);
  });

  it('applies percent reduction last', () => {
    const build = { ...wizardBuild, activeMetamagics: ['Empower Spell'] };
    const out = spellCostBreakdown(
      mmAbility, build, makeEngine([]),
      SPELLS, CLASSES, METAMAGICS, { perMetamagic: {}, percentReduction: 10 },
    );
    // (7 + 15) × 0.9 = 19.8 → round to 20.
    expect(out.total).toBe(20);
    expect(out.modifiers).toBe(20 - 7);
  });
});

describe('aggregateSpellCostReductions', () => {
  it('sums MetamagicCost* effects per metamagic', () => {
    const engine = makeEngine([
      { bonusType: 'Stacking', value: 3, source: 'Improved Empower I', effectType: 'MetamagicCostEmpower' },
      { bonusType: 'Stacking', value: 3, source: 'Improved Empower II', effectType: 'MetamagicCostEmpower' },
      { bonusType: 'Stacking', value: 5, source: 'Maximize Reduction',  effectType: 'MetamagicCostMaximize' },
    ]);
    const out = aggregateSpellCostReductions(engine, METAMAGICS);
    expect(out.perMetamagic['Empower Spell']).toBe(6);
    expect(out.perMetamagic['Maximize Spell']).toBe(5);
    expect(out.percentReduction).toBe(0);
  });

  it('routes SpellPointCostPercent to percentReduction', () => {
    const engine = makeEngine([
      { bonusType: 'Feat', value: 1, source: 'Epic SP%', effectType: 'SpellPointCostPercent' },
    ]);
    const out = aggregateSpellCostReductions(engine, METAMAGICS);
    expect(out.percentReduction).toBe(1);
  });
});
