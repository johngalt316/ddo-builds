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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { getMagicAbilities, type MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';
import { fillToOneMinute, resolveTimeline } from '@/engine/dps/timing';
import {
  damagePerCast,
  rotationDPS,
  type AbilityDamageInfo,
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
import { ActiveProcsList } from './ActiveProcsList';
import { RotationDPSSummary } from './RotationDPSSummary';
import { RotationChart, type DamageEvent } from './RotationChart';
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
  //
  // Each entry carries:
  //   • damage      — full per-cast breakdown (DPC) including procs/buffs.
  //   • cycleTime   — effective seconds between casts if the spell were
  //                   spammed alone (max of effective cooldown and cast
  //                   time, never zero).
  //   • dps         — DPC ÷ cycleTime — the spell's sustained throughput
  //                   when spammed standalone, useful for comparing
  //                   spells in the palette regardless of their
  //                   cooldowns.
  const damageByAbility = useMemo(() => {
    const m = new Map<string, AbilityDamageInfo>();
    if (!breakdowns) return m;
    const ctx = {
      sneakAttackDice: breakdowns.sneakAttackDice.total,
      metamagicSP:     300,
    };
    const cdMul = Math.max(0, 1 - cooldownReductionPct / 100);
    for (const a of abilities) {
      const damage     = damagePerCast(a, build, breakdowns, ctx, debuffs);
      const effectiveCD = a.cooldown * cdMul;
      const cycleTime  = Math.max(effectiveCD, a.castTime, 1e-3);
      m.set(a.id, {
        damage,
        cycleTime,
        dps: damage.total / cycleTime,
      });
    }
    return m;
  }, [abilities, build, breakdowns, debuffs, cooldownReductionPct]);

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

  // Cycle length + per-cast damage events drive the chart, simulation
  // playhead, and live stat readouts.
  const { cycleSeconds: rotationCycleSeconds, damageEvents } = useMemo(() => {
    if (steps.length === 0 || !breakdowns) {
      return { cycleSeconds: 0, damageEvents: [] as DamageEvent[] };
    }
    const t = resolveTimeline(steps, abilityById, cooldownReductionPct);
    const ctx = {
      sneakAttackDice: breakdowns.sneakAttackDice.total,
      metamagicSP:     300,
    };
    const events: DamageEvent[] = t.steps.map(r => ({
      time:   r.startTime,
      damage: damagePerCast(r.ability, build, breakdowns, ctx, debuffs).total,
      spell:  r.ability.displayName,
    }));
    return { cycleSeconds: t.totalSeconds, damageEvents: events };
  }, [steps, abilityById, cooldownReductionPct, build, breakdowns, debuffs]);

  // ── Simulation animation ───────────────────────────────────────────
  // simTime walks 0 → cycleSeconds in real time. requestAnimationFrame
  // drives the playhead, the chart's reveal, and the live Damage stat.
  const [simTime, setSimTime]       = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const simStartedAt = useRef(0);

  // Auto-stop and reset to 0 when the rotation actually changes — the
  // previous simulation no longer maps onto the new timeline. Keyed on
  // `steps` (user reordered/added/removed) and `rotationCycleSeconds`
  // (cycle length changed because of CDR / spell catalog). Avoids
  // spurious resets when `breakdowns` re-references but the cycle is
  // unchanged.
  useEffect(() => {
    setSimRunning(false);
    setSimTime(0);
  }, [steps, rotationCycleSeconds]);

  useEffect(() => {
    if (!simRunning || rotationCycleSeconds <= 0) return;
    let cancelled = false;
    simStartedAt.current = performance.now() - simTime * 1000;
    let raf = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = (now - simStartedAt.current) / 1000;
      if (elapsed >= rotationCycleSeconds) {
        setSimTime(rotationCycleSeconds);
        setSimRunning(false);
        return;
      }
      setSimTime(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // simTime is read but not a dep — it's the cursor we're advancing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simRunning, rotationCycleSeconds]);

  function onSimulateClick() {
    if (rotationCycleSeconds <= 0) return;
    if (simRunning) {
      setSimRunning(false);
      return;
    }
    // If we're at (or past) the end, restart from 0; otherwise resume.
    if (simTime >= rotationCycleSeconds - 1e-3) setSimTime(0);
    setSimRunning(true);
  }

  // Cumulative damage at the current sim time — drives the live stats.
  const cumulativeDamage = useMemo(() => {
    let s = 0;
    for (const e of damageEvents) {
      if (e.time <= simTime + 1e-6) s += e.damage; else break;
    }
    return s;
  }, [damageEvents, simTime]);

  // SP per minute = sum of (cost × cpm) over abilities in the rotation.
  const spPerMinute = useMemo(() => {
    if (rotationCycleSeconds <= 0) return 0;
    const counts = new Map<string, number>();
    for (const s of steps) counts.set(s.abilityId, (counts.get(s.abilityId) ?? 0) + 1);
    const cyclesPerMin = 60 / rotationCycleSeconds;
    let sp = 0;
    for (const [id, count] of counts) {
      const a = abilityById.get(id);
      if (!a) continue;
      sp += a.cost * count * cyclesPerMin;
    }
    return sp;
  }, [steps, abilityById, rotationCycleSeconds]);

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
    // One click fills the rotation toward 60 seconds: repeatedly slot the
    // ability into existing cooldown gaps, falling back to append, until
    // adding one more would push the cycle past a minute. Lets the user
    // build a full one-minute plan with single clicks rather than spamming.
    setSteps(fillToOneMinute(steps, ability, abilityById, cooldownReductionPct));
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
      <ActiveProcsList
        build={build}
        engine={breakdowns}
        sneakAttackDice={breakdowns?.sneakAttackDice.total ?? 0}
      />
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
        playheadTime={simRunning || simTime > 0 ? simTime : undefined}
        activeBuffs={rotationBreakdown?.activeBuffs}
        damageByAbility={damageByAbility}
      />
      <RotationDPSSummary
        breakdown={rotationBreakdown}
        cycleSeconds={rotationCycleSeconds}
      />

      {/* Live stats — DPS / DPM are static for the rotation; Damage
          accumulates with the simulation cursor. */}
      <div className={styles.stats}>
        <Metric label="DPS"
          value={rotationBreakdown ? Math.round(rotationBreakdown.totalDPS).toLocaleString() : '—'} />
        <Metric label="DPM"
          value={rotationBreakdown ? Math.round(rotationBreakdown.totalPerMinute).toLocaleString() : '—'} />
        <Metric label="SPM"
          value={spPerMinute > 0 ? Math.round(spPerMinute).toLocaleString() : '—'} />
        <Metric label="Damage"
          value={damageEvents.length > 0 ? Math.round(cumulativeDamage).toLocaleString() : '—'} />
      </div>

      <RotationChart
        events={damageEvents}
        cycleSeconds={rotationCycleSeconds}
        currentTime={simTime}
      />

      <div className={styles.simulateRow}>
        <button
          type="button"
          className={styles.simulateBtn}
          onClick={onSimulateClick}
          disabled={rotationCycleSeconds <= 0}
          title={
            rotationCycleSeconds <= 0
              ? 'Add a spell to the rotation to simulate'
              : (simRunning ? 'Pause simulation' : 'Run one rotation cycle')
          }
        >
          {simRunning ? '⏸ Pause' : '▶ Simulate'}
        </button>
        <span className={styles.simulateClock}>
          t = {simTime.toFixed(2)}s
          {rotationCycleSeconds > 0 && ` / ${rotationCycleSeconds.toFixed(2)}s`}
        </span>
      </div>

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
