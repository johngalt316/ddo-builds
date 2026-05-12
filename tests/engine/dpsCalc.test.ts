// @vitest-environment happy-dom
//
// DPS-pipeline snapshot — locks in the user-facing damage outputs the
// DPS pane derives from each reference build. Complements the
// engine-side runEngine snapshots: that test catches regressions in
// build → stats; this test catches regressions in stats → per-cast
// damage and stats → per-hit melee damage. Together they cover the
// full pipeline a user sees on the DPS panel.
//
// For each fixture we snapshot:
//   1. Magic abilities (class-trained DPS spells + DPS-capable SLAs)
//      — sorted by id; each entry shows the build-aware DPC + cost +
//      cooldown + standalone DPS.
//   2. Melee DPS — only when an actual melee weapon is equipped.
//      Skipped for ranged-only and unarmed builds where the gear's
//      baseDice is missing (handwraps with custom dice still resolve;
//      the helper returns null otherwise).
//
// Snapshot is intentionally aggregate, not per-component: per-component
// breakdowns reorder across procs/buffs/elements and churn on every
// game-data refresh. The aggregate DPC is what users compare against
// in-game numbers, so that's what we lock in.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { runEngine, type EngineResult } from '@/engine/runEngine';
import { getMagicAbilities, type MagicAbility } from '@/engine/dps/abilities';
import { damagePerCast, NO_DEBUFFS, type PerCastDamage } from '@/engine/dps/calculator';
import {
  buildStatsFromEngine, meleeDPS, weaponInfoFromGearItem,
  type MeleeDPSResult,
} from '@/engine/dps/meleeCalc';
import type { Build } from '@/types/build';
import {
  FIXTURE_CASES, SNAPSHOTS,
  loadBuild, loadGameData, buildClassSkillsLookup,
  type GameData,
} from './_loadFixtures';

/** Stable rounding for floats so cosmetic floating-point drift doesn't
 *  trip snapshots. Two decimals is well below what a user could read
 *  off the DPS panel and below the precision of the game's own UI. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function summarizeAbility(ab: MagicAbility, dpc: PerCastDamage) {
  const cycleTime = Math.max(ab.cooldown, ab.castTime, 1e-3);
  return {
    id:          ab.id,
    name:        ab.name,
    source:      ab.source,
    school:      ab.school,
    cost:        ab.cost,
    cooldown:    ab.cooldown,
    castTime:    ab.castTime,
    maxCasterLevel: ab.maxCasterLevel,
    maxTargetCap:   ab.maxTargetCap,
    casterLevelUsed: dpc.casterLevel,
    dpc:         r2(dpc.total),
    standaloneDPS: r2(dpc.total / cycleTime),
  };
}

function summarizeMelee(r: MeleeDPSResult) {
  // Topline numbers users compare against in-game tooltips. Skips
  // intermediate / timeline-only fields (mhBaseAPM etc.) which add noise.
  return {
    avgPerHit:           r2(r.avgPerHit),
    avgBaseDamage:       r2(r.avgBaseDamage),
    avgScaledDamage:     r2(r.avgScaledDamage),
    critThreatFaces:     r.critThreatFaces,
    critChance:          r2(r.critChance),
    critMultOnAll:       r2(r.critMultOnAll),
    critMultOn1920:      r2(r.critMultOn1920),
    totalW:              r2(r.totalW),
    damageStat:          r.damageStat,
    damageStatMod:       r.damageStatMod,
    meleePower:          r.meleePower,
    doublestrike:        r.doublestrike,
    mhAttacksPerMin:     r2(r.mhAttacksPerMin),
    ohAttacksPerMin:     r2(r.ohAttacksPerMin),
    effectiveMHPerMin:   r2(r.effectiveMHPerMin),
    effectiveOHPerMin:   r2(r.effectiveOHPerMin),
    totalEffectivePerMin:r2(r.totalEffectivePerMin),
    mhDPS:               r2(r.mhDPS),
    ohDPS:               r2(r.ohDPS),
    totalAutoDPS:        r2(r.totalAutoDPS),
  };
}

function dpsSummary(build: Build, gameData: GameData, engine: EngineResult) {
  // Build the magic ability list using the same path as the DPS UI.
  const abilities = getMagicAbilities(
    build,
    gameData.spells,
    gameData.classes,
    engine.slas,
    gameData.enhancementTrees,
    gameData.augments,
    engine,
    gameData.metamagics,
  );

  // Per-ability DPC with deterministic context — no metamagic SP (so
  // the snapshot reflects the unmodified spellcraft cost), no debuffs,
  // single target. The sneakAttackDice value comes from the engine so
  // SA-eligible abilities still show their bonus damage.
  const ctx = {
    sneakAttackDice: engine.sneakAttackDice.total,
    metamagicSP:     0,
    targetCount:     1,
  };
  const magicAbilities = abilities
    .map(ab => {
      const dpc = damagePerCast(ab, build, engine, ctx, NO_DEBUFFS);
      return summarizeAbility(ab, dpc);
    })
    // Sort by id (stable across game-data refreshes; SLA ids include
    // their source label so duplicates from different SLA sources stay
    // distinguishable).
    .sort((a, b) => a.id.localeCompare(b.id));

  // Melee DPS — only when the active gear set has a usable melee weapon.
  const activeSet = build.gearSets.find(g => g.name === build.activeGearSet)
                 ?? build.gearSets[0];
  const mainHand = activeSet?.items.find(i => i.slot === 'MainHand');
  let melee: ReturnType<typeof summarizeMelee> | null = null;
  if (mainHand) {
    const weaponInfo = weaponInfoFromGearItem(mainHand);
    if (weaponInfo) {
      const stats = buildStatsFromEngine(build, engine, weaponInfo);
      melee = summarizeMelee(meleeDPS(weaponInfo, stats));
    }
  }

  return {
    abilityCount: magicAbilities.length,
    abilities:    magicAbilities,
    melee,
  };
}

describe('DPS pipeline snapshots', () => {
  const gameData = loadGameData();
  const classSkillsByClassId = buildClassSkillsLookup(gameData);

  for (const c of FIXTURE_CASES) {
    it(`${c.name} DPS pipeline output is stable`, async () => {
      const build = loadBuild(c.fixture, classSkillsByClassId);
      const engine = runEngine({ build, ...gameData });
      const summary = dpsSummary(build, gameData, engine);
      await expect(JSON.stringify(summary, null, 2))
        .toMatchFileSnapshot(resolve(SNAPSHOTS, `${c.name}.dps.snap.json`));
    });
  }
});
