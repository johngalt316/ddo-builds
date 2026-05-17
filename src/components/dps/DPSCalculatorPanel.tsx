// DPS Calculator panel — coordinator.
//
// Owns cross-editor state (debuffs, compare set, difficulty, target count,
// sim duration) and routes to whichever editor is active.  Each editor
// (Magic / Melee) lives in its own file under `editors/` and owns only the
// state unique to its rotation type.

import { useEffect, useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useBreakdownsForBuild, withReaperStance } from '@/hooks/useBreakdowns';
import type { Build } from '@/types/build';
import { getActiveEnhancementSet } from '@/types/build';
import type { RotationStep } from '@/engine/dps/rotation';
import { initialDebuffState, type DebuffState } from '@/engine/dps/debuffs';
import { ManageDebuffsDialog } from './DebuffsPanel';
import { MagicRotationEditor } from './editors/MagicRotationEditor';
import { MeleeEditor } from './editors/MeleeEditor';
import { RangedEditor } from './editors/RangedEditor';
import {
  EMPTY_STEPS,
  DIFFICULTY_LABELS,
  OBJECTIVE_LABELS,
  type RotationType,
  type DifficultyIndex,
  type OptimizerObjective,
} from './editors/shared';
import styles from './DPSCalculatorPanel.module.css';

// Re-export the type so existing imports keep working.
export type { RotationType, DifficultyIndex, OptimizerObjective } from './editors/shared';

// ── Rotation-type auto-detection ────────────────────────────────────────────
//
// Picks 'magic', 'melee', or 'ranged' from the build's dominant class.
// Rules:
//   • Arcane Trickster (class or tree) → magic  (spellcasting rogue)
//   • Wizard, Sorcerer, Warlock, Favored Soul, Alchemist, Cleric, Druid → magic
//   • Ranger, Artificer → ranged
//   • Everything else (Fighter, Monk, Paladin, Barbarian, Bard, Rogue, …) → melee

const MAGIC_CLASS_IDS = new Set([
  'wizard', 'sorcerer', 'warlock', 'favored_soul', 'alchemist',
  'cleric', 'druid',
  'arcane_trickster',   // prestige class
]);

const RANGED_CLASS_IDS = new Set([
  'ranger', 'artificer',
]);

const ARCANE_TRICKSTER_TREE = 'arcane trickster';

function detectRotationType(build: Build): RotationType {
  if (!build.classes.length) return 'melee';

  // Dominant class by level count.
  const dominant = [...build.classes].sort((a, b) => b.levels - a.levels)[0]!;
  const classId  = dominant.classId.toLowerCase();

  if (MAGIC_CLASS_IDS.has(classId)) return 'magic';
  if (RANGED_CLASS_IDS.has(classId)) return 'ranged';

  // Rogue with Arcane Trickster tree → magic.
  if (classId === 'rogue' || classId.includes('rogue')) {
    const set = getActiveEnhancementSet(build);
    const hasATTree = set.enhancements.some(
      s => s.treeId.toLowerCase() === ARCANE_TRICKSTER_TREE,
    );
    if (hasATTree) return 'magic';
  }

  return 'melee';
}

export function DPSCalculatorPanel() {
  const [rotationType, setRotationType] = useState<RotationType>('magic');
  const [difficulty, setDifficulty]     = useState<DifficultyIndex>(0);
  const [targetCount, setTargetCount]   = useState<number>(1);
  const [objective, setObjective]       = useState<OptimizerObjective>('sustained');
  const [objectiveOpen, setObjectiveOpen] = useState(false);

  // Re-detect rotation type when a new build is loaded (class structure changes).
  const build = useBuildStore(s => s.build);
  const classFingerprint = build.classes.map(c => `${c.classId}:${c.levels}`).join(',');
  useEffect(() => {
    setRotationType(detectRotationType(build));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classFingerprint, build.activeEnhancementSet]);

  // ── Magic rotation state ────────────────────────────────────────────
  const dpsRotation     = useBuildStore(s => s.build.dpsRotation);
  const setDpsRotation  = useBuildStore(s => s.setDpsRotation);
  const magicSteps        = dpsRotation?.magicSteps ?? EMPTY_STEPS;
  const activeAbilityIds  = dpsRotation?.activeAbilityIds;
  const auto              = dpsRotation?.auto ?? true;
  const setMagicSteps        = (next: RotationStep[])  => setDpsRotation({ magicSteps: next });
  const setActiveAbilityIds  = (next: string[])        => setDpsRotation({ activeAbilityIds: next });
  const setAuto              = (next: boolean)         => setDpsRotation({ auto: next });
  const [manageOpen, setManageOpen] = useState(false);

  // ── Shared cross-editor state ───────────────────────────────────────
  // Debuffs and compare-set selection are independent of rotation type —
  // the same enemy debuffs and enhancement comparison apply whether the
  // user is viewing magic or melee DPS.  Lifted here so switching tabs
  // doesn't reset either value.

  const [debuffState, setDebuffState] = useState<DebuffState>(() => initialDebuffState());
  const [debuffsOpen, setDebuffsOpen] = useState(false);
  const [simDuration, setSimDuration] = useState(60);

  const [compareSetName, setCompareSetName] = useState<string | null>(null);
  const compareBuild = useMemo<typeof build>(() => {
    // Match what useReaperAdjustedBreakdowns does for the primary build:
    // when in Reaper difficulty, synthesize the Reaper stance so the
    // compare set's breakdowns are also computed with reaper-gated
    // bonuses firing (otherwise the delta vs. the primary build would
    // double-count the gating).
    const inReaper = difficulty >= 1;
    let b = (!compareSetName || compareSetName === build.activeEnhancementSet)
      ? build
      : { ...build, activeEnhancementSet: compareSetName };
    b = withReaperStance(b, inReaper);
    return b;
  }, [build, compareSetName, difficulty]);
  const compareBreakdowns = useBreakdownsForBuild(compareBuild);

  function handleGenerate() {
    // TODO: optimizer
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>DPS Calculator</h2>
        <span className={styles.tag}>Work in Progress</span>
      </header>

      {/* Controls */}
      <div className={styles.controls}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Attack Type</span>
          <select
            className={styles.select}
            value={rotationType}
            onChange={e => setRotationType(e.target.value as RotationType)}
          >
            <option value="magic">Magic</option>
            <option value="melee">Melee</option>
            <option value="ranged">Ranged</option>
          </select>
        </label>

        <div className={styles.optimizer}>
          <button
            className={styles.optimizerBtn}
            onClick={handleGenerate}
            disabled
            title="Optimizer not yet implemented (Phase 6.6)"
          >
            TODO: Generate Rotation · {OBJECTIVE_LABELS[objective]}
          </button>
          <button
            className={styles.optimizerChevron}
            onClick={() => setObjectiveOpen(o => !o)}
            disabled
            aria-haspopup="menu"
            aria-expanded={objectiveOpen}
            title="Optimizer objective (not yet implemented)"
          >▾</button>
          {objectiveOpen && (
            <div className={styles.optimizerMenu} role="menu">
              {(Object.keys(OBJECTIVE_LABELS) as OptimizerObjective[]).map(o => (
                <button
                  key={o}
                  role="menuitem"
                  className={o === objective ? styles.optimizerMenuItemActive : styles.optimizerMenuItem}
                  onClick={() => { setObjective(o); setObjectiveOpen(false); }}
                >
                  {OBJECTIVE_LABELS[o]}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Difficulty <span className={styles.fieldValue}>{DIFFICULTY_LABELS[difficulty]}</span>
            {difficulty >= 1 && (
              <span
                className={styles.fieldValue}
                style={{ marginLeft: '0.4rem', color: 'var(--color-reaper, #ff7066)' }}
                title="Reaper-conditional enhancement bonuses (DireCore1 +50 SP, GrimCore1 +10 HP, etc.) are firing for this calculation"
              >
                · Reaper stance
              </span>
            )}
          </span>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={10}
            step={1}
            value={difficulty}
            onChange={e => setDifficulty(Number(e.target.value) as DifficultyIndex)}
          />
          <span className={styles.sliderTicks}>
            <span>Elite</span>
            <span>R5</span>
            <span>R10</span>
          </span>
        </label>
      </div>

      {/* Body — by rotation type */}
      {rotationType === 'magic' ? (
        <MagicRotationEditor
          steps={magicSteps}
          setSteps={setMagicSteps}
          activeAbilityIds={activeAbilityIds}
          setActiveAbilityIds={setActiveAbilityIds}
          manageOpen={manageOpen}
          setManageOpen={setManageOpen}
          auto={auto}
          setAuto={setAuto}
          difficulty={difficulty}
          targetCount={targetCount}
          setTargetCount={setTargetCount}
          debuffState={debuffState}
          onManageDebuffs={() => setDebuffsOpen(true)}
          compareSetName={compareSetName}
          setCompareSetName={setCompareSetName}
          compareBuild={compareBuild}
          compareBreakdowns={compareBreakdowns}
          simDuration={simDuration}
          setSimDuration={setSimDuration}
        />
      ) : rotationType === 'melee' ? (
        <MeleeEditor
          difficulty={difficulty}
          targetCount={targetCount}
          setTargetCount={setTargetCount}
          debuffState={debuffState}
          onManageDebuffs={() => setDebuffsOpen(true)}
          compareSetName={compareSetName}
          setCompareSetName={setCompareSetName}
          compareBuild={compareBuild}
          compareBreakdowns={compareBreakdowns}
          simDuration={simDuration}
          setSimDuration={setSimDuration}
        />
      ) : (
        <RangedEditor
          difficulty={difficulty}
          targetCount={targetCount}
          setTargetCount={setTargetCount}
          debuffState={debuffState}
          onManageDebuffs={() => setDebuffsOpen(true)}
          compareSetName={compareSetName}
          setCompareSetName={setCompareSetName}
          compareBuild={compareBuild}
          compareBreakdowns={compareBreakdowns}
          simDuration={simDuration}
          setSimDuration={setSimDuration}
        />
      )}

      {/* ManageDebuffsDialog lives here — shared across all editors */}
      <ManageDebuffsDialog
        open={debuffsOpen}
        state={debuffState}
        build={build}
        onChange={setDebuffState}
        onClose={() => setDebuffsOpen(false)}
      />

    </section>
  );
}
