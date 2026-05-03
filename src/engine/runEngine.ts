// Top-level engine orchestrator.
//
// Glues collectEffects → evaluateEffect → breakdowns into one call,
// returning a unified result for every tracked stat plus diagnostics
// (unmatched feats, unmodeled effect types) so the UI can surface gaps.

import type { Build } from '@/types/build';
import type {
  DDOClassData, DDOFeatData, DDORaceData, DDOBonusType,
  EnhancementTreeData, ItemBuffCatalog, DDOSetBonusData,
} from '@/types/ddoData';
import { applyRacialBonuses, applyAbilityTomes, applyLevelUps, calculateBAB, calculateHitPoints, calculateSaves } from '@/engine';
import { ddoClassDataToEngineClass, ddoRaceDataToRace } from '@/utils/classAdapter';
import { collectEffects, buildBuildContext } from './collectEffects';
import { evaluateEffect } from './evaluateEffect';
import { buildStackingRules, type Bonus, type BreakdownResult } from './bonusStacking';
import {
  breakdownAbilityScore, breakdownHitPoints, breakdownSave,
  breakdownDoublestrike, breakdownDoubleshot,
  breakdownMeleePower, breakdownRangedPower, breakdownHealingAmp,
} from './breakdowns';
import type { Stat } from '@/types/build';

export interface EngineResult {
  abilityScores: Record<Stat, BreakdownResult>;
  hitPoints: BreakdownResult;
  saves: { Fortitude: BreakdownResult; Reflex: BreakdownResult; Will: BreakdownResult };
  meleePower: BreakdownResult;
  rangedPower: BreakdownResult;
  doublestrike: BreakdownResult;
  doubleshot: BreakdownResult;
  healingAmp: BreakdownResult;
  diagnostics: {
    unmatchedFeats: string[];
    unmatchedTrees: string[];
    unmatchedEnhancements: string[];
    unmatchedItemBuffs: string[];
    unmatchedSets: string[];
    /** AmountType strings the evaluator skipped, with effect-source counts. */
    unmodeledAmountTypes: Record<string, number>;
    requirementsFailedCount: number;
    totalSourcedEffects: number;
    totalAppliedBonuses: number;
  };
}

interface RunEngineInput {
  build: Build;
  classes: DDOClassData[];
  races: DDORaceData[];
  feats: DDOFeatData[];
  bonusTypes: DDOBonusType[];
  enhancementTrees: EnhancementTreeData[];
  itemBuffs: ItemBuffCatalog;
  setBonuses: DDOSetBonusData[];
  itemSetIndex: Record<string, string>;
}

const STATS: Stat[] = ['STR','DEX','CON','INT','WIS','CHA'];

export function runEngine(input: RunEngineInput): EngineResult {
  const {
    build, classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex,
  } = input;

  // ── Seeds (pre-effect baseline) ────────────────────────────────────
  const engineClasses = classes.map(ddoClassDataToEngineClass);
  const engineRaces = races.map(ddoRaceDataToRace);
  const race =
    engineRaces.find(r => r.id === build.raceId) ??
    engineRaces.find(r => r.name.toLowerCase() === build.raceId.replace(/_/g, ' ')) ??
    engineRaces[0];

  // Score pipeline mirrors useBuild: base → race → tomes → level-ups.
  const effectiveScores = applyLevelUps(
    applyAbilityTomes(
      race ? applyRacialBonuses(build.abilityScores, race) : { ...build.abilityScores },
      build.abilityTomes,
    ),
    build.levelUps,
  );

  const seedBab = calculateBAB(build.classes, engineClasses);
  const seedHp = calculateHitPoints(build.classes, engineClasses, effectiveScores.CON, build.feats);
  const seedSaves = calculateSaves(
    build.classes, engineClasses,
    effectiveScores.CON, effectiveScores.DEX, effectiveScores.WIS,
  );

  // ── Effect collection + evaluation ─────────────────────────────────
  const ctx = buildBuildContext({
    build, classes,
    effectiveScores: effectiveScores as unknown as Record<string, number>,
    bab: seedBab,
  });
  const {
    effects: sourced,
    unmatchedFeats,
    unmatchedTrees,
    unmatchedEnhancements,
    unmatchedItemBuffs,
    unmatchedSets,
  } = collectEffects({
    build, feats, classes, races, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex,
  });

  const allBonuses: Bonus[] = [];
  const unmodeled: Record<string, number> = {};
  let reqFailed = 0;

  for (const { effect, source, rankCount } of sourced) {
    const result = evaluateEffect(effect, ctx, source, rankCount);
    if (result.skipped === 'unmodeled-amount-type' && result.unmodeledAmountType) {
      unmodeled[result.unmodeledAmountType] = (unmodeled[result.unmodeledAmountType] ?? 0) + 1;
    } else if (result.skipped === 'requirements-failed') {
      reqFailed++;
    }
    allBonuses.push(...result.bonuses);
  }

  // ── Stack into per-stat breakdowns ─────────────────────────────────
  const rules = buildStackingRules(bonusTypes);

  const abilityScores = Object.fromEntries(
    STATS.map(s => [s, breakdownAbilityScore(s, effectiveScores[s], allBonuses, rules)] as const),
  ) as Record<Stat, BreakdownResult>;

  const result: EngineResult = {
    abilityScores,
    hitPoints: breakdownHitPoints(seedHp, allBonuses, rules),
    saves: {
      Fortitude: breakdownSave('Fortitude', seedSaves.fortitude, allBonuses, rules),
      Reflex:    breakdownSave('Reflex',    seedSaves.reflex,    allBonuses, rules),
      Will:      breakdownSave('Will',      seedSaves.will,      allBonuses, rules),
    },
    meleePower:   breakdownMeleePower(allBonuses, rules),
    rangedPower:  breakdownRangedPower(allBonuses, rules),
    doublestrike: breakdownDoublestrike(allBonuses, rules),
    doubleshot:   breakdownDoubleshot(allBonuses, rules),
    healingAmp:   breakdownHealingAmp(allBonuses, rules),
    diagnostics: {
      unmatchedFeats: [...new Set(unmatchedFeats)].sort(),
      unmatchedTrees: unmatchedTrees.sort(),
      unmatchedEnhancements: unmatchedEnhancements.sort(),
      unmatchedItemBuffs: unmatchedItemBuffs,
      unmatchedSets: unmatchedSets,
      unmodeledAmountTypes: unmodeled,
      requirementsFailedCount: reqFailed,
      totalSourcedEffects: sourced.length,
      totalAppliedBonuses: allBonuses.length,
    },
  };

  return result;
}
