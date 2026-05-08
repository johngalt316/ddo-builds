// Shared types and constants for the DPS editors.
//
// `DPSCalculatorPanel` owns cross-editor state (debuffs, compare set,
// difficulty, target count, sim duration) and passes it down via
// `SharedEditorProps`.  Each editor (Magic / Melee) extends this with
// its own rotation-type-specific props.

import type { Build } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import type { DebuffState } from '@/engine/dps/debuffs';
import type { RotationStep } from '@/engine/dps/rotation';

export type RotationType = 'melee' | 'ranged' | 'magic';

export type OptimizerObjective = 'burst' | 'sustained' | 'efficient';

/**
 * Difficulty index: 0 = Elite, 1 = R1, …, 10 = R10. Casual/Normal/Hard are
 * intentionally absent — they don't affect damage calculations.
 */
export type DifficultyIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const DIFFICULTY_LABELS: Record<DifficultyIndex, string> = {
  0: 'Elite', 1: 'R1', 2: 'R2', 3: 'R3', 4: 'R4', 5: 'R5',
  6: 'R6', 7: 'R7', 8: 'R8', 9: 'R9', 10: 'R10',
};

export const OBJECTIVE_LABELS: Record<OptimizerObjective, string> = {
  burst:     'Burst DPS',
  sustained: 'Max Sustained DPS',
  efficient: 'Resource Efficient',
};

/** Available enemy targets in the simulation (1–5). */
export const TARGET_LABELS: Record<number, string> = {
  1: 'Single Target',
  2: 'Group of 2',
  3: 'Group of 3',
  4: 'Group of 4',
  5: 'Group of 5',
};

/** Stable empty-array ref so selector returns the same reference each
 *  render when the build has no rotation set yet. Without this, `?? []`
 *  mints a fresh array per render and invalidates downstream useMemos. */
export const EMPTY_STEPS: RotationStep[] = [];

export const SIM_DURATION_OPTIONS: { label: string; value: number }[] = [
  { label: '5s',    value: 5   },
  { label: '10s',   value: 10  },
  { label: '15s',   value: 15  },
  { label: '30s',   value: 30  },
  { label: '1 min', value: 60  },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '10 min',value: 600 },
];

export interface SharedEditorProps {
  difficulty: DifficultyIndex;
  targetCount: number;
  setTargetCount: (next: number) => void;
  debuffState: DebuffState;
  onManageDebuffs: () => void;
  compareSetName: string | null;
  setCompareSetName: (name: string | null) => void;
  compareBuild: Build;
  compareBreakdowns: EngineResult | null;
  /** Simulation window length in seconds (configurable 5s–600s). */
  simDuration: number;
  setSimDuration: (next: number) => void;
}
