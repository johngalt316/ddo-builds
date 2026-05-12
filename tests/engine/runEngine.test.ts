// @vitest-environment happy-dom
//
// Engine snapshot — locks in what the engine produces for our reference
// builds. Snapshots a *summary*, not full contributor lists: per-stat
// totals, applied / dominated counts, and aggregated diagnostics. Effect
// sources multiply across phases; full lists would churn on every game-
// data refresh and obscure real regressions.
//
// Loader helpers live in `_loadFixtures.ts` so the parallel DPS snapshot
// test (`dpsCalc.test.ts`) can reuse the same game data + build list
// without forking path resolution.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { runEngine } from '@/engine/runEngine';
import type { Build } from '@/types/build';
import type { BreakdownResult } from '@/engine/bonusStacking';
import {
  FIXTURE_CASES, SNAPSHOTS,
  loadBuild, loadGameData, buildClassSkillsLookup,
  type GameData,
} from './_loadFixtures';

function summarizeBreakdown(b: BreakdownResult) {
  const applied = b.contributors.filter(c => c.applied);
  const dominated = b.contributors.filter(c => !c.applied);
  return {
    total: b.total,
    appliedCount: applied.length,
    dominatedCount: dominated.length,
    sources: applied.map(c => ({
      source: c.source,
      bonusType: c.bonusType || '(untyped)',
      value: c.value,
      target: c.target,
    })),
  };
}

function engineSummary(build: Build, gameData: GameData) {
  const r = runEngine({ build, ...gameData });
  return {
    diagnostics: r.diagnostics,
    abilityScores: Object.fromEntries(
      Object.entries(r.abilityScores).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    hitPoints: summarizeBreakdown(r.hitPoints),
    saves: {
      Fortitude: summarizeBreakdown(r.saves.Fortitude),
      Reflex:    summarizeBreakdown(r.saves.Reflex),
      Will:      summarizeBreakdown(r.saves.Will),
    },
    meleePower:      summarizeBreakdown(r.meleePower),
    rangedPower:     summarizeBreakdown(r.rangedPower),
    doublestrike:    summarizeBreakdown(r.doublestrike),
    doubleshot:      summarizeBreakdown(r.doubleshot),
    sneakAttackDice: summarizeBreakdown(r.sneakAttackDice),
    imbueDice:       summarizeBreakdown(r.imbueDice),
    meleeSpeed:      summarizeBreakdown(r.meleeSpeed),
    rangedSpeed:     summarizeBreakdown(r.rangedSpeed),
    healingAmp:      summarizeBreakdown(r.healingAmp),
    negativeHealingAmp: summarizeBreakdown(r.negativeHealingAmp),
    repairAmp:       summarizeBreakdown(r.repairAmp),
    ac:              summarizeBreakdown(r.ac),
    dodge:           summarizeBreakdown(r.dodge),
    prr:             summarizeBreakdown(r.prr),
    mrr:             summarizeBreakdown(r.mrr),
    spellResistance: summarizeBreakdown(r.spellResistance),
    arcaneSpellFailure: summarizeBreakdown(r.arcaneSpellFailure),
    casterLevel:     summarizeBreakdown(r.casterLevel),
    spellPenetration: summarizeBreakdown(r.spellPenetration),
    spellDCs: Object.fromEntries(
      Object.entries(r.spellDCs).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    universalSpellPower: summarizeBreakdown(r.universalSpellPower),
    universalSpellCriticalChance: summarizeBreakdown(r.universalSpellCriticalChance),
    universalSpellCriticalDamage: summarizeBreakdown(r.universalSpellCriticalDamage),
    spellPowers: Object.fromEntries(
      Object.entries(r.spellPowers).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    spellCriticalChance: Object.fromEntries(
      Object.entries(r.spellCriticalChance).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    spellCriticalDamage: Object.fromEntries(
      Object.entries(r.spellCriticalDamage).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    skills: Object.fromEntries(
      Object.entries(r.skills).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    slas: r.slas.map(s => ({
      name: s.name, castingClass: s.castingClass, category: s.category,
      cost: s.cost, maxCasterLevel: s.maxCasterLevel, cooldown: s.cooldown,
      charges: s.charges,
      source: s.source,
    })),
  };
}

describe('runEngine snapshots', () => {
  const gameData = loadGameData();
  const classSkillsByClassId = buildClassSkillsLookup(gameData);

  for (const c of FIXTURE_CASES) {
    it(`${c.name} engine output is stable`, async () => {
      const build = loadBuild(c.fixture, classSkillsByClassId);
      const summary = engineSummary(build, gameData);
      await expect(JSON.stringify(summary, null, 2))
        .toMatchFileSnapshot(resolve(SNAPSHOTS, `${c.name}.engine.snap.json`));
    });
  }
});
