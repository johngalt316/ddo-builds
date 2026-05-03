import { useMemo } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { runEngine, type EngineResult } from '@/engine/runEngine';

/**
 * Runs the Phase-2 engine over the current build state and returns
 * per-stat BreakdownResults plus diagnostics.
 *
 * Returns null while game data is still loading, so callers can show a
 * skeleton state.
 */
export function useBreakdowns(): EngineResult | null {
  const build = useBuildStore(s => s.build);
  const status = useGameDataStore(s => s.status);
  const classes = useGameDataStore(s => s.classes);
  const races = useGameDataStore(s => s.races);
  const feats = useGameDataStore(s => s.feats);
  const bonusTypes = useGameDataStore(s => s.bonusTypes);
  const enhancementTrees = useGameDataStore(s => s.enhancementTrees);
  const itemBuffs = useGameDataStore(s => s.itemBuffs);
  const setBonuses = useGameDataStore(s => s.setBonuses);
  const itemSetIndex = useGameDataStore(s => s.itemSetIndex);

  return useMemo(() => {
    if (status !== 'ready' || classes.length === 0) return null;
    return runEngine({
      build, classes, races, feats, bonusTypes, enhancementTrees,
      itemBuffs, setBonuses, itemSetIndex,
    });
  }, [build, status, classes, races, feats, bonusTypes, enhancementTrees,
      itemBuffs, setBonuses, itemSetIndex]);
}
