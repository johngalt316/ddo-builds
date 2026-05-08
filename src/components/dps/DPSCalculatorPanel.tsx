// DPS Calculator panel.
//
// DPSCalculatorPanel owns the shared cross-editor state (debuffs, compare
// set) and passes it down to whichever editor is active. Each editor owns
// only the state unique to its rotation type.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  weaponInfoFromGearItem,
  buildStatsFromEngine,
  meleeDPS,
  meleeAbilityDamagePerActivation,
  critRangeBonusForWeapon,
  isShieldType,
  shieldBashDPS,
  type MeleeWeaponInfo,
  type ShieldBashResult,
  type TWFStyle,
} from '@/engine/dps/meleeCalc';
import { MeleeTimeline } from './MeleeTimeline';
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
import { aggregateSpellCostReductions, reaperEfficiencyEffect } from '@/engine/dps/spellCost';
import {
  aggregateDebuffs,
  liveDebuffsAt,
  initialDebuffState,
  type DebuffState,
} from '@/engine/dps/debuffs';
import { spellDamageMultiplier, physicalDamageMultiplier } from '@/engine/dps/difficulty';
import { RotationPalette } from './RotationPalette';
import { RotationTimeline } from './RotationTimeline';
import { ManageActiveDialog } from './ManageActiveDialog';
import { DebuffsSummary, ManageDebuffsDialog } from './DebuffsPanel';
import { ActiveProcsList } from './ActiveProcsList';
import { BuffsList } from './BuffsList';
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

/** Available enemy targets in the simulation (1–5). Single-target spells
 *  always hit one; AOE spells hit min(spell.targetCap, targetCount).
 *  Per-spell `targetCap` data isn't yet wired through the catalog —
 *  until it lands all spells effectively act single-target regardless
 *  of this dropdown. */
const TARGET_LABELS: Record<number, string> = {
  1: 'Single Target',
  2: 'Group of 2',
  3: 'Group of 3',
  4: 'Group of 4',
  5: 'Group of 5',
};

export function DPSCalculatorPanel() {
  const [rotationType, setRotationType] = useState<RotationType>('magic');
  const [difficulty, setDifficulty]     = useState<DifficultyIndex>(0);
  const [targetCount, setTargetCount]   = useState<number>(1);
  const [objective, setObjective]       = useState<OptimizerObjective>('sustained');
  const [objectiveOpen, setObjectiveOpen] = useState(false);

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

  const build = useBuildStore(s => s.build);
  const [compareSetName, setCompareSetName] = useState<string | null>(null);
  const compareBuild = useMemo<typeof build>(() => {
    if (!compareSetName || compareSetName === build.activeEnhancementSet) return build;
    return { ...build, activeEnhancementSet: compareSetName };
  }, [build, compareSetName]);
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
            <option value="melee">Melee (coming soon)</option>
            <option value="ranged">Ranged (coming soon)</option>
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
          setDebuffState={setDebuffState}
          onManageDebuffs={() => setDebuffsOpen(true)}
          compareSetName={compareSetName}
          setCompareSetName={setCompareSetName}
          compareBuild={compareBuild}
          compareBreakdowns={compareBreakdowns}
        />
      ) : rotationType === 'melee' ? (
        <MeleeEditor
          difficulty={difficulty}
          targetCount={targetCount}
          setTargetCount={setTargetCount}
          debuffState={debuffState}
          setDebuffState={setDebuffState}
          onManageDebuffs={() => setDebuffsOpen(true)}
          compareSetName={compareSetName}
          setCompareSetName={setCompareSetName}
          compareBuild={compareBuild}
          compareBreakdowns={compareBreakdowns}
        />
      ) : (
        <div className={styles.timelinePlaceholder}>
          Ranged rotations land in a future phase.
        </div>
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

// ── Shared editor props ──────────────────────────────────────────────
// State that is independent of rotation type (debuffs, compare-set) lives
// in DPSCalculatorPanel and is passed to whichever editor is active.

import type { Build } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';

interface SharedEditorProps {
  difficulty: DifficultyIndex;
  targetCount: number;
  setTargetCount: (next: number) => void;
  debuffState: DebuffState;
  setDebuffState: (next: DebuffState) => void;
  onManageDebuffs: () => void;
  compareSetName: string | null;
  setCompareSetName: (name: string | null) => void;
  compareBuild: Build;
  compareBreakdowns: EngineResult | null;
}

// ── Magic rotation editor ────────────────────────────────────────────

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

function MagicRotationEditor({
  steps, setSteps,
  activeAbilityIds, setActiveAbilityIds,
  manageOpen, setManageOpen,
  auto, setAuto,
  difficulty,
  targetCount, setTargetCount,
  debuffState, setDebuffState: _setDebuffState, onManageDebuffs,
  compareSetName, setCompareSetName, compareBuild, compareBreakdowns,
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

  const abilities = useMemo(
    () => getMagicAbilities(
      build, spells, classes, slas, enhancementTrees, augments,
      breakdowns ?? undefined, metamagics, spCostReductions,
    ),
    [build, spells, classes, slas, enhancementTrees, augments, breakdowns, metamagics, spCostReductions],
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
  // SEEDED ONCE on build load and then persisted to `activeAbilityIds`.
  // After the seed lands the list is whatever the user has configured —
  // it doesn't re-rank when gear / metamagics / enhancements change,
  // since auto-resorting a list the user is actively editing causes
  // jarring glitches. The user can re-trigger the seed via the "Top 10"
  // button in the Manage dialog.
  const DEFAULT_ACTIVE_LIMIT = 10;
  const computeTopByDPC = (): string[] =>
    abilities
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

  useEffect(() => {
    if (activeAbilityIds !== undefined) return;             // already configured
    if (abilities.length === 0) return;                     // catalog still loading
    setActiveAbilityIds(computeTopByDPC());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAbilityIds, abilities, damageByAbility]);

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

// ── Melee rotation editor ────────────────────────────────────────────

interface MeleeEditorProps extends SharedEditorProps {}

function MeleeEditor({
  difficulty, targetCount, setTargetCount,
  debuffState, setDebuffState: _setDebuffState, onManageDebuffs,
  compareSetName, setCompareSetName, compareBuild, compareBreakdowns,
}: MeleeEditorProps) {
  const build   = useBuildStore(s => s.build);
  const engine  = useBreakdowns();

  // Debuffs — state lives in parent; apply physical-damage multiplier here.
  const debuffs = useMemo(
    () => ({
      ...aggregateDebuffs(debuffState, undefined, build),
      damageDealtMultiplier: physicalDamageMultiplier(difficulty),
    }),
    [debuffState, difficulty, build],
  );
  void debuffs; // used by future on-hit proc evaluation

  // ── Simulation ─────────────────────────────────────────────────────
  // Fixed 60-second window, same rAF pattern as MagicRotationEditor.
  const MELEE_SIM_SECONDS = 60;
  const [simTime, setSimTime]       = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const simStartedAt = useRef(0);

  useEffect(() => {
    if (!simRunning) return;
    let cancelled = false;
    simStartedAt.current = performance.now() - simTime * 1000;
    let raf = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = (now - simStartedAt.current) / 1000;
      if (elapsed >= MELEE_SIM_SECONDS) { setSimTime(MELEE_SIM_SECONDS); setSimRunning(false); return; }
      setSimTime(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simRunning]);

  function onSimulateClick() {
    if (simRunning) { setSimRunning(false); return; }
    if (simTime >= MELEE_SIM_SECONDS - 1e-3) setSimTime(0);
    setSimRunning(true);
  }
  function onRestartClick() {
    setSimRunning(false);
    setSimTime(0);
    requestAnimationFrame(() => setSimRunning(true));
  }

  // ── Attack-speed alacrity slider ───────────────────────────────────
  const buildAlacrity = engine?.meleeSpeed.total ?? 0;
  const [alacrity, setAlacrity] = useState<number | null>(null);
  const effectiveAlacrity = alacrity ?? Math.min(buildAlacrity, 15);

  // ── TWF style override ─────────────────────────────────────────────
  const detectedTWF = useMemo((): TWFStyle => {
    if (!engine) return 'none';
    const ids = new Set([
      ...build.feats.map(f => f.featId),
      ...(build.specialFeats ?? []).map(f => f.featId),
    ]);
    if (ids.has('Greater Two Weapon Fighting'))   return 'gtwf';
    if (ids.has('Improved Two Weapon Fighting'))  return 'itwf';
    if (ids.has('Two Weapon Fighting'))           return 'twf';
    return 'none';
  }, [build.feats, build.specialFeats, engine]);
  const [twfOverride, setTwfOverride] = useState<TWFStyle | null>(null);

  // ── Rotation palette (shared ability catalog, melee-filtered) ──────
  const spells         = useGameDataStore(s => s.spells);
  const classes        = useGameDataStore(s => s.classes);
  const enhancementTrees = useGameDataStore(s => s.enhancementTrees);
  const augments       = useGameDataStore(s => s.augments);
  const metamagics     = useGameDataStore(s => s.metamagics);
  const breakdowns     = engine;   // alias — engine is already the EngineResult
  const slas = useMemo(() => breakdowns?.slas ?? [], [breakdowns]);
  const spCostReductions = useMemo(
    () => breakdowns
      ? aggregateSpellCostReductions(breakdowns, metamagics)
      : { perMetamagic: {}, percentReduction: 0 },
    [breakdowns, metamagics],
  );
  const allAbilities = useMemo(
    () => getMagicAbilities(
      build, spells, classes, slas, enhancementTrees, augments,
      breakdowns ?? undefined, metamagics, spCostReductions,
    ),
    [build, spells, classes, slas, enhancementTrees, augments, breakdowns, metamagics, spCostReductions],
  );
  // Palette only shows melee-mode abilities (empty until ki strikes land).
  const meleeAbilities = useMemo(
    () => allAbilities.filter(a => a.attackMode === 'melee'),
    [allAbilities],
  );

  const [manageOpen, setManageOpen] = useState(false);
  const dpsRotation      = useBuildStore(s => s.build.dpsRotation);
  const activeAbilityIds = dpsRotation?.activeAbilityIds;
  const setDpsRotation   = useBuildStore(s => s.setDpsRotation);
  const setActiveAbilityIds = (next: string[]) => setDpsRotation({ activeAbilityIds: next });
  const meleeSteps    = (dpsRotation?.meleeSteps ?? EMPTY_STEPS) as RotationStep[];
  const setMeleeSteps = (next: RotationStep[]) => setDpsRotation({ meleeSteps: next });

  const activeMeleeAbilities = useMemo(() => {
    if (!activeAbilityIds) return [];
    const byId = new Map(meleeAbilities.map(a => [a.id, a]));
    return activeAbilityIds.flatMap(id => { const a = byId.get(id); return a ? [a] : []; });
  }, [meleeAbilities, activeAbilityIds]);

  const dialogInitial = activeAbilityIds ?? activeMeleeAbilities.map(a => a.id);

  // ── Weapon + DPS result ────────────────────────────────────────────
  const mainHandItem = useMemo(() => {
    const gs = build.gearSets.find(g => g.name === build.activeGearSet);
    return gs?.items.find(i => i.slot === 'MainHand') ?? null;
  }, [build.gearSets, build.activeGearSet]);

  const offHandItem = useMemo(() => {
    const gs = build.gearSets.find(g => g.name === build.activeGearSet);
    return gs?.items.find(i => i.slot === 'OffHand') ?? null;
  }, [build.gearSets, build.activeGearSet]);

  const weaponInfo = useMemo(
    () => mainHandItem ? weaponInfoFromGearItem(mainHandItem) : null,
    [mainHandItem],
  );

  // For handwraps the off-hand uses the same weapon; for TWF with separate
  // weapons the off-hand item is distinct.  Non-weapon OH items (shields,
  // rune arms, orbs) won't parse to a MeleeWeaponInfo (no baseDice).
  const ohWeaponInfo = useMemo((): MeleeWeaponInfo | null => {
    if (!offHandItem) return null;                       // no OH item
    const parsed = weaponInfoFromGearItem(offHandItem);
    return parsed;                                       // null if not a weapon
  }, [offHandItem]);

  const buildStats = useMemo(() => {
    if (!engine || !weaponInfo) return null;
    const base = buildStatsFromEngine(build, engine, weaponInfo, effectiveAlacrity);
    if (twfOverride !== null) {
      const ohBonus = twfOverride === 'gtwf' ? 80
                    : twfOverride === 'itwf' ? 60
                    : twfOverride === 'twf'  ? 40
                    : 0;
      return { ...base, twfStyle: twfOverride, offHandChance: Math.min(100, ohBonus) };
    }
    return base;
  }, [engine, build, weaponInfo, effectiveAlacrity, twfOverride]);

  const result = useMemo(
    () => weaponInfo && buildStats ? meleeDPS(weaponInfo, buildStats) : null,
    [weaponInfo, buildStats],
  );

  // Shield bash contribution (only when OffHand is a shield type).
  const shieldBash = useMemo((): ShieldBashResult | null => {
    if (!ohWeaponInfo || !buildStats || !result || !engine) return null;
    if (!isShieldType(ohWeaponInfo.weaponType)) return null;
    const bashPct      = engine.shieldBashRate.total;
    // Crit range bonuses targeting 'All' apply to shields.
    const allCritBonus = engine.allBonuses
      .filter(b => b.effectType === 'Weapon_CriticalRange' && b.target === 'All')
      .reduce((s, b) => s + b.value, 0);
    return shieldBashDPS(ohWeaponInfo, bashPct, buildStats, result, allCritBonus);
  }, [ohWeaponInfo, buildStats, result, engine]);

  // Per-ability damage info for the palette tooltip. Only weapon-attack
  // abilities have real numbers; others still show placeholder.
  const damageByAbility = useMemo((): Map<string, AbilityDamageInfo> => {
    const m = new Map<string, AbilityDamageInfo>();
    if (!result || !buildStats) return m;
    for (const a of meleeAbilities) {
      if (!a.weaponAttack) continue;
      const { mhHits, scalar, critRangeBonus = 0, critMultBonus = 0, dsBuffPct = 0, dsBuffDuration = 0 } = a.weaponAttack;
      const dmg = meleeAbilityDamagePerActivation(mhHits, scalar, result, buildStats, critRangeBonus, critMultBonus, dsBuffPct, dsBuffDuration);
      const cycleTime = Math.max(a.cooldown, a.castTime, 1e-3);
      m.set(a.id, {
        damage: { total: dmg, casterLevel: 0, byComponent: [] },
        cycleTime,
        dps: dmg / cycleTime,
      });
    }
    return m;
  }, [meleeAbilities, result, buildStats]);

  // Compare result for the same weapon against a different enhancement set.
  const compareResult = useMemo(() => {
    if (!compareSetName || !compareBreakdowns || compareSetName === build.activeEnhancementSet) return null;
    if (!weaponInfo) return null;
    const cs = buildStatsFromEngine(compareBuild, compareBreakdowns, weaponInfo, effectiveAlacrity);
    return meleeDPS(weaponInfo, cs);
  }, [compareSetName, compareBreakdowns, compareBuild, weaponInfo, effectiveAlacrity, build.activeEnhancementSet]);

  if (!engine) return null;

  const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });
  const pct = (n: number)        => `${fmt(n, 1)}%`;

  return (
    <div className={styles.editor}>
      {/* Weapon stat panels — raw damage without MP/DS scaling */}
      {result && weaponInfo && buildStats && engine && (() => {
        // Determine which weapon info to show per hand.
        // Handwraps have no separate OH item — both hands use the same weapon.
        // TWF with separate weapons: OH item is distinct; falls back to MH
        // if the OH isn't a melee weapon (shield, rune arm, orb, etc.).
        const ohInfo: MeleeWeaponInfo | null = ohWeaponInfo ?? weaponInfo;
        const ohIsSameAsMH = !ohWeaponInfo || ohWeaponInfo.weaponType === weaponInfo.weaponType;
        const ohItem = ohWeaponInfo ? offHandItem : mainHandItem;

        const renderPanel = (
          label: string,
          wi: MeleeWeaponInfo,
          item: typeof mainHandItem,
          sameAsMH: boolean,
          bash?: ShieldBashResult,
        ) => {
          const isShield = isShieldType(wi.weaponType);

          // Recompute crit stats for this specific weapon type.
          // Shields use their own intrinsic crit range (no TWF-style crit bonuses).
          const critRangeBonus = isShield
            ? 0   // shield-specific bonuses TBD; only use shield's own range
            : critRangeBonusForWeapon(engine, wi.weaponType);
          const hasIC          = buildStats.hasImprovedCritical;
          const rangeAfterIC   = hasIC ? wi.critThreatBase * 2 : wi.critThreatBase;
          const totalFaces     = isShield
            ? bash?.shieldCritFaces ?? rangeAfterIC   // already includes 'All' bonuses
            : rangeAfterIC + critRangeBonus;
          const multOnAll      = wi.critMultiplier + buildStats.critMultBonus;
          const multOn1920     = multOnAll + buildStats.critMult1920Bonus;
          const loBound        = 21 - totalFaces;
          const facesOther     = Math.max(0, totalFaces - 2);
          const critStr        = buildStats.critMult1920Bonus > 0
            ? facesOther > 0
              ? `(${loBound}–18)×${multOnAll}  (19–20)×${multOn1920}`
              : `(19–20)×${multOn1920}`
            : `(${loBound}–20)×${multOnAll}`;

          const enchantBuff = item?.buffs.find(b => b.type === 'WeaponEnchantment');
          const enchant     = enchantBuff?.value1 ?? 0;
          const flatBonus   = wi.diceBonus + result.damageStatMod + enchant + result.flatDmgBonus;
          const baseStr     = `${fmt(wi.wScalar, 2)}W`
            + `(${wi.diceNum}d${wi.diceSides}${wi.diceBonus ? `+${wi.diceBonus}` : ''})`
            + ` + ${flatBonus}`;

          return (
            <div className={styles.weaponStatPanel}>
              <span className={styles.weaponStatPanelHeader}>
                <img
                  src={`/assets/images/ItemImages/${item?.icon}.png`}
                  alt=""
                  style={{ width: 16, height: 16, objectFit: 'contain', marginRight: 4, verticalAlign: 'middle', flexShrink: 0 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                {label}
              </span>
              <span className={styles.weaponStatPanelName}>
                {item?.name ?? '—'}
                {sameAsMH && !isShield && (
                  <span className={styles.weaponStatRowMuted}> (same as MH)</span>
                )}
              </span>

              <div className={styles.weaponStatRow}>
                <span className={styles.weaponStatRowLabel}>Base</span>
                <span className={styles.weaponStatRowValue}>{baseStr}</span>
                <span className={styles.weaponStatRowMuted}>
                  {`${result.damageStat}(+${result.damageStatMod}) +${enchant} enchant +${result.flatDmgBonus} flat`}
                </span>
              </div>

              <div className={styles.weaponStatRow}>
                <span className={styles.weaponStatRowLabel}>Crit Range</span>
                <span className={styles.weaponStatRowValue}>{critStr}</span>
                {result.seeker > 0 && (
                  <span className={styles.weaponStatRowMuted}>Seeker +{result.seeker}</span>
                )}
              </div>

              {isShield && bash ? (
                <div className={styles.weaponStatRow}>
                  <span className={styles.weaponStatRowLabel}>Bash Rate</span>
                  <span className={styles.weaponStatRowValue}>
                    {fmt(bash.bashesPerMin, 1)}/min
                    {bash.rawBashesPerMin > 60 && (
                      <span className={styles.weaponStatRowMuted}> (capped from {fmt(bash.rawBashesPerMin, 0)})</span>
                    )}
                  </span>
                  <span className={styles.weaponStatRowMuted}>
                    {fmt(engine.shieldBashRate.total)}% bash chance · {fmt(Math.round(bash.bashDPS))} DPS
                  </span>
                </div>
              ) : (
                <div className={styles.weaponStatRow}>
                  <span className={styles.weaponStatRowLabel}>To-Hit</span>
                  <span className={styles.weaponStatRowMuted}>TODO</span>
                </div>
              )}
            </div>
          );
        };

        const isHandwraps = weaponInfo.category === 'handwraps';
        const showOH = isHandwraps || ohWeaponInfo !== null;

        return (
          <div
            className={styles.weaponStatPanels}
            style={showOH ? undefined : { gridTemplateColumns: '1fr' }}
          >
            {renderPanel('Main Hand', weaponInfo, mainHandItem, false)}
            {showOH && renderPanel('Off Hand', ohInfo, ohItem, ohIsSameAsMH, shieldBash ?? undefined)}
          </div>
        );
      })()}

      {/* Target + enemy info — identical to magic pane */}
      <TargetRow
        targetCount={targetCount}
        setTargetCount={setTargetCount}
        prr={0}
        mrr={0}
      />

      {/* Active buffs: metamagics + combat stances with DPS contributions */}
      <BuffsList build={build} metamagics={metamagics} engine={engine} attackMode="melee" />

      {/* Active procs (on-hit sources; empty until melee proc catalog lands) */}
      <ActiveProcsList
        build={build}
        engine={engine}
        sneakAttackDice={engine.sneakAttackDice.total}
        breakdown={null}
      />

      {/* Debuffs */}
      <DebuffsSummary state={debuffState} build={build} onManage={onManageDebuffs} />

      {/* Rotation palette — melee abilities (ki strikes, enhancements) */}
      <RotationPalette
        abilities={activeMeleeAbilities}
        totalTrained={meleeAbilities.length}
        onAdd={(a) => {
          const byId = new Map(activeMeleeAbilities.map(ab => [ab.id, ab]));
          const slot = findFirstAvailableSlot(meleeSteps, a, byId, 0);
          const next = [...meleeSteps];
          next.splice(slot, 0, newRotationStep(a.id));
          setMeleeSteps(next);
        }}
        onManage={() => setManageOpen(true)}
        onReorder={(from, to) => {
          const next = [...meleeSteps];
          const [moved] = next.splice(from, 1);
          if (moved !== undefined) { next.splice(to, 0, moved); setMeleeSteps(next); }
        }}
        damageByAbility={damageByAbility}
      />
      <RotationTimeline
        steps={meleeSteps}
        abilityById={new Map(allAbilities.map(a => [a.id, a]))}
        cooldownReductionPct={0}
        auto={false}
        onAutoChange={() => {}}
        onReorder={(from, to) => {
          const next = [...meleeSteps];
          const [moved] = next.splice(from, 1);
          if (moved !== undefined) { next.splice(to, 0, moved); setMeleeSteps(next); }
        }}
        onRemove={(key) => setMeleeSteps(meleeSteps.filter(s => s.key !== key))}
        onClear={() => setMeleeSteps([])}
        damageByAbility={damageByAbility}
      />
      <ManageActiveDialog
        open={manageOpen}
        abilities={allAbilities}
        active={dialogInitial}
        onClose={() => setManageOpen(false)}
        onApply={setActiveAbilityIds}
        defaultAttackMode="melee"
      />

      {/* Controls */}
      <div className={styles.meleeControls}>
        <div className={styles.controls} style={{ marginBottom: 0 }}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Alacrity <span className={styles.fieldValue}>{effectiveAlacrity}%</span>
            </span>
            <input
              type="range" className={styles.slider}
              min={0} max={15} step={1}
              value={effectiveAlacrity}
              onChange={e => setAlacrity(Number(e.target.value))}
            />
            <span className={styles.sliderTicks}><span>0%</span><span>15%</span></span>
          </label>
          <label className={styles.field} style={{ minWidth: '7rem' }}>
            <span className={styles.fieldLabel}>Weapon Style</span>
            <select
              className={styles.select}
              value={twfOverride ?? detectedTWF}
              onChange={e => {
                const v = e.target.value as TWFStyle;
                setTwfOverride(v === detectedTWF ? null : v);
              }}
            >
              <option value="none">None</option>
              <option value="twf">TWF</option>
              <option value="itwf">ITWF</option>
              <option value="gtwf">GTWF</option>
            </select>
          </label>
        </div>
        {buildStats && result && (
          <div className={styles.meleeStatRow}>
            <span className={styles.meleeStatChip}
              title={`Damage scales from ${result.damageStat} (mod +${result.damageStatMod})`}>
              {result.damageStat} +{result.damageStatMod}
            </span>
            <span className={styles.meleeStatChip}>MP {fmt(buildStats.meleePower)}</span>
            <span className={styles.meleeStatChip} title="Main-hand doublestrike">
              DS MH {pct(buildStats.doublestrike)}
            </span>
            <span
              className={styles.meleeStatChip}
              title={
                buildStats.isHandwraps     ? 'Handwraps: OH DS = MH DS (no penalty)'
                : buildStats.hasPerfectTWF ? 'Perfect TWF: OH DS = 65% of MH DS'
                : 'Standard TWF: OH DS = 50% of MH DS'
              }
            >
              DS OH {pct(result.doublestrikeOH)}
            </span>
            <span className={styles.meleeStatChip}
              title={`Crit: ${21 - result.critThreatFaces}-20 = ${pct(result.critChance * 100)}, ×${result.critMultOnAll}${result.critMult1920Bonus > 0 ? ` / ×${result.critMultOn1920} on 19-20` : ''}`}>
              Crit {pct(result.critChance * 100)}
            </span>
            {buildStats.seeker > 0 && (
              <span className={styles.meleeStatChip}>Seeker +{buildStats.seeker}</span>
            )}
          </div>
        )}
      </div>

      {/* Auto-attack timeline with simulation playhead */}
      <MeleeTimeline
        mhAPM={result?.mhAttacksPerMin ?? 0}
        ohAPM={result?.ohAttacksPerMin ?? 0}
        playheadTime={simRunning || simTime > 0 ? simTime : undefined}
      />

      {/* Simulate / Restart buttons — same pattern as magic editor */}
      <div className={styles.simulateRow}>
        <button
          type="button"
          className={styles.simulateBtn}
          onClick={onSimulateClick}
          disabled={!result}
          title={result ? (simRunning ? 'Pause simulation' : 'Run 60s simulation') : 'No weapon equipped'}
        >
          {simRunning ? '⏸ Pause' : '▶ Simulate'}
        </button>
        <button
          type="button"
          className={styles.simulateBtn}
          onClick={onRestartClick}
          disabled={!result}
          title="Restart simulation from t=0"
        >
          ↻ Restart
        </button>
        <span className={styles.simulateClock}>
          t = {simTime.toFixed(2)}s / {MELEE_SIM_SECONDS}s
        </span>
      </div>

      {/* Enhancement-set comparison (mirrors magic compare row) */}
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
          {compareSetName && compareResult && result && (() => {
            const activeDps  = result.totalAutoDPS;
            const compareDps = compareResult.totalAutoDPS;
            const delta      = activeDps > 0 ? (compareDps - activeDps) / activeDps * 100 : 0;
            const sign       = delta >= 0 ? '+' : '';
            const better     = delta > 0;
            return (
              <div className={styles.compareStats}>
                <span className={styles.compareCol}>
                  <span className={styles.compareColLabel}>{build.activeEnhancementSet}</span>
                  <span className={styles.compareColValue}>{Math.round(activeDps).toLocaleString()} DPS</span>
                </span>
                <span className={styles.compareCol}>
                  <span className={styles.compareColLabel}>{compareSetName}</span>
                  <span className={styles.compareColValue}>{Math.round(compareDps).toLocaleString()} DPS</span>
                </span>
                <span className={better ? styles.compareDeltaUp : styles.compareDeltaDown}>
                  {sign}{delta.toFixed(1)}%
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* DPS breakdown (mirrors DamageSourceSummary role) */}
      {result && (
        <div className={styles.meleeBreakdown}>
          <div className={styles.meleeBreakdownCol}>
            <span className={styles.meleeBreakdownLabel}>Main Hand</span>
            <span className={styles.meleeBreakdownValue}>{fmt(Math.round(result.mhDPS))} DPS</span>
            <span className={styles.meleeBreakdownSub}>{fmt(Math.round(result.effectiveMHPerMin))} eff. hits/min</span>
          </div>
          {result.ohAttacksPerMin > 0 && (
            <div className={styles.meleeBreakdownCol}>
              <span className={styles.meleeBreakdownLabel}>Off Hand</span>
              <span className={styles.meleeBreakdownValue}>{fmt(Math.round(result.ohDPS))} DPS</span>
              <span className={styles.meleeBreakdownSub}>
                {fmt(Math.round(result.effectiveOHPerMin))} eff. hits/min
                {' · '}DS {pct(result.doublestrikeOH)}
                {' ('}
                {result.ohDSFraction === 1.00 ? 'wraps' : result.ohDSFraction === 0.65 ? 'PTWF' : '50%'}
                {')'}
              </span>
            </div>
          )}
          {shieldBash && (
            <div className={styles.meleeBreakdownCol}>
              <span className={styles.meleeBreakdownLabel}>Shield Bash</span>
              <span className={styles.meleeBreakdownValue}>{fmt(Math.round(shieldBash.bashDPS))} DPS</span>
              <span className={styles.meleeBreakdownSub}>
                {fmt(shieldBash.bashesPerMin, 1)}/min · {fmt(shieldBash.avgDmgPerBash, 0)} avg/bash
                {shieldBash.rawBashesPerMin > 60 && ' (capped)'}
              </span>
            </div>
          )}
          <div className={styles.meleeBreakdownCol}>
            <span className={styles.meleeBreakdownLabel}>Scaled / Hit</span>
            <span className={styles.meleeBreakdownValue}>{fmt(result.avgScaledDamage, 1)}</span>
            <span className={styles.meleeBreakdownSub}>Base {fmt(result.avgBaseDamage, 1)}</span>
          </div>
          <div className={styles.meleeBreakdownCol}>
            <span className={styles.meleeBreakdownLabel}>Avg / Hit (crits)</span>
            <span className={styles.meleeBreakdownValue}>{fmt(result.avgPerHit, 1)}</span>
            <span className={styles.meleeBreakdownSub}>
              {pct(result.critChance * 100)} crit
              {' → '}×{result.critMultOnAll}
              {result.critMult1920Bonus > 0 ? ` / ×${result.critMultOn1920} on 19-20` : ''}
              {result.seeker > 0 ? ` · Seeker +${result.seeker}` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Damage source breakdown */}
      {result && (() => {
        const totalDPS = result.totalAutoDPS + (shieldBash?.bashDPS ?? 0)
          + [...damageByAbility.values()].reduce((s, v) => s + v.dps, 0);
        const sources: { label: string; dps: number; color: string }[] = [
          { label: 'MH Auto', dps: result.mhDPS, color: '#c9a227' },
          { label: 'OH Auto', dps: result.ohDPS, color: '#a07820' },
          ...(shieldBash ? [{ label: 'Shield Bash', dps: shieldBash.bashDPS, color: '#6a9fd8' }] : []),
          ...activeMeleeAbilities
            .map(a => ({ label: a.name, dps: damageByAbility.get(a.id)?.dps ?? 0, color: '#7ab87a' }))
            .filter(s => s.dps > 0),
        ].filter(s => s.dps > 0);

        if (totalDPS <= 0) return null;
        return (
          <div className={styles.meleeDamageSource}>
            <div className={styles.meleeDamageSourceBar}>
              {sources.map(s => (
                <div key={s.label} title={`${s.label}: ${fmt(Math.round(s.dps))} DPS`}
                  style={{ flex: s.dps / totalDPS, background: s.color, minWidth: 2 }} />
              ))}
            </div>
            <div className={styles.meleeDamageSourceList}>
              {sources.map(s => (
                <div key={s.label} className={styles.meleeDamageSourceRow}>
                  <span className={styles.meleeDamageSourceDot} style={{ background: s.color }} />
                  <span className={styles.meleeDamageSourceLabel}>{s.label}</span>
                  <span className={styles.meleeDamageSourceDPS}>{fmt(Math.round(s.dps))}</span>
                  <span className={styles.meleeDamageSourcePct}>{(s.dps / totalDPS * 100).toFixed(1)}%</span>
                </div>
              ))}
              <div className={styles.meleeDamageSourceRow + ' ' + styles.meleeDamageSourceTotal}>
                <span />
                <span className={styles.meleeDamageSourceLabel}>Total</span>
                <span className={styles.meleeDamageSourceDPS}>{fmt(Math.round(totalDPS))}</span>
                <span className={styles.meleeDamageSourcePct}>DPS</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className={styles.metric} title={title}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}

/** Target dropdown + live enemy resistance readout. PRR/MRR drift from
 *  baseline as ramping debuffs stack during simulation playback. AC and
 *  Fortification are placeholders for future modeling. */
function TargetRow({
  targetCount, setTargetCount, prr, mrr,
}: {
  targetCount: number;
  setTargetCount: (next: number) => void;
  prr: number;
  mrr: number;
}) {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  return (
    <div className={styles.targetRow}>
      <label className={styles.targetField}>
        <span className={styles.targetLabel}>Target</span>
        <select
          className={styles.targetSelect}
          value={targetCount}
          onChange={e => setTargetCount(Number(e.target.value))}
          title="Number of available targets in the simulation. AOE spells hit up to their target cap; single-target spells still only hit one."
        >
          {[1, 2, 3, 4, 5].map(n => (
            <option key={n} value={n}>{TARGET_LABELS[n]}</option>
          ))}
        </select>
      </label>
      <div className={styles.enemyInfo}>
        <span className={styles.enemyLabel}>Enemy</span>
        <Metric
          label="PRR"
          value={fmt(prr)}
          title="Live physical resistance rating. Drifts negative as ramping PRR-shred debuffs stack during simulation playback. Baseline 0 — enemy-side PRR isn't yet modeled."
        />
        <Metric
          label="MRR"
          value={fmt(mrr)}
          title="Live magical resistance rating. Drifts negative as ramping MRR-shred debuffs stack during simulation playback. Baseline 0 — enemy-side MRR isn't yet modeled."
        />
        <Metric
          label="AC"
          value="TODO"
          title="Enemy AC isn't modeled yet — will land alongside melee/ranged rotations."
        />
        <Metric
          label="Fort"
          value="TODO"
          title="Enemy fortification isn't modeled yet — will land alongside crit-handling for melee/ranged."
        />
      </div>
    </div>
  );
}
