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
import { useBreakdowns, useBreakdownsForBuild } from '@/hooks/useBreakdowns';
import { getMagicAbilities, type MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';
import { fillToOneMinute, findFirstAvailableSlot, resolveTimeline } from '@/engine/dps/timing';
import { newRotationStep } from '@/engine/dps/rotation';
import {
  damagePerCast,
  rotationDPS,
  type AbilityDamageInfo,
} from '@/engine/dps/calculator';
import { computeMetamagicSP } from '@/engine/dps/procs';
import {
  aggregateDebuffs,
  initialDebuffState,
  type DebuffState,
} from '@/engine/dps/debuffs';
import { spellDamageMultiplier } from '@/engine/dps/difficulty';
import { RotationPalette } from './RotationPalette';
import { RotationTimeline } from './RotationTimeline';
import { ManageActiveDialog } from './ManageActiveDialog';
import { DebuffsSummary, ManageDebuffsDialog } from './DebuffsPanel';
import { ActiveProcsList } from './ActiveProcsList';
import { BuffsList } from './BuffsList';
import { RotationDPSSummary } from './RotationDPSSummary';
import { RotationChart, type DamageEvent } from './RotationChart';
import { DamageSourceSummary } from './DamageSourceSummary';
import styles from './DPSCalculatorPanel.module.css';

export type RotationType = 'melee' | 'ranged' | 'magic';

/** Stable empty-array ref so the panel's `magicSteps` selector returns
 *  the same reference each render when the build has no rotation set
 *  yet. Without this, `?? []` would mint a fresh array per render and
 *  invalidate every downstream useMemo that depends on `steps`. */
const EMPTY_STEPS: RotationStep[] = [];
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
  // Persisted on the Build (`build.dpsRotation`) so the rotation
  // round-trips through share-URL encoding. Local mutators delegate to
  // `setDpsRotation` which merges into the saved blob.
  const dpsRotation     = useBuildStore(s => s.build.dpsRotation);
  const setDpsRotation  = useBuildStore(s => s.setDpsRotation);
  const magicSteps        = dpsRotation?.magicSteps ?? EMPTY_STEPS;
  const activeAbilityIds  = dpsRotation?.activeAbilityIds;        // undefined = first-time
  // Auto = "auto-fill the timeline toward a 1-minute cycle on each
  // palette click". Default-on so a single click materializes a usable
  // rotation; flip it off to add one cast at a time, with cooldown
  // spacing handled by `findFirstAvailableSlot`.
  const auto              = dpsRotation?.auto ?? true;
  const setMagicSteps        = (next: RotationStep[])      => setDpsRotation({ magicSteps: next });
  const setActiveAbilityIds  = (next: string[])            => setDpsRotation({ activeAbilityIds: next });
  const setAuto              = (next: boolean)             => setDpsRotation({ auto: next });

  const [manageOpen, setManageOpen] = useState(false);

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
          difficulty={difficulty}
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
  /** Reaper difficulty index (0 = Elite, 10 = R10). Used to scale all
   *  spell-typed damage by the wiki's per-difficulty multiplier. */
  difficulty: DifficultyIndex;
}

function MagicRotationEditor({
  steps, setSteps,
  activeAbilityIds, setActiveAbilityIds,
  manageOpen, setManageOpen,
  auto, setAuto,
  difficulty,
}: MagicRotationEditorProps) {
  const build       = useBuildStore(s => s.build);
  const spells      = useGameDataStore(s => s.spells);
  const classes     = useGameDataStore(s => s.classes);
  const enhancementTrees = useGameDataStore(s => s.enhancementTrees);
  const augments         = useGameDataStore(s => s.augments);
  const breakdowns  = useBreakdowns();
  // ── Side-by-side comparison ─────────────────────────────────────────
  // Pick another EnhancementSet to evaluate against the active one. The
  // engine + rotation are re-run with `activeEnhancementSet` swapped to
  // the chosen set's name; nothing in the store mutates.
  const [compareSetName, setCompareSetName] = useState<string | null>(null);
  const compareBuild = useMemo<typeof build>(() => {
    if (!compareSetName) return build;
    if (compareSetName === build.activeEnhancementSet) return build;
    return { ...build, activeEnhancementSet: compareSetName };
  }, [build, compareSetName]);
  const compareBreakdowns = useBreakdownsForBuild(compareBuild);
  // Build's spell cooldown reduction (sum of all sources, percent).
  const cooldownReductionPct = breakdowns?.spellCooldownReduction.total ?? 0;
  // SLAs come and go with build state — feed them into the catalog so
  // the palette refreshes when a feat / enhancement that grants one is
  // toggled.
  const slas = useMemo(() => breakdowns?.slas ?? [], [breakdowns]);

  const abilities = useMemo(
    () => getMagicAbilities(build, spells, classes, slas, enhancementTrees, augments),
    [build, spells, classes, slas, enhancementTrees, augments],
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
  // Aggregate user-toggled debuffs, then layer the Reaper damage-dealt
  // multiplier on top. All damage in the magic rotation is spell-typed,
  // so we use `spellDamageMultiplier` (which differs from physical only
  // at R7+).
  const debuffs = useMemo(
    () => ({
      ...aggregateDebuffs(debuffState),
      damageDealtMultiplier: spellDamageMultiplier(difficulty),
    }),
    [debuffState, difficulty],
  );

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
      metamagicSP:     computeMetamagicSP(build.activeMetamagics),
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
      metamagicSP:     computeMetamagicSP(build.activeMetamagics),
    };
    return rotationDPS(steps, abilities, build, breakdowns, ctx, debuffs, cooldownReductionPct);
  }, [steps, abilities, build, breakdowns, debuffs, cooldownReductionPct]);

  // Parallel rotation breakdown for the comparison set. Same rotation,
  // same gear, same debuffs — only `activeEnhancementSet` differs.
  // Recomputed whenever the user picks a different compare set.
  const compareRotationBreakdown = useMemo(() => {
    if (!compareSetName || !compareBreakdowns) return null;
    if (compareSetName === build.activeEnhancementSet) return null;
    const ctx = {
      sneakAttackDice: compareBreakdowns.sneakAttackDice.total,
      metamagicSP:     computeMetamagicSP(build.activeMetamagics),
    };
    const compareCdr = compareBreakdowns.spellCooldownReduction.total;
    return rotationDPS(steps, abilities, compareBuild, compareBreakdowns, ctx, debuffs, compareCdr);
  }, [compareSetName, compareBuild, compareBreakdowns, steps, abilities, debuffs, build.activeEnhancementSet, build.activeMetamagics]);

  // Cycle length + per-cast damage events drive the chart, simulation
  // playhead, and live stat readouts.
  const { cycleSeconds: rotationCycleSeconds, damageEvents } = useMemo(() => {
    if (steps.length === 0 || !breakdowns) {
      return { cycleSeconds: 0, damageEvents: [] as DamageEvent[] };
    }
    const t = resolveTimeline(steps, abilityById, cooldownReductionPct);
    const ctx = {
      sneakAttackDice: breakdowns.sneakAttackDice.total,
      metamagicSP:     computeMetamagicSP(build.activeMetamagics),
    };
    const events: DamageEvent[] = t.steps.map(r => {
      const perCast = damagePerCast(r.ability, build, breakdowns, ctx, debuffs);
      // Aggregate by groupLabel when set so per-spell duplicates of the
      // same proc (e.g. Magical Ambush) collapse into one entry.
      const byComponent = new Map<string, number>();
      for (const c of perCast.byComponent) {
        if (c.damagePerTrigger <= 0) continue;
        const key = c.component.groupLabel ?? c.component.label;
        byComponent.set(key, (byComponent.get(key) ?? 0) + c.damagePerTrigger);
      }
      return {
        time:        r.startTime,
        damage:      perCast.total,
        spell:       r.ability.displayName,
        byComponent,
      };
    });
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
  function onRestartClick() {
    if (rotationCycleSeconds <= 0) return;
    setSimRunning(false);
    setSimTime(0);
    // Defer the restart to the next frame so the stop + reset settle
    // before the new run begins.
    requestAnimationFrame(() => setSimRunning(true));
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

  // First-time / unset Active = top-N highest-DPC damaging abilities,
  // SEEDED ONCE on build load and then persisted to `activeAbilityIds`.
  // After the seed lands the list is whatever the user has configured —
  // it doesn't re-rank when gear / metamagics / enhancements change,
  // since auto-resorting a list the user is actively editing causes
  // jarring glitches.
  const DEFAULT_ACTIVE_LIMIT = 10;
  useEffect(() => {
    if (activeAbilityIds !== undefined) return;             // already configured
    if (abilities.length === 0) return;                     // catalog still loading
    const ranked = abilities
      .filter(a => a.category === 'damage')
      .map(a => {
        const info = damageByAbility.get(a.id);
        const dps  = info?.dps           ?? 0;
        const dpc  = info?.damage.total  ?? 0;
        return { a, dps, dpc };
      })
      .sort((x, y) => y.dpc - x.dpc || y.dps - x.dps || x.a.name.localeCompare(y.a.name))
      .slice(0, DEFAULT_ACTIVE_LIMIT)
      .map(({ a }) => a.id);
    setActiveAbilityIds(ranked);
    // setActiveAbilityIds is a store action — its identity isn't stable
    // across renders, but listing it in deps is harmless because the
    // early returns above gate the body on the actual conditions of
    // interest. The body fires at most once per build (until the user
    // explicitly clears via Manage, which leaves `[]`, not `undefined`).
  }, [activeAbilityIds, abilities, damageByAbility, setActiveAbilityIds]);

  const activeAbilities = useMemo(() => {
    if (activeAbilityIds === undefined) return [];          // pre-seed render
    const byId = new Map<string, MagicAbility>();
    for (const a of abilities) byId.set(a.id, a);
    return activeAbilityIds.flatMap(id => {
      const a = byId.get(id);
      return a ? [a] : [];
    });
  }, [abilities, activeAbilityIds]);

  function onAdd(ability: MagicAbility) {
    if (auto) {
      // Auto-fill: a single click materializes a full one-minute plan
      // by repeatedly slotting the ability into cooldown gaps, falling
      // back to append, until one more cast would push the cycle past
      // a minute.
      setSteps(fillToOneMinute(steps, ability, abilityById, cooldownReductionPct));
      return;
    }
    // Manual: insert one cast at the earliest position that respects
    // the ability's own cooldown (using the same gap-fitting helper
    // as auto-fill, so the placement is consistent across modes).
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
  // "first-time" default to whatever's currently in the palette) then
  // splice/insert and persist.
  function onReorderActive(from: number, to: number) {
    if (from === to) return;
    const current = activeAbilityIds ?? activeAbilities.map(a => a.id);
    if (from < 0 || from >= current.length || to < 0 || to >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setActiveAbilityIds(next);
  }

  // Snapshot the working "active" list the dialog should boot with —
  // either the user's saved priority list or the auto-derived top-10
  // (matching what the palette currently shows).
  const dialogInitial = activeAbilityIds ?? activeAbilities.map(a => a.id);

  return (
    <div className={styles.editor}>
      <BuffsList build={build} />
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

      {/* Comparison row — pick another EnhancementSet to evaluate
          alongside the active one (same rotation, same gear). */}
      {(build.enhancementSets?.length ?? 0) > 1 && (
        <div className={styles.compareRow}>
          <label className={styles.compareLabel}>
            Compare vs.
            <select
              className={styles.compareSelect}
              value={compareSetName ?? ''}
              onChange={e => setCompareSetName(e.target.value || null)}
            >
              <option value="">(none)</option>
              {(build.enhancementSets ?? [])
                .filter(s => s.name !== build.activeEnhancementSet)
                .map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          {compareSetName && compareRotationBreakdown && rotationBreakdown && (() => {
            const activeDps  = rotationBreakdown.totalDPS;
            const compareDps = compareRotationBreakdown.totalDPS;
            const delta      = activeDps > 0 ? (compareDps - activeDps) / activeDps * 100 : 0;
            const sign       = delta >= 0 ? '+' : '';
            const better     = delta > 0;
            return (
              <div className={styles.compareStats}>
                <span className={styles.compareCol}>
                  <span className={styles.compareColLabel}>{build.activeEnhancementSet}</span>
                  <span className={styles.compareColValue}>
                    {Math.round(activeDps).toLocaleString()} DPS
                  </span>
                </span>
                <span className={styles.compareCol}>
                  <span className={styles.compareColLabel}>{compareSetName}</span>
                  <span className={styles.compareColValue}>
                    {Math.round(compareDps).toLocaleString()} DPS
                  </span>
                </span>
                <span className={better ? styles.compareDeltaUp : styles.compareDeltaDown}>
                  {sign}{delta.toFixed(1)}%
                </span>
              </div>
            );
          })()}
        </div>
      )}

      <RotationChart
        events={damageEvents}
        cycleSeconds={rotationCycleSeconds}
        currentTime={simTime}
      />

      <DamageSourceSummary
        breakdown={rotationBreakdown}
        events={damageEvents}
        currentTime={simRunning || simTime > 0 ? simTime : undefined}
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
        <button
          type="button"
          className={styles.simulateBtn}
          onClick={onRestartClick}
          disabled={rotationCycleSeconds <= 0}
          title="Restart simulation from t=0"
        >
          ↻ Restart
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
