// Phase 6.1 + 6.2 — DPS Calculator panel.
//
// 6.1 = controls + layout shell.
// 6.2 = magic ability palette + draggable timeline (this file's
//        `MagicRotationEditor`). Melee / ranged are gated until 6.7+.
//
// Subsequent phases fill in:
//   6.3 damage math + difficulty model,
//   6.4 simulation runner + stats,
//   6.5 live chart,
//   6.6 optimizer.
//
// Local state only — none of these controls drive the engine yet.

import { useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { getMagicAbilities, type MagicAbility } from '@/engine/dps/abilities';
import { newRotationStep, type RotationStep } from '@/engine/dps/rotation';
import { findFirstAvailableSlot, resolveTimeline } from '@/engine/dps/timing';
import {
  damagePerCast,
  rotationDPS,
  type PerCastDamage,
} from '@/engine/dps/calculator';
import {
  aggregateDebuffs,
  initialDebuffState,
  type DebuffState,
} from '@/engine/dps/debuffs';
import { RotationPalette } from './RotationPalette';
import { RotationTimeline } from './RotationTimeline';
import { ManageActiveDialog } from './ManageActiveDialog';
import { DebuffsSummary, ManageDebuffsDialog } from './DebuffsPanel';
import { RotationDPSSummary } from './RotationDPSSummary';
import styles from './DPSCalculatorPanel.module.css';

export type RotationType = 'melee' | 'ranged' | 'magic';
export type OptimizerObjective = 'burst' | 'sustained' | 'efficient';
/**
 * Difficulty index: 0 = Elite, 1 = R1, …, 10 = R10. Casual/Normal/Hard are
 * intentionally absent — they don't affect damage calculations.
 */
export type DifficultyIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const DIFFICULTY_LABELS: Record<DifficultyIndex, string> = {
  0: 'Elite', 1: 'R1', 2: 'R2', 3: 'R3', 4: 'R4', 5: 'R5',
  6: 'R6', 7: 'R7', 8: 'R8', 9: 'R9', 10: 'R10',
};

const OBJECTIVE_LABELS: Record<OptimizerObjective, string> = {
  burst:     'Burst DPS',
  sustained: 'Max Sustained DPS',
  efficient: 'Resource Efficient',
};

export function DPSCalculatorPanel() {
  const [rotationType, setRotationType] = useState<RotationType>('magic');
  const [difficulty, setDifficulty]     = useState<DifficultyIndex>(0);
  const [objective, setObjective]       = useState<OptimizerObjective>('sustained');
  const [objectiveOpen, setObjectiveOpen] = useState(false);

  // ── Magic rotation state (6.2) ──────────────────────────────────────
  // Per-rotation-type lists keep edits stable when the user toggles types
  // (melee/ranged are placeholders today but the shape generalizes).
  const [magicSteps, setMagicSteps] = useState<RotationStep[]>([]);
  // Active priority list: ordered subset of trained damaging spells. The
  // ORDER carries meaning — it's the spell priority the optimizer / palette
  // present to the user. `undefined` = first-time use, default to
  // "everything active in catalog order". Once the user Applies in Manage,
  // this becomes a concrete ordered array the user controls.
  const [activeAbilityIds, setActiveAbilityIds] = useState<string[] | undefined>(undefined);
  const [manageOpen, setManageOpen] = useState(false);
  // Auto: locks rotation order (the optimizer is the authority).
  const [auto, setAuto] = useState(false);

  function handleGenerate() {
    // 6.6 will populate this.
  }
  function handleSimulate() {
    // 6.4 will populate this.
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>DPS Calculator</h2>
        <span className={styles.tag}>Phase 6 — work in progress</span>
      </header>

      {/* Controls */}
      <div className={styles.controls}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Rotation</span>
          <select
            className={styles.select}
            value={rotationType}
            onChange={e => setRotationType(e.target.value as RotationType)}
          >
            <option value="magic">Magic</option>
            <option value="melee">Melee (coming soon)</option>
            <option value="ranged">Ranged (coming soon)</option>
          </select>
        </label>

        <div className={styles.optimizer}>
          <button
            className={styles.optimizerBtn}
            onClick={handleGenerate}
            title={`Generate optimal rotation (${OBJECTIVE_LABELS[objective]})`}
          >
            Generate Rotation · {OBJECTIVE_LABELS[objective]}
          </button>
          <button
            className={styles.optimizerChevron}
            onClick={() => setObjectiveOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={objectiveOpen}
            title="Choose objective"
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

        <button
          className={styles.simulateBtn}
          onClick={handleSimulate}
        >
          ▶ Simulate
        </button>
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
        />
      ) : (
        <div className={styles.timelinePlaceholder}>
          {rotationType === 'melee' ? 'Melee' : 'Ranged'} rotations land in a future phase — Phase 6 ships magic end-to-end first.
        </div>
      )}

      {/* Stats display */}
      <div className={styles.stats}>
        <Metric label="DPS"    value="—" />
        <Metric label="DPM"    value="—" />
        <Metric label="SPM"    value="—" />
        <Metric label="Damage" value="—" />
      </div>

      {/* Chart placeholder */}
      <div className={styles.chart}>
        <div className={styles.chartPlaceholder}>
          Damage chart · stacked-by-element with overall (Phase 6.5)
        </div>
      </div>
    </section>
  );
}

// ── Magic rotation editor ────────────────────────────────────────────

interface MagicRotationEditorProps {
  steps: RotationStep[];
  setSteps: (next: RotationStep[]) => void;
  activeAbilityIds: string[] | undefined;
  setActiveAbilityIds: (next: string[]) => void;
  manageOpen: boolean;
  setManageOpen: (next: boolean) => void;
  auto: boolean;
  setAuto: (next: boolean) => void;
}

function MagicRotationEditor({
  steps, setSteps,
  activeAbilityIds, setActiveAbilityIds,
  manageOpen, setManageOpen,
  auto, setAuto,
}: MagicRotationEditorProps) {
  const build       = useBuildStore(s => s.build);
  const spells      = useGameDataStore(s => s.spells);
  const classes     = useGameDataStore(s => s.classes);
  const breakdowns  = useBreakdowns();
  // Build's spell cooldown reduction (sum of all sources, percent).
  const cooldownReductionPct = breakdowns?.spellCooldownReduction.total ?? 0;
  // SLAs come and go with build state — feed them into the catalog so
  // the palette refreshes when a feat / enhancement that grants one is
  // toggled.
  const slas = useMemo(() => breakdowns?.slas ?? [], [breakdowns]);

  const abilities = useMemo(
    () => getMagicAbilities(build, spells, classes, slas),
    [build, spells, classes, slas],
  );
  const abilityById = useMemo(() => {
    const m = new Map<string, MagicAbility>();
    for (const a of abilities) m.set(a.id, a);
    return m;
  }, [abilities]);

  // Active debuffs the user has toggled on. Lives in panel-local state
  // for now; promote to persisted build state if it ever needs to survive
  // reloads. The user picks Self / Party scope per debuff (informational
  // only — math is identical regardless of scope).
  const [debuffState, setDebuffState] = useState<DebuffState>(() => initialDebuffState());
  const [debuffsOpen, setDebuffsOpen] = useState(false);
  const debuffs = useMemo(() => aggregateDebuffs(debuffState), [debuffState]);

  // Per-spell damage estimate, refreshed on any build / engine / debuff
  // change. Used by the palette tooltip + visible per-tile badge for
  // cross-checking against in-game numbers. Metamagic SP still defaults
  // to 300 until we expose a panel input that reads metamagic toggles.
  const damageByAbility = useMemo(() => {
    const m = new Map<string, PerCastDamage>();
    if (!breakdowns) return m;
    const ctx = {
      sneakAttackDice: breakdowns.sneakAttackDice.total,
      metamagicSP:     300,
    };
    for (const a of abilities) {
      m.set(a.id, damagePerCast(a, build, breakdowns, ctx, debuffs));
    }
    return m;
  }, [abilities, build, breakdowns, debuffs]);

  // Whole-rotation breakdown — total per-min damage + per-component
  // contributions. Drives the RotationDPSSummary below the timeline.
  // Recomputes whenever the rotation, build, debuffs, or CDR changes.
  const rotationBreakdown = useMemo(() => {
    if (!breakdowns) return null;
    const ctx = {
      sneakAttackDice: breakdowns.sneakAttackDice.total,
      metamagicSP:     300,
    };
    return rotationDPS(steps, abilities, build, breakdowns, ctx, debuffs, cooldownReductionPct);
  }, [steps, abilities, build, breakdowns, debuffs, cooldownReductionPct]);

  // Cycle length for the summary header, kept in sync with the timeline.
  const rotationCycleSeconds = useMemo(() => {
    if (steps.length === 0) return 0;
    return resolveTimeline(steps, abilityById, cooldownReductionPct).totalSeconds;
  }, [steps, abilityById, cooldownReductionPct]);

  // First-time / unset Active = "everything is active in catalog order" so
  // the panel works out of the box without forcing the user through the
  // Manage dialog. Once the user Applies in the dialog, `activeAbilityIds`
  // becomes a concrete ordered array driving palette + priority order.
  const activeAbilities = useMemo(() => {
    if (activeAbilityIds === undefined) return abilities;
    const byId = new Map<string, MagicAbility>();
    for (const a of abilities) byId.set(a.id, a);
    return activeAbilityIds.flatMap(id => {
      const a = byId.get(id);
      return a ? [a] : [];
    });
  }, [abilities, activeAbilityIds]);

  function onAdd(ability: MagicAbility) {
    // Try to slot the new cast into an existing cooldown gap so the
    // rotation doesn't lengthen unnecessarily. Falls back to append when
    // no suitable gap exists.
    const idx  = findFirstAvailableSlot(steps, ability, abilityById, cooldownReductionPct);
    const next = [...steps];
    next.splice(idx, 0, newRotationStep(ability.id));
    setSteps(next);
  }
  function onReorder(from: number, to: number) {
    if (from === to) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setSteps(next);
  }
  function onRemove(key: string) {
    setSteps(steps.filter(s => s.key !== key));
  }
  function onClear() {
    setSteps([]);
  }

  // In-place reorder of the active priority list, driven by drag/drop on
  // the palette. We materialize the current order (resolving the `undefined`
  // "first-time" default) then splice/insert and persist.
  function onReorderActive(from: number, to: number) {
    if (from === to) return;
    const current = activeAbilityIds ?? abilities.map(a => a.id);
    if (from < 0 || from >= current.length || to < 0 || to >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setActiveAbilityIds(next);
  }

  // Snapshot the working "active" list the dialog should boot with —
  // either the user's saved priority list or the full catalog as a
  // first-time default.
  const dialogInitial = activeAbilityIds ?? abilities.map(a => a.id);

  return (
    <div className={styles.editor}>
      <DebuffsSummary state={debuffState} onManage={() => setDebuffsOpen(true)} />
      <ManageDebuffsDialog
        open={debuffsOpen}
        state={debuffState}
        onChange={setDebuffState}
        onClose={() => setDebuffsOpen(false)}
      />
      <RotationPalette
        abilities={activeAbilities}
        totalTrained={abilities.length}
        onAdd={onAdd}
        onManage={() => setManageOpen(true)}
        onReorder={onReorderActive}
        damageByAbility={damageByAbility}
      />
      <RotationTimeline
        steps={steps}
        abilityById={abilityById}
        cooldownReductionPct={cooldownReductionPct}
        auto={auto}
        onAutoChange={setAuto}
        onReorder={onReorder}
        onRemove={onRemove}
        onClear={onClear}
      />
      <RotationDPSSummary
        breakdown={rotationBreakdown}
        cycleSeconds={rotationCycleSeconds}
      />
      <ManageActiveDialog
        open={manageOpen}
        abilities={abilities}
        active={dialogInitial}
        onClose={() => setManageOpen(false)}
        onApply={setActiveAbilityIds}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}
