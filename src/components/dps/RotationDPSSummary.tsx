// Phase 6.4 — Rotation DPS summary.
//
// Displays the totalDPS the calculator produced for the current rotation
// plus an expandable breakdown table showing each component's
// contribution. Mirrors the reference spreadsheet's Components view.

import { useMemo, useState } from 'react';
import type { DamageBreakdown } from '@/engine/dps/calculator';
import styles from './RotationDPSSummary.module.css';

interface Props {
  /** Calculator output for the current rotation. `null` when the
   *  rotation is empty / the engine isn't ready. */
  breakdown: DamageBreakdown | null;
  /** One-cycle wall-clock time (seconds). Shown in the header so the user
   *  can sanity-check the cpm derivation. */
  cycleSeconds: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString();
const fmtPct = (frac: number) =>
  frac >= 0.001 ? `${(frac * 100).toFixed(1)}%` : '<0.1%';

export function RotationDPSSummary({ breakdown, cycleSeconds }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Sort by per-minute damage descending so the top contributors lead.
  // Drop zero-damage components — usually misconfigured / inactive procs.
  const rows = useMemo(() => {
    if (!breakdown) return [];
    return breakdown.byComponent
      .filter(c => c.damagePerMinute > 0)
      .sort((a, b) => b.damagePerMinute - a.damagePerMinute);
  }, [breakdown]);

  if (!breakdown) {
    return (
      <section className={styles.summary}>
        <div className={styles.header}>
          <span className={styles.label}>Rotation DPS</span>
          <span className={styles.empty}>
            Add at least one spell to the rotation to see DPS.
          </span>
        </div>
      </section>
    );
  }

  const total = breakdown.totalDPS;

  return (
    <section className={styles.summary}>
      <div className={styles.header}>
        <span className={styles.label}>
          Rotation DPS · <span className={styles.dpsValue}>{fmt(total)}</span>
        </span>
        <span className={styles.subLabel}>
          {fmt(breakdown.totalPerMinute)} dmg/min over {cycleSeconds.toFixed(1)}s cycle
        </span>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={() => setExpanded(e => !e)}
          title="Show / hide per-component contributions"
        >
          {expanded ? '▾ Breakdown' : '▸ Breakdown'}
        </button>
      </div>

      {expanded && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colName}>Component</th>
                <th className={styles.colNum}>Per cast</th>
                <th className={styles.colNum}>Triggers/min</th>
                <th className={styles.colNum}>Damage/min</th>
                <th className={styles.colPct}>% of total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const frac = c.damagePerMinute / breakdown.totalPerMinute;
                return (
                  <tr key={`${c.component.label}-${i}`}>
                    <td className={styles.colName}>{c.component.label}</td>
                    <td className={styles.colNum}>{fmt(c.damagePerTrigger)}</td>
                    <td className={styles.colNum}>{c.triggersPerMinute.toFixed(1)}</td>
                    <td className={styles.colNum}>{fmt(c.damagePerMinute)}</td>
                    <td className={styles.colPct}>
                      <span className={styles.pctBarOuter}>
                        <span
                          className={styles.pctBarInner}
                          style={{ width: `${Math.min(100, frac * 100)}%` }}
                        />
                      </span>
                      <span className={styles.pctText}>{fmtPct(frac)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.colName}><strong>Total</strong></td>
                <td className={styles.colNum} />
                <td className={styles.colNum} />
                <td className={styles.colNum}><strong>{fmt(breakdown.totalPerMinute)}</strong></td>
                <td className={styles.colPct} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
