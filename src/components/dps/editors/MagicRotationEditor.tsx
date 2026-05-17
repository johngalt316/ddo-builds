// Magic rotation editor — palette, timeline, simulation, and damage
// breakdown for spell-based rotations. Lifted out of DPSCalculatorPanel
// so the panel coordinator stays a thin shell.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { getMagicAbilities, type MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';
import {
  fillToOneMinute, findFirstAvailableSlot, resolveTimeline,
} from '@/engine/dps/timing';
import { newRotationStep } from '@/engine/dps/rotation';
import {
  damagePerCast, rotationDPS, type AbilityDamageInfo,
} from '@/engine/dps/calculator';
import { computeMetamagicSP } from '@/engine/dps/procs';
import {
  aggregateSpellCostReductions, reaperEfficiencyEffect,
} from '@/engine/dps/spellCost';
import { aggregateDebuffs, liveDebuffsAt } from '@/engine/dps/debuffs';
import { spellDamageMultiplier } from '@/engine/dps/difficulty';
import { RotationPalette } from '../RotationPalette';
import { RotationTimeline } from '../RotationTimeline';
import { ManageActiveDialog } from '../ManageActiveDialog';
import { DebuffsSummary } from '../DebuffsPanel';
import { ActiveProcsList } from '../ActiveProcsList';
import { BuffsList } from '../BuffsList';
import { RotationChart, type DamageEvent } from '../RotationChart';
import { DamageSourceSummary } from '../DamageSourceSummary';
import { Metric, TargetRow, SimDurationPicker } from './widgets';
import type { SharedEditorProps } from './shared';
import styles from '../DPSCalculatorPanel.module.css';

interface MagicRotationEditorProps extends SharedEditorProps {
  steps: RotationStep[];
  setSteps: (next: RotationStep[]) => void;
  activeAbilityIds: string[] | undefined;
  setActiveAbilityIds: (next: string[]) => void;
  manageOpen: boolean;
  setManageOpen: (next: boolean) => void;
  auto: boolean;
  setAuto: (next: boolean) => void;
}

export function MagicRotationEditor({
  steps, setSteps,
  activeAbilityIds, setActiveAbilityIds,
  manageOpen, setManageOpen,
  auto, setAuto,
  difficulty,
  targetCount, setTargetCount,
  debuffState, onManageDebuffs,
  compareSetName, setCompareSetName, compareBuild, compareBreakdowns,
  simDuration, setSimDuration,
}: MagicRotationEditorProps) {
  const build       = useBuildStore(s => s.build);
  const spells      = useGameDataStore(s => s.spells);
  const classes     = useGameDataStore(s => s.classes);
  const enhancementTrees = useGameDataStore(s => s.enhancementTrees);
  const augments         = useGameDataStore(s => s.augments);
  const metamagics       = useGameDataStore(s => s.metamagics);
  const breakdowns  = useBreakdowns();
  // Build's spell cooldown reduction (sum of all sources, percent).
  const cooldownReductionPct = breakdowns?.spellCooldownReduction.total ?? 0;
  // SLAs come and go with build state — feed them into the catalog so
  // the palette refreshes when a feat / enhancement that grants one is
  // toggled.
  const slas = useMemo(() => breakdowns?.slas ?? [], [breakdowns]);

  // Per-build SP-cost reductions (MetamagicCost* + SpellPointCostPercent
  // collected effects). Computed once per engine refresh and passed into
  // `getMagicAbilities` so each MagicAbility carries a stamped
  // `costBreakdown` showing the actual cost the user pays per cast.
  const spCostReductions = useMemo(
    () => breakdowns
      ? aggregateSpellCostReductions(breakdowns, metamagics)
      : { perMetamagic: {}, percentReduction: 0 },
    [breakdowns, metamagics],
  );

  // Filter to magic-side abilities only — weapon-attack SLAs (Manyshot,
  // Cleave, Quick Cutter, etc.) and ranged-tagged abilities have their
  // own editors. Boost-class buffs apply to any rotation, so keep them.
  // Mirrors MeleeEditor's `a.attackMode === 'melee' || 'boost'` pattern.
  const allAbilities = useMemo(
    () => getMagicAbilities(
      build, spells, classes, slas, enhancementTrees, augments,
      breakdowns ?? undefined, metamagics, spCostReductions,
    ),
    [build, spells, classes, slas, enhancementTrees, augments, breakdowns, metamagics, spCostReductions],
  );
  const abilities = useMemo(
    () => allAbilities.filter(a => a.attackMode === 'magic' || a.attackMode === 'boost'),
    [allAbilities],
  );
  const abilityById = useMemo(() => {
    const m = new Map<string, MagicAbility>();
    for (const a of abilities) m.set(a.id, a);
    return m;
  }, [abilities]);

  // Debuffs — state lives in parent; compute the spell-typed multiplier here.
  const debuffs = useMemo(
    () => ({
      ...aggregateDebuffs(debuffState, undefined, build),
      damageDealtMultiplier: spellDamageMultiplier(difficulty),
    }),
    [debuffState, difficulty, build],
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
      targetCount,
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
  }, [abilities, build, breakdowns, debuffs, cooldownReductionPct, targetCount]);

  // Whole-rotation breakdown — total per-min damage + per-component
  // contributions. Drives the live stats row + DamageSourceSummary
  // below the timeline. Recomputes whenever the rotation, build,
  // debuffs, or CDR changes.
  const rotationBreakdown = useMemo(() => {
    if (!breakdowns) return null;
    const ctx = {
      sneakAttackDice: breakdowns.sneakAttackDice.total,
      metamagicSP:     computeMetamagicSP(build.activeMetamagics),
      targetCount,
    };
    return rotationDPS(steps, abilities, build, breakdowns, ctx, debuffs, cooldownReductionPct);
  }, [steps, abilities, build, breakdowns, debuffs, cooldownReductionPct, targetCount]);

  // Parallel rotation breakdown for the comparison set. Same rotation,
  // same gear, same debuffs — only `activeEnhancementSet` differs.
  // Recomputed whenever the user picks a different compare set.
  const compareRotationBreakdown = useMemo(() => {
    if (!compareSetName || !compareBreakdowns) return null;
    if (compareSetName === build.activeEnhancementSet) return null;
    const ctx = {
      sneakAttackDice: compareBreakdowns.sneakAttackDice.total,
      metamagicSP:     computeMetamagicSP(build.activeMetamagics),
      targetCount,
    };
    const compareCdr = compareBreakdowns.spellCooldownReduction.total;
    return rotationDPS(steps, abilities, compareBuild, compareBreakdowns, ctx, debuffs, compareCdr);
  }, [compareSetName, compareBuild, compareBreakdowns, steps, abilities, debuffs, build.activeEnhancementSet, build.activeMetamagics, targetCount]);

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
      targetCount,
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
  }, [steps, abilityById, cooldownReductionPct, build, breakdowns, debuffs, targetCount]);

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
    setSimRunning(false);
    setSimTime(0);
  }

  // Cumulative damage at the current sim time — drives the live stats.
  const cumulativeDamage = useMemo(() => {
    let s = 0;
    for (const e of damageEvents) {
      if (e.time <= simTime + 1e-6) s += e.damage; else break;
    }
    return s;
  }, [damageEvents, simTime]);

  // Reaper's Efficiency uptime — active when the clickie is in the
  // rotation. Folds in as a final percent off the SP/min total.
  const reaperEfficiency = useMemo(
    () => reaperEfficiencyEffect(build, steps, rotationCycleSeconds),
    [build, steps, rotationCycleSeconds],
  );

  // SP per minute = sum of (final per-cast cost × cpm) over abilities
  // in the rotation. Each ability's `costBreakdown.total` already has
  // base + active metamagic surcharges − reductions − percent off
  // baked in (stamped by getMagicAbilities). Reaper's Efficiency adds
  // a rotation-aware percent off the rolled-up total — kept separate
  // from per-ability costBreakdown since it depends on the cycle
  // length + which step is the buff trigger.
  const spPerMinute = useMemo(() => {
    if (rotationCycleSeconds <= 0) return 0;
    const counts = new Map<string, number>();
    for (const s of steps) counts.set(s.abilityId, (counts.get(s.abilityId) ?? 0) + 1);
    const cyclesPerMin = 60 / rotationCycleSeconds;
    let sp = 0;
    for (const [id, count] of counts) {
      const a = abilityById.get(id);
      if (!a) continue;
      const cost = a.costBreakdown?.total ?? a.cost;
      sp += cost * count * cyclesPerMin;
    }
    if (reaperEfficiency.effectiveReductionPct > 0) {
      sp *= 1 - reaperEfficiency.effectiveReductionPct / 100;
    }
    return sp;
  }, [steps, abilityById, rotationCycleSeconds, reaperEfficiency]);

  // First-time / unset Active = top-N highest-DPC damaging abilities,
  // SEEDED ONCE per attack-mode tab and then persisted via the shared
  // `seededAttackModes` flag. After the seed lands the list is whatever
  // the user has configured — it doesn't re-rank when gear / metamagics
  // / enhancements change, since auto-resorting a list the user is
  // actively editing causes jarring glitches. The user can re-trigger
  // the seed via the "Top 10" button in the Manage dialog.
  const DEFAULT_ACTIVE_LIMIT = 10;
  const computeTopByDPC = (): string[] =>
    abilities
      .filter(a => a.category === 'damage' && a.attackMode === 'magic')
      .map(a => {
        const info = damageByAbility.get(a.id);
        const dps  = info?.dps           ?? 0;
        const dpc  = info?.damage.total  ?? 0;
        return { a, dps, dpc };
      })
      .sort((x, y) => y.dpc - x.dpc || y.dps - x.dps || x.a.name.localeCompare(y.a.name))
      .slice(0, DEFAULT_ACTIVE_LIMIT)
      .map(({ a }) => a.id);

  const isMagicSeeded = useBuildStore(s =>
    (s.build.dpsRotation?.seededAttackModes ?? []).includes('magic'));
  const setDpsRotationStore = useBuildStore(s => s.setDpsRotation);
  useEffect(() => {
    if (isMagicSeeded) return;
    if (abilities.length === 0) return;                     // catalog still loading
    const top = computeTopByDPC();
    if (top.length === 0) return;
    const existing = activeAbilityIds ?? [];
    const seen = new Set(existing);
    const merged = [...existing, ...top.filter(id => !seen.has(id))];
    const prevModes = useBuildStore.getState().build.dpsRotation?.seededAttackModes ?? [];
    setDpsRotationStore({
      activeAbilityIds: merged,
      seededAttackModes: [...prevModes, 'magic'],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMagicSeeded, abilities, damageByAbility]);

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
      setSteps(fillToOneMinute(steps, ability, abilityById, cooldownReductionPct, simDuration));
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

  // Live PRR / MRR at the simulation playhead so the enemy info pane
  // can drift as ramping debuffs stack up. When the simulation isn't
  // running and time is 0, ramping debuffs read at fraction 0 (full
  // baseline). Re-derives whenever the user toggles a debuff or the
  // playhead moves.
  const liveDebuffs = useMemo(
    () => liveDebuffsAt(debuffState, simTime, undefined, build),
    [debuffState, simTime, build],
  );

  return (
    <div className={styles.editor}>
      <TargetRow
        targetCount={targetCount}
        setTargetCount={setTargetCount}
        prr={liveDebuffs.effectivePRR ?? 0}
        mrr={liveDebuffs.effectiveMRR}
      />
      <BuffsList build={build} metamagics={metamagics} />
      <ActiveProcsList
        build={build}
        engine={breakdowns}
        sneakAttackDice={breakdowns?.sneakAttackDice.total ?? 0}
        breakdown={rotationBreakdown}
      />
      <DebuffsSummary state={debuffState} build={build} onManage={onManageDebuffs} />
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
      {/* Live stats — DPS / DPM are static for the rotation; Damage
          accumulates with the simulation cursor. */}
      <div className={styles.stats}>
        <Metric label="DPS"
          value={rotationBreakdown ? Math.round(rotationBreakdown.totalDPS).toLocaleString() : '—'} />
        <Metric label="DPM"
          value={rotationBreakdown ? Math.round(rotationBreakdown.totalPerMinute).toLocaleString() : '—'} />
        <Metric label="SPM"
          value={spPerMinute > 0 ? Math.round(spPerMinute).toLocaleString() : '—'}
          title={reaperEfficiency.effectiveReductionPct > 0
            ? `Reaper's Efficiency rank ${reaperEfficiency.rank}: −${reaperEfficiency.basePercent}% for ${Math.round(reaperEfficiency.uptimeFraction * 100)}% uptime → −${reaperEfficiency.effectiveReductionPct.toFixed(1)}% on the rolled-up SP/min.`
            : undefined} />
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
        <SimDurationPicker value={simDuration} onChange={setSimDuration} />
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
        onResetToTop={computeTopByDPC}
        defaultAttackMode="magic"
      />
    </div>
  );
}
