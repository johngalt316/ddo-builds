import { useMemo } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { runEngine, type EngineResult } from '@/engine/runEngine';
import type { Build } from '@/types/build';

/** Reaper-tree enhancement effects gated with `<Stance>Reaper</Stance>`
 *  only fire when the player is actually in Reaper Difficulty. The DPS
 *  panel's difficulty slider drives this dynamically: when the user
 *  picks R1-R10, treat "Reaper" as an active stance for engine
 *  evaluation so the gated bonuses surface in breakdowns alongside the
 *  always-on Reaper-tree effects. */
export function withReaperStance(build: Build, inReaper: boolean): Build {
  if (!inReaper) return build;
  const stances = build.activeStances ?? [];
  if (stances.includes('Reaper')) return build;
  return { ...build, activeStances: [...stances, 'Reaper'] };
}

/**
 * Runs the Phase-2 engine over the current build state and returns
 * per-stat BreakdownResults plus diagnostics.
 *
 * Returns null while game data is still loading, so callers can show a
 * skeleton state.
 */
export function useBreakdowns(): EngineResult | null {
  const build = useBuildStore(s => s.build);
  return useBreakdownsForBuild(build);
}

/**
 * Engine output for the active build, with the "Reaper" stance synthesized
 * in when `difficulty >= 1` (any Reaper tier R1-R10). Used by the DPS
 * editors so their stat panels reflect Reaper-conditional enhancement
 * bonuses (DireCore1's +50 SP "in Reaper", GrimCore1's HP per AP, etc.)
 * while keeping the Build editor's main Breakdowns tab on the non-reaper
 * baseline. Pass 0 for Elite (no adjustment).
 */
export function useReaperAdjustedBreakdowns(difficulty: number): EngineResult | null {
  const build = useBuildStore(s => s.build);
  const adjusted = useMemo(
    () => withReaperStance(build, difficulty >= 1),
    [build, difficulty],
  );
  return useBreakdownsForBuild(adjusted);
}

/**
 * Same as `useBreakdowns()` but lets the caller pass an arbitrary
 * Build snapshot — used by the DPS comparison view to evaluate a
 * non-active enhancement set without mutating the store.
 */
export function useBreakdownsForBuild(build: Build): EngineResult | null {
  const status = useGameDataStore(s => s.status);
  const classes = useGameDataStore(s => s.classes);
  const races = useGameDataStore(s => s.races);
  const feats = useGameDataStore(s => s.feats);
  const bonusTypes = useGameDataStore(s => s.bonusTypes);
  const enhancementTrees = useGameDataStore(s => s.enhancementTrees);
  const itemBuffs = useGameDataStore(s => s.itemBuffs);
  const setBonuses = useGameDataStore(s => s.setBonuses);
  const itemSetIndex = useGameDataStore(s => s.itemSetIndex);
  const augments = useGameDataStore(s => s.augments);
  const filigrees = useGameDataStore(s => s.filigrees);
  const filigreeSetBonuses = useGameDataStore(s => s.filigreeSetBonuses);
  const selfPartyBuffs = useGameDataStore(s => s.selfPartyBuffs);
  const guildBuffs = useGameDataStore(s => s.guildBuffs);

  return useMemo(() => {
    if (status !== 'ready' || classes.length === 0) return null;
    return runEngine({
      build, classes, races, feats, bonusTypes, enhancementTrees,
      itemBuffs, setBonuses, itemSetIndex, augments,
      filigrees, filigreeSetBonuses, selfPartyBuffs, guildBuffs,
    });
  }, [build, status, classes, races, feats, bonusTypes, enhancementTrees,
      itemBuffs, setBonuses, itemSetIndex, augments,
      filigrees, filigreeSetBonuses, selfPartyBuffs, guildBuffs]);
}
