// Per-source damage contribution summary.
//
// Sits under the RotationChart and breaks down each component's
// share of the total per-minute damage. Each row carries a tooltip
// with the exact dmg/min and dmg/trigger numbers so the user can
// cross-check against the reference spreadsheet without expanding
// the full RotationDPSSummary table.

import { useMemo } from 'react';
import type { DamageBreakdown } from '@/engine/dps/calculator';
import type { SpellDamageType } from '@/engine/breakdowns';
import type { DamageEvent } from './RotationChart';
import styles from './DamageSourceSummary.module.css';

interface Props {
  breakdown: DamageBreakdown | null;
  /** Per-cast events with component-level damage. When `currentTime`
   *  is set, the summary aggregates damage from every event with
   *  `time <= currentTime` and shows live cumulative contributions. */
  events?: DamageEvent[];
  /** Simulation playhead in seconds. `undefined` (or 0 with no
   *  simulation running) → fall back to steady-state per-minute. */
  currentTime?: number;
}

/** Map our SpellDamageType to the icon basename in
 *  /assets/images/DamageTypeIcons/. Sourced from ddowiki's Floating
 *  Damage Text page; some categories don't have a wiki icon and
 *  fall back to "Untyped". */
const DAMAGE_TYPE_ICON: Record<SpellDamageType, string> = {
  'Acid':            'Acid.jpg',
  'Chaos':           'Chaotic.jpg',
  'Cold':            'Cold.jpg',
  'Electric':        'Electric.jpg',
  'Evil':            'Evil.jpg',
  'Fire':            'Fire_damage.jpg',
  'Force':           'Force_damage.jpg',
  'Light/Alignment': 'Light_damage.jpg',
  'Negative':        'Negative.png',
  'Poison':          'Poison.jpg',
  'Positive':        'Good_damage.jpg',
  'Repair':          'Repair.jpg',
  'Sonic':           'Sonic_damage.jpg',
};

const fmt0 = (n: number) => Math.round(n).toLocaleString();
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const fmtPct = (frac: number) =>
  frac >= 0.001 ? `${(frac * 100).toFixed(1)}%` : '<0.1%';

export function DamageSourceSummary({ breakdown, events, currentTime }: Props) {
  // Live mode: aggregate cumulative damage per component for every
  // event whose time <= currentTime. The same component metadata
  // (element, scaleInputs, debuff mult) carries over from the
  // steady-state breakdown for the tooltip; only the magnitudes and
  // fractions reflect "what's fired so far in the simulation".
  const live = useMemo(() => {
    if (currentTime === undefined || currentTime <= 0) return null;
    if (!events || events.length === 0) return null;
    const totals = new Map<string, number>();
    for (const ev of events) {
      if (ev.time > currentTime + 1e-6) break;
      for (const [label, dmg] of ev.byComponent) {
        totals.set(label, (totals.get(label) ?? 0) + dmg);
      }
    }
    return totals;
  }, [events, currentTime]);

  const rows = useMemo(() => {
    if (!breakdown || breakdown.totalPerMinute <= 0) return [];

    // Aggregate steady-state contributions by groupLabel ?? label.
    // Per-spell instances of the same proc (e.g. Magical Ambush)
    // collapse into one row whose magnitudes sum across spells.
    interface Agg {
      groupLabel: string;
      damageType: SpellDamageType;
      perMinute:  number;
      perTrigger: number;
      triggers:   number;
      debuffMult: number;
      spellPower: number;
      critChance: number;
    }
    const aggMap = new Map<string, Agg>();
    for (const c of breakdown.byComponent) {
      if (c.damagePerMinute <= 0) continue;
      const key = c.component.groupLabel ?? c.component.label;
      const cur = aggMap.get(key);
      if (cur) {
        cur.perMinute  += c.damagePerMinute;
        cur.perTrigger += c.damagePerTrigger;
        cur.triggers   += c.triggersPerMinute;
        // Element / SP / crit / debuff aren't necessarily uniform
        // across the per-spell instances (e.g. Magical Ambush is
        // always Force, but other procs could vary). Keep the first
        // entry's metadata as a representative.
      } else {
        aggMap.set(key, {
          groupLabel: key,
          damageType: c.component.damageType,
          perMinute:  c.damagePerMinute,
          perTrigger: c.damagePerTrigger,
          triggers:   c.triggersPerMinute,
          debuffMult: c.debuffMultiplier,
          spellPower: c.scaleInputs.spellPower,
          critChance: c.scaleInputs.critChance,
        });
      }
    }

    if (live) {
      // Live cumulative rows. Magnitudes come from the live event sum
      // (already keyed on groupLabel by the panel); metadata pulled
      // from the steady-state aggregation above.
      const total = [...live.values()].reduce((s, v) => s + v, 0);
      if (total <= 0) return [];   // sim hasn't fired anything yet
      return [...live.entries()]
        .filter(([, dmg]) => dmg > 0)
        .map(([label, dmg]) => {
          const meta = aggMap.get(label);
          return {
            label,
            damageType:  meta?.damageType ?? 'Force' as SpellDamageType,
            perMinute:   dmg,                                        // reused as cumulative-so-far
            perTrigger:  meta?.perTrigger ?? 0,
            triggers:    meta?.triggers   ?? 0,
            debuffMult:  meta?.debuffMult ?? 1,
            spellPower:  meta?.spellPower ?? 0,
            critChance:  meta?.critChance ?? 0,
            fraction:    dmg / total,
            isLive:      true as const,
          };
        })
        .sort((a, b) => b.perMinute - a.perMinute);
    }

    // Steady-state per-minute rows (already aggregated above).
    return [...aggMap.values()]
      .map(a => ({
        label:       a.groupLabel,
        damageType:  a.damageType,
        perMinute:   a.perMinute,
        perTrigger:  a.perTrigger,
        triggers:    a.triggers,
        debuffMult:  a.debuffMult,
        spellPower:  a.spellPower,
        critChance:  a.critChance,
        fraction:    a.perMinute / breakdown.totalPerMinute,
        isLive:      false as const,
      }))
      .sort((a, b) => b.perMinute - a.perMinute);
  }, [breakdown, live]);

  if (rows.length === 0) {
    return (
      <section className={styles.summary}>
        <div className={styles.header}>
          <span className={styles.label}>Damage Sources</span>
          <span className={styles.empty}>
            {currentTime !== undefined && currentTime > 0
              ? `No casts have fired yet at t=${currentTime.toFixed(1)}s.`
              : 'Add spells to the rotation to see per-source contributions.'}
          </span>
        </div>
      </section>
    );
  }

  const isLive  = rows[0]!.isLive;
  const total   = rows.reduce((s, r) => s + r.perMinute, 0);
  const totalLabel = isLive
    ? `${fmt0(total)} dmg cumulative @ t=${(currentTime ?? 0).toFixed(1)}s`
    : `${fmt0(total)} dmg/min total`;

  return (
    <section className={styles.summary}>
      <div className={styles.header}>
        <span className={styles.label}>
          Damage Sources{isLive ? ' (live)' : ''}
        </span>
        <span className={styles.total}>{totalLabel}</span>
      </div>
      <ul className={styles.rows}>
        {rows.map(r => (
          <li
            key={r.label}
            className={styles.row}
            title={[
              r.label,
              isLive
                ? `${fmt0(r.perMinute)} dmg so far (${fmtPct(r.fraction)} of cumulative)`
                : `${fmt0(r.perMinute)} dmg/min (${fmtPct(r.fraction)} of total)`,
              `${fmt0(r.perTrigger)} per trigger${isLive ? '' : ` × ${fmt1(r.triggers)} triggers/min`}`,
              r.debuffMult !== 1 ? `× ${r.debuffMult.toFixed(2)} debuff multiplier` : '',
              `Element: ${r.damageType}`,
              `Spell power: ${fmt0(r.spellPower)} · crit: ${(r.critChance * 100).toFixed(1)}%`,
            ].filter(Boolean).join('\n')}
          >
            {DAMAGE_TYPE_ICON[r.damageType] && (
              <img
                src={`/assets/images/DamageTypeIcons/${DAMAGE_TYPE_ICON[r.damageType]}`}
                alt={r.damageType}
                className={styles.rowIcon}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span className={styles.rowName}>{r.label}</span>
            <span className={styles.rowBar} aria-hidden="true">
              <span
                className={styles.rowBarFill}
                style={{ width: `${Math.min(100, r.fraction * 100)}%` }}
              />
            </span>
            <span className={styles.rowPct}>{fmtPct(r.fraction)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
