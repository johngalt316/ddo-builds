// Small shared widgets used by both the Magic and Melee editors:
// the simulation-duration dropdown, generic Metric chip, and the
// Target / enemy-info row.

import { fmt } from '@/utils/formatNumbers';
import { SIM_DURATION_OPTIONS, TARGET_LABELS } from './shared';
import styles from '../DPSCalculatorPanel.module.css';

export function SimDurationPicker({
  value, onChange,
}: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      className={styles.select}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      title="Simulation window length — auto-fill targets this duration"
      style={{ fontSize: '0.78rem', padding: '0.2rem 0.4rem' }}
    >
      {SIM_DURATION_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Metric({
  label, value, title,
}: { label: string; value: string; title?: string }) {
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
export function TargetRow({
  targetCount, setTargetCount, prr, mrr,
}: {
  targetCount: number;
  setTargetCount: (next: number) => void;
  prr: number;
  mrr: number;
}) {
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
