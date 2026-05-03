import { useState } from 'react';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { StancesPicker } from './StancesPicker';
import type { BreakdownResult } from '@/engine/bonusStacking';
import styles from './BreakdownsTab.module.css';

interface RowProps {
  label: string;
  result: BreakdownResult;
}

function Row({ label, result }: RowProps) {
  const [open, setOpen] = useState(false);
  const applied = result.contributors.filter(c => c.applied);
  const dominated = result.contributors.filter(c => !c.applied);

  return (
    <div className={styles.row}>
      <button
        className={styles.rowHeader}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={open ? styles.chevronOpen : styles.chevron}>▸</span>
        <span className={styles.label}>{label}</span>
        <span className={styles.total}>{result.total}</span>
        <span className={styles.count}>
          {applied.length} applied{dominated.length ? ` · ${dominated.length} dominated` : ''}
        </span>
      </button>
      {open && (
        <div className={styles.body}>
          {applied.length === 0 && dominated.length === 0 && (
            <div className={styles.emptyContrib}>No contributors yet (effect sources still being implemented).</div>
          )}
          {applied.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Target</th>
                  <th className={styles.numCol}>Value</th>
                </tr>
              </thead>
              <tbody>
                {applied.map((c, i) => (
                  <tr key={`a-${i}`}>
                    <td>{c.source}</td>
                    <td>{c.bonusType || <span className={styles.muted}>untyped</span>}</td>
                    <td>{c.target ?? ''}</td>
                    <td className={styles.numCol}>
                      {c.value > 0 ? `+${c.value}` : c.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {dominated.length > 0 && (
            <details className={styles.dominated}>
              <summary>{dominated.length} dominated bonus{dominated.length === 1 ? '' : 'es'}</summary>
              <table className={styles.table}>
                <tbody>
                  {dominated.map((c, i) => (
                    <tr key={`d-${i}`} className={styles.dominatedRow}>
                      <td>{c.source}</td>
                      <td>{c.bonusType}</td>
                      <td className={styles.numCol}>+{c.value}</td>
                      <td className={styles.muted}>← dominated by {c.dominatedBy ?? 'unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function BreakdownsTab() {
  const r = useBreakdowns();

  if (!r) {
    return <div className={styles.loading}>Loading game data…</div>;
  }

  const { abilityScores, hitPoints, saves, meleePower, rangedPower, doublestrike, doubleshot, healingAmp, diagnostics } = r;

  return (
    <div className={styles.page}>
      <p className={styles.disclaimer}>
        Live engine output. Sources: feats, enhancements, destinies, active gear, set bonuses, and stances.
        The Stats panes above read from the same engine. A few amount-type categories (Slider, SpellInfo) are still unmodeled — see Diagnostics below.
      </p>

      <StancesPicker />

      <section className={styles.section}>
        <h3 className={styles.heading}>Ability Scores</h3>
        {(['STR','DEX','CON','INT','WIS','CHA'] as const).map(s => (
          <Row key={s} label={s} result={abilityScores[s]} />
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Defenses</h3>
        <Row label="Hit Points" result={hitPoints} />
        <Row label="Fortitude"  result={saves.Fortitude} />
        <Row label="Reflex"     result={saves.Reflex} />
        <Row label="Will"       result={saves.Will} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Combat</h3>
        <Row label="Melee Power"   result={meleePower} />
        <Row label="Ranged Power"  result={rangedPower} />
        <Row label="Doublestrike"  result={doublestrike} />
        <Row label="Doubleshot"    result={doubleshot} />
        <Row label="Healing Amp"   result={healingAmp} />
      </section>

      <section className={styles.diagnostics}>
        <h3 className={styles.heading}>Diagnostics</h3>
        <dl>
          <dt>Sourced effects</dt><dd>{diagnostics.totalSourcedEffects}</dd>
          <dt>Applied bonuses</dt><dd>{diagnostics.totalAppliedBonuses}</dd>
          <dt>Requirements failed</dt><dd>{diagnostics.requirementsFailedCount}</dd>
          {diagnostics.unmatchedFeats.length > 0 && (
            <>
              <dt>Unmatched feats</dt>
              <dd className={styles.unmatched}>{diagnostics.unmatchedFeats.join(', ')}</dd>
            </>
          )}
          {Object.keys(diagnostics.unmodeledAmountTypes).length > 0 && (
            <>
              <dt>Unmodeled amount types</dt>
              <dd className={styles.unmatched}>
                {Object.entries(diagnostics.unmodeledAmountTypes)
                  .map(([k, v]) => `${k} (${v})`).join(', ')}
              </dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
