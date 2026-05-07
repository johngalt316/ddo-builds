// Phase 6.4.9 — Active procs panel.
//
// Shows every PROC_CATALOG entry whose isActive predicate matches the
// current build/engine state. Read-only; procs aren't user-toggleable
// (they fire whenever the source gear / enhancement / class feature is
// present).
//
// Layout mirrors DebuffsSummary so they sit naturally next to each other
// in the DPS panel.

import { useMemo } from 'react';
import { PROC_CATALOG, type Proc, computeMetamagicSP } from '@/engine/dps/procs';
import type { Build } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import type { DamageComponent } from '@/engine/dps/damage';
import { scaleMult } from '@/engine/dps/damage';
import { resolveScaleInputs, type DamageBreakdown } from '@/engine/dps/calculator';
import { useTooltip } from '@/hooks/useTooltip';
import styles from './ActiveProcsList.module.css';

interface Props {
  build: Build;
  engine: EngineResult | null;
  /** Sneak attack dice — drives Magical Ambush dice count. */
  sneakAttackDice: number;
  /** Optional whole-rotation breakdown. When present, per-spell procs
   *  (Magical Ambush, Shiradi mantles) report their actual rotation-
   *  aware avg per-trigger damage instead of the 1-missile probe value
   *  — keeping ActiveProcs consistent with the DamageSources tooltip. */
  breakdown?: DamageBreakdown | null;
}

/** Rotation-aware avg dmg-per-trigger for one proc, derived from the
 *  rotation breakdown. Returns null when the proc isn't in the rotation
 *  (e.g. user hasn't added a triggering spell yet) so the caller can
 *  fall back to the probe-based value.
 *
 *  Per-spell procs (Magical Ambush, Shiradi) emit a separate component
 *  per spell, each with its own qtyPerTrigger × avgDicePerHit × scaleMult.
 *  We weight by triggers/min so the displayed value reflects actual
 *  per-fire damage averaged over the rotation — same convention used
 *  by DamageSourceSummary. */
function rotationAvgPerTrigger(
  procLabel: string,
  breakdown: DamageBreakdown | null | undefined,
): number | null {
  if (!breakdown) return null;
  let weightedDmg = 0;
  let totalTriggers = 0;
  for (const c of breakdown.byComponent) {
    const key = c.component.groupLabel ?? c.component.label;
    if (key !== procLabel) continue;
    if (c.triggersPerMinute <= 0) continue;
    weightedDmg   += c.damagePerTrigger * c.triggersPerMinute;
    totalTriggers += c.triggersPerMinute;
  }
  return totalTriggers > 0 ? weightedDmg / totalTriggers : null;
}

const fmt0 = (n: number) => Math.round(n).toLocaleString();
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const fmt2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString();

/**
 * Build a multi-line tooltip for one proc that shows:
 *   - effect summary (avg dice / damage type / trigger pattern)
 *   - inputs (SP, crit chance, crit-mult bonus per scale profile)
 *   - the scaleMult formula expanded
 *   - resulting damage per trigger
 *   - debuff flags
 *
 * Dynamic procs (Magical Ambush, Shiradi Mantle) emit through a probe
 * context so they produce a sample component even outside a rotation;
 * the tooltip uses the build's actual SP / crit values from the engine.
 */
function procSummary(
  proc: Proc,
  build: Build,
  engine: EngineResult,
  sneakAttackDice: number,
  rotationDpt: number | null,
): { effect: string; chip: string; tooltip: string; placeholder: boolean } | null {
  const ctx = { sneakAttackDice, metamagicSP: computeMetamagicSP(build.activeMetamagics) };
  // Probe with one dummy spell so per-spell procs (Magical Ambush) emit.
  // Static / global procs ignore the spell list.
  const probeSpells = [{ name: '*', casterLevel: engine.casterLevel.total }];
  const components = proc.toComponents(build, engine, ctx, probeSpells);
  if (components.length === 0) return null;
  const c: DamageComponent = components[0]!;

  // Placeholder procs: source is recognized but dice / rate aren't
  // confirmed yet. Show a stripped chip with a TODO message instead
  // of computing the (zero) scale chain.
  if (c.placeholderDamage) {
    return {
      effect:      'TODO — damage not yet modeled',
      chip:        'TODO — damage not yet modeled',
      tooltip: [
        proc.label,
        '',
        `Damage type: ${c.damageType}`,
        'Status: TODO — proc recognized but dice / rate not yet confirmed',
        'Currently contributes 0 to total damage.',
      ].join('\n'),
      placeholder: true,
    };
  }

  // Resolve the actual SP / crit / critMult inputs the calculator
  // would feed into scaleMult for this component.
  const inputs   = resolveScaleInputs(c, engine, ctx);
  const sm       = scaleMult(inputs);
  // For chance-baked procs, "damage per trigger" should reflect the
  // damage on a SUCCESSFUL fire (full hit × scaleMult), not the
  // chance-adjusted long-run average. Use fullHitAvg when present.
  const triggerAvg = c.fullHitAvg ?? c.avgDicePerHit;
  // Probe-based dpt assumes a 1-missile cast (`qtyPerTrigger` = 1 for
  // the dummy probe spell). Real per-spell procs scale with each
  // spell's missile count, so the rotation produces a different
  // effective dpt per cast. When the rotation breakdown is available
  // we override with the rotation-aware avg so this tooltip and
  // DamageSourceSummary report the same number for the same proc.
  const probeDpt = c.qtyPerTrigger * triggerAvg * sm;
  const dpt      = rotationDpt ?? probeDpt;

  const t = c.trigger;
  const triggerLabel =
    t.kind === 'per-cast'
      ? (t.spell ? `per cast of ${t.spell}` : 'per cast')
      : t.kind === 'per-hit'
        ? `per hit (${c.qtyPerTrigger}× per cast)`
        : `${(t.chance * 100).toFixed(0)}% on cast (ICD ${t.cooldownSec}s)`;

  const flags: string[] = [];
  if (c.useGenericVuln) flags.push('GV');
  if (c.useSonicVuln)   flags.push('SonicV');
  if (c.useMRR)         flags.push('MRR');
  const debuffs = flags.length > 0 ? flags.join(' · ') : 'none';

  // Chip face: prefer the full hit damage when the proc has chance
  // baked into avgDicePerHit (Shiradi-style). Otherwise show the
  // raw per-cast avg as before. The 'random' scale profile rolls a
  // different element each fire, so the displayed type is "Random"
  // rather than the (placeholder) damageType field.
  const displayAvg  = c.fullHitAvg ?? c.avgDicePerHit;
  const displayType = c.scaleProfile === 'random' ? 'Random' : c.damageType;
  const chanceTag   = c.perMissileChance !== undefined
    ? ` · ${(c.perMissileChance * 100).toFixed(0)}%/missile`
    : '';
  const effect = `${fmt1(displayAvg)} avg ${displayType}${chanceTag}`;
  const chip   = `${effect} · ${triggerLabel}`;

  // Show the full per-trigger math. critMultBonus stored as a fraction
  // (0.49 for a +1.49 modifier above 1.0, etc.) — display the bonus the
  // way the spreadsheet does and the actual ×crit multiplier in parens.
  const critMultDisplay = `+${fmt2(inputs.critMultBonus)} (×${fmt2(inputs.critMultBonus + 1)})`;
  const profile = c.scaleProfile;

  const lines: string[] = [
    proc.label,
    '',
    `Damage type: ${displayType}`,
    `Trigger: ${triggerLabel}`,
    `Debuffs: ${debuffs}`,
  ];

  if (c.fullHitAvg !== undefined && c.perMissileChance !== undefined && c.trigger.kind === 'per-cast') {
    // Per-missile-chance proc (Shiradi mantle): each missile rolls
    // independently at perMissileChance, capped at one fire per cast.
    // pFire is stored on `trigger.chance`; reverse-derive the probe
    // spell's missile count from pFire = 1 - (1-p)^N for the
    // explanatory line.
    const pFire = c.trigger.chance ?? 0;
    const p     = c.perMissileChance;
    const probeMissiles = (pFire >= 1 || p >= 1 || p <= 0)
      ? 1
      : Math.max(1, Math.round(Math.log(1 - pFire) / Math.log(1 - p)));
    lines.push(
      '',
      `Full hit (on fire): ${fmt2(c.fullHitAvg)} avg ${displayType}`,
      `Per-missile chance: ${(p * 100).toFixed(0)}%`,
      `Cap: 1 fire per cast`,
      '',
      `Per-cast pFire (this probe spell, ${probeMissiles} missile${probeMissiles === 1 ? '' : 's'})`,
      `  = 1 - (1 - ${(p * 100).toFixed(0)}%)^${probeMissiles}`,
      `  = ${(pFire * 100).toFixed(1)}%`,
      `Triggers/min (rotation) = casts/min × pFire(spell-specific)`,
    );
  }

  lines.push(
    '',
    'Inputs:',
    `  qty per trigger: ${c.qtyPerTrigger}${rotationDpt !== null ? ' (probe; varies by spell in rotation)' : ''}`,
    `  avg dice per hit (on fire): ${fmt2(triggerAvg)}`,
    `  scale profile: ${profile}`,
    `  spell power: ${fmt0(inputs.spellPower)}`,
    `  crit chance: ${(inputs.critChance * 100).toFixed(1)}%`,
    `  crit mult bonus: ${critMultDisplay}`,
    '',
    'scaleMult = (1 + SP/100) × (1 + crit × (critMult + 2))',
    `         = (1 + ${fmt0(inputs.spellPower)}/100) × (1 + ${(inputs.critChance * 100).toFixed(1)}% × (${fmt2(inputs.critMultBonus)} + 2))`,
    `         = ${fmt2(1 + inputs.spellPower / 100)} × ${fmt2(1 + inputs.critChance * (inputs.critMultBonus + 2))}`,
    `         = ${fmt2(sm)}`,
    '',
  );

  if (rotationDpt !== null) {
    lines.push(
      `dmg per trigger (rotation avg) = ${fmt0(dpt)}`,
      `  (probe-only value would be ${c.qtyPerTrigger} × ${fmt2(triggerAvg)} × ${fmt2(sm)} = ${fmt0(probeDpt)})`,
    );
  } else {
    lines.push(
      `dmg per trigger (on fire) = ${c.qtyPerTrigger} × ${fmt2(triggerAvg)} × ${fmt2(sm)}`,
      `              = ${fmt0(dpt)}`,
    );
  }

  // For per-missile-chance procs (Shiradi), surface the long-run
  // expected per-cast contribution: on-fire damage × probe pFire.
  // Useful to compare against the always-fires "dmg per trigger" line.
  if (c.fullHitAvg !== undefined && c.trigger.kind === 'per-cast' && c.trigger.chance !== undefined) {
    const expectedPerCast = c.qtyPerTrigger * c.fullHitAvg * c.trigger.chance * sm;
    lines.push(
      `Expected per cast (× probe pFire) = ${fmt0(expectedPerCast)}`,
    );
  }

  return { effect, chip, tooltip: lines.join('\n'), placeholder: false };
}

export function ActiveProcsList({ build, engine, sneakAttackDice, breakdown }: Props) {
  const active = useMemo(() => {
    if (!engine) return [];
    return PROC_CATALOG
      .filter(p => p.isActive(build, engine))
      .map(p => ({
        proc: p,
        summary: procSummary(p, build, engine, sneakAttackDice,
                             rotationAvgPerTrigger(p.label, breakdown)),
      }))
      .filter(x => x.summary !== null);
  }, [build, engine, sneakAttackDice, breakdown]);

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>
          Active Procs · {active.length}
        </span>
      </div>
      {active.length === 0 ? (
        <div className={styles.summaryEmpty}>
          No active procs — equip gear or take enhancements that grant on-cast effects.
        </div>
      ) : (
        <div className={styles.chips}>
          {active.map(({ proc, summary }) => (
            <ProcChip
              key={proc.id}
              proc={proc}
              summary={summary!}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One proc chip with a click-to-toggle popover replacing the
 * desktop-only `title` tooltip. Click anywhere outside the chip — or
 * press Escape — to dismiss. Works on touch the same way as desktop:
 * tap once to reveal, tap outside to close.
 */
interface ProcChipProps {
  proc: Proc;
  summary: { effect: string; chip: string; tooltip: string; placeholder: boolean };
}

function ProcChip({ proc, summary }: ProcChipProps) {
  const { open, wrapperProps, triggerProps } = useTooltip();
  return (
    <div className={styles.chipWrapper} {...wrapperProps}>
      <button
        type="button"
        className={summary.placeholder ? styles.chipPlaceholder : styles.chip}
        {...triggerProps}
      >
        <span className={styles.chipLabel}>
          {proc.label}
          {summary.placeholder && (
            <span className={styles.placeholderTag}>⚠ TODO</span>
          )}
        </span>
        {!summary.placeholder && (
          <span className={styles.chipEffect}>{summary.effect}</span>
        )}
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={`${proc.label} details`}>
          <pre className={styles.popoverContent}>{summary.tooltip}</pre>
        </div>
      )}
    </div>
  );
}
