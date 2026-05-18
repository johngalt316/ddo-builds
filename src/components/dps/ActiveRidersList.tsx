// Active Damage Riders panel — surfaces every per-hit damage rider on
// the active build. Two flavors:
//
//   • Imbue toggles (Group=Imbue stances) parsed from EngineResult.imbueRiders.
//   • Item-buff / augment damage-on-hit effects from the proc catalog
//     tagged `category: 'rider'` (Dripping with Magma + Mythic DoT
//     family, Alchemical Attunements, Woeful X augments, etc.).
//
// Stacking: by name. Different-named riders all stack (each contributes
// its full damage per hit). Same-named entries are deduped, keeping the
// one with the highest per-hit damage — matches DDO's "stronger version
// of the same buff replaces" rule.
//
// Mirrors ActiveProcsList's chip + popover visual idiom so the two
// panels sit naturally next to each other in the DPS editor.

import { useMemo } from 'react';
import type { Build } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import type { ImbueRider } from '@/engine/dps/imbues';
import { imbueAvgPerHit } from '@/engine/dps/imbues';
import { PROC_CATALOG, computeMetamagicSP, type Proc } from '@/engine/dps/procs';
import { resolveScaleInputs } from '@/engine/dps/calculator';
import { scaleMult } from '@/engine/dps/damage';
import { useTooltip } from '@/hooks/useTooltip';
import { fmt } from '@/utils/formatNumbers';
import styles from './ActiveProcsList.module.css';

interface Props {
  build: Build;
  engine: EngineResult | null;
  totalCharLevel: number;
  sneakAttackDice: number;
}

interface RiderRow {
  label: string;
  damageType: string;
  avgPerHit: number;
  /** Multi-line tooltip text already prepared. */
  tooltip: string;
  placeholder?: boolean;
}

/** Build a tooltip + per-hit average for an imbue rider. */
function imbueRow(
  rider: ImbueRider,
  engine: EngineResult,
  totalCharLevel: number,
): RiderRow {
  const raw = imbueAvgPerHit(rider, engine, totalCharLevel);
  const avgPerInstance = rider.diceNum * (rider.diceSides + 1) / 2 + rider.diceBonus;
  const dice = `${rider.diceNum}d${rider.diceSides}${rider.diceBonus ? `+${rider.diceBonus}` : ''}`;
  const mult = rider.diceMultiplier === 'imbueDie'
    ? ' × (1 base + bonus) imbue dice'
    : rider.diceMultiplier === 'charLevel' ? ' × character level' : ' (flat per hit)';
  const lines = [
    rider.source,
    '',
    `Source: Imbue Toggle`,
    `Dice: ${dice} ${rider.damageType}${mult}`,
    `  avg per instance = ${avgPerInstance.toFixed(1)}`,
    `Scaling: ${rider.scalingPct}% ${labelForImbueStat(rider.scalingStat)}`,
    '',
    `Pre-crit per hit (after scaling): ${fmt(raw, 1)}`,
    '',
    `Imbue damage rides every weapon hit (does NOT pick up the`,
    `per-ability scalar) and crits with the weapon.`,
  ];
  return {
    label: rider.source,
    damageType: rider.damageType,
    avgPerHit: raw,
    tooltip: lines.join('\n'),
  };
}

/** Build a tooltip + per-hit average for a rider-category proc. The
 *  chip's "per hit" number matches the rotation breakdown's damage
 *  per trigger — raw dice avg × scaleMult(spell power, crit chance,
 *  crit mult bonus) for the proc's scale profile. Previously the chip
 *  showed only the raw avg (525 for Dripping with Magma) while the
 *  rotation tooltip showed the scaled value (6,828) — those should
 *  match. */
function procRow(proc: Proc, build: Build, engine: EngineResult, sneakAttackDice: number): RiderRow | null {
  const ctx = { sneakAttackDice, metamagicSP: computeMetamagicSP(build.activeMetamagics) };
  const components = proc.toComponents(build, engine, ctx, [{ name: '*', casterLevel: engine.casterLevel.total }]);
  if (components.length === 0) return null;
  const c = components[0]!;
  const placeholder = c.placeholderDamage === true;
  const rawAvg = placeholder ? 0 : c.qtyPerTrigger * c.avgDicePerHit;
  // Per-trigger scaled damage — applies the proc's scaleProfile (proc
  // / spell / sneak) to look up SP/crit, then computes the same
  // multiplier the rotation breakdown uses. For placeholders the
  // damage is 0 and scaling isn't meaningful.
  let scaledAvg = rawAvg;
  let sp = 0, critChance = 0, critMultBonus = 0;
  if (!placeholder) {
    const scale = resolveScaleInputs(c, engine, ctx);
    scaledAvg = rawAvg * scaleMult(scale);
    sp = scale.spellPower;
    critChance = scale.critChance;
    critMultBonus = scale.critMultBonus;
  }
  const lines: string[] = [
    proc.label,
    '',
    `Source: Item buff / augment`,
    `Damage type: ${c.damageType}`,
  ];
  if (placeholder) {
    lines.push(
      `Status: TODO — per-hit dice / proc rate not yet modeled`,
      '',
      'Source is recognized but contributes 0 until dice are confirmed.',
    );
  } else {
    lines.push(
      `Raw avg per trigger: ${fmt(rawAvg, 0)}  (${c.qtyPerTrigger} × ${fmt(c.avgDicePerHit, 0)} dice avg)`,
      `Scale: SP ${fmt(sp, 0)}, crit ${fmt(critChance * 100, 1)}%, crit-mult bonus +${fmt(critMultBonus, 1)}`,
      `  × scaleMult = (1 + SP/100) × (1 + crit × (cm + 2)) = ${fmt(scaleMult({ spellPower: sp, critChance, critMultBonus }), 2)}`,
      `Damage per trigger (pre-debuff): ${fmt(scaledAvg, 0)}`,
      '',
      `Fires per cast / per weapon hit per the source description. The`,
      `number here matches the rotation breakdown's "damage per trigger".`,
    );
  }
  return {
    label: proc.label,
    damageType: c.damageType,
    avgPerHit: scaledAvg,
    tooltip: lines.join('\n'),
    placeholder,
  };
}

function labelForImbueStat(stat: ImbueRider['scalingStat']): string {
  switch (stat) {
    case 'mp':           return 'Melee Power';
    case 'rp':           return 'Ranged Power';
    case 'higher_mr_p':  return 'max(Melee, Ranged) Power';
    case 'universal_sp': return 'Universal Spell Power';
    case 'sp':           return 'Spell Power (element-specific)';
  }
}

/** Dedupe by name keeping the strongest (highest avgPerHit). Different
 *  names all stack — DDO buffs stack across distinct named effects but
 *  same-named entries collapse to the strongest version. */
function applyStackingRules(rows: RiderRow[]): RiderRow[] {
  const byName = new Map<string, RiderRow>();
  for (const r of rows) {
    const cur = byName.get(r.label);
    if (!cur || r.avgPerHit > cur.avgPerHit) byName.set(r.label, r);
  }
  return [...byName.values()];
}

function RiderChip({ row }: { row: RiderRow }) {
  const { open, wrapperProps, triggerProps } = useTooltip<HTMLDivElement>();
  return (
    <div className={styles.chipWrapper} {...wrapperProps}>
      <button
        type="button"
        className={row.placeholder ? styles.chipPlaceholder : styles.chip}
        {...triggerProps}
      >
        <span className={styles.chipLabel}>{row.label}</span>
        <span className={styles.chipEffect}>
          {row.damageType} · {row.placeholder ? 'TODO' : `~${fmt(row.avgPerHit, 1)}/hit`}
        </span>
        {row.placeholder && <span className={styles.placeholderTag}>TODO</span>}
      </button>
      {open && (
        <div className={styles.popover} role="dialog">
          <pre className={styles.popoverContent}>{row.tooltip}</pre>
        </div>
      )}
    </div>
  );
}

export function ActiveRidersList({ build, engine, totalCharLevel, sneakAttackDice }: Props) {
  const rows = useMemo(() => {
    if (!engine) return [] as RiderRow[];
    const raw: RiderRow[] = [];
    for (const r of engine.imbueRiders) {
      raw.push(imbueRow(r, engine, totalCharLevel));
    }
    for (const p of PROC_CATALOG) {
      if (p.category !== 'rider') continue;
      if (!p.isActive(build, engine)) continue;
      const row = procRow(p, build, engine, sneakAttackDice);
      if (row) raw.push(row);
    }
    return applyStackingRules(raw);
  }, [build, engine, totalCharLevel, sneakAttackDice]);

  return (
    <div className={styles.summary}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>Active Damage Riders</span>
        <span className={styles.summaryLabel}>
          {rows.length > 0 ? `${rows.length}` : '—'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.summaryEmpty}>
          No active riders — toggle an Imbue stance or equip an item with an
          on-hit damage proc (Dripping with Magma etc.) to add per-hit damage.
        </div>
      ) : (
        <div className={styles.chips}>
          {rows.map(r => <RiderChip key={r.label} row={r} />)}
        </div>
      )}
    </div>
  );
}
