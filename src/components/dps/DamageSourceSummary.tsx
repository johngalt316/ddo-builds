// Per-source damage contribution summary.
//
// Sits under the RotationChart and breaks down each component's
// share of the total per-minute damage. Each row carries a tooltip
// with the exact dmg/min and dmg/trigger numbers so the user can
// cross-check against the reference spreadsheet without expanding
// the full RotationDPSSummary table.

import { useMemo } from 'react';
import type { DamageBreakdown } from '@/engine/dps/calculator';
import styles from './DamageSourceSummary.module.css';

interface Props {
  breakdown: DamageBreakdown | null;
}

const fmt0 = (n: number) => Math.round(n).toLocaleString();
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const fmtPct = (frac: number) =>
  frac >= 0.001 ? `${(frac * 100).toFixed(1)}%` : '<0.1%';

export function DamageSourceSummary({ breakdown }: Props) {
  const rows = useMemo(() => {
    if (!breakdown || breakdown.totalPerMinute <= 0) return [];
    return breakdown.byComponent
      .filter(c => c.damagePerMinute > 0)
      .map(c => ({
        label:        c.component.label,
        damageType:   c.component.damageType,
        perMinute:    c.damagePerMinute,
        perTrigger:   c.damagePerTrigger,
        triggers:     c.triggersPerMinute,
        debuffMult:   c.debuffMultiplier,
        spellPower:   c.scaleInputs.spellPower,
        critChance:   c.scaleInputs.critChance,
        fraction:     c.damagePerMinute / breakdown.totalPerMinute,
      }))
      .sort((a, b) => b.perMinute - a.perMinute);
  }, [breakdown]);

  if (rows.length === 0) {
    return (
      <section className={styles.summary}>
        <div className={styles.header}>
          <span className={styles.label}>Damage Sources</span>
          <span className={styles.empty}>
            Add spells to the rotation to see per-source contributions.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.summary}>
      <div className={styles.header}>
        <span className={styles.label}>Damage Sources</span>
        <span className={styles.total}>
          {fmt0(breakdown!.totalPerMinute)} dmg/min total
        </span>
      </div>
      <ul className={styles.rows}>
        {rows.map(r => (
          <li
            key={r.label}
            className={styles.row}
            title={[
              r.label,
              `${fmt0(r.perMinute)} dmg/min (${fmtPct(r.fraction)} of total)`,
              `${fmt0(r.perTrigger)} per trigger × ${fmt1(r.triggers)} triggers/min`,
              r.debuffMult !== 1 ? `× ${r.debuffMult.toFixed(2)} debuff multiplier` : '',
              `Element: ${r.damageType}`,
              `Spell power: ${fmt0(r.spellPower)} · crit: ${(r.critChance * 100).toFixed(1)}%`,
            ].filter(Boolean).join('\n')}
          >
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
