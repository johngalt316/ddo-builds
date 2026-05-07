// Phase 6.4.7b — Debuffs UI.
//
// Two pieces:
//
//   • <DebuffsSummary>      — compact inline row showing the currently
//                             active debuffs as chips plus a Manage button.
//                             Lives in the DPS panel above the rotation.
//   • <ManageDebuffsDialog> — popup that toggles each catalog debuff +
//                             selects Self/Party scope. Updates the parent
//                             state live (toggling immediately reflects in
//                             rotation tile damage).
//
// The summary collapses the previously-inline panel; full toggles live
// in the dialog, mirroring how active spells are managed.

import { useMemo } from 'react';
import {
  DEBUFF_CATALOG,
  autoActiveDebuffIds,
  type DebuffEntry,
  type DebuffSource,
  type DebuffScope,
  type DebuffState,
} from '@/engine/dps/debuffs';
import type { Build } from '@/types/build';
import styles from './DebuffsPanel.module.css';

const SOURCE_LABEL: Record<DebuffSource, string> = {
  'caster-spell':   'Caster Spells',
  'martial-tactic': 'Martial Tactics',
  'item':           'Item Effects',
  'aura':           'Auras',
  'monster':        'Monster-applied',
  'other':          'Other',
};

function formatEffect(entry: DebuffEntry): string {
  const parts: string[] = [];
  const e = entry.effect;
  if (e.genericVulnPct)   parts.push(`+${e.genericVulnPct}% generic vuln`);
  if (e.elementVulnPct) {
    for (const [el, v] of Object.entries(e.elementVulnPct)) {
      if (v) parts.push(`+${v}% ${el}`);
    }
  }
  if (e.mrrReduction)     parts.push(`−${e.mrrReduction} MRR`);
  if (e.prrReduction)     parts.push(`−${e.prrReduction} PRR`);
  if (e.application === 'ramping' && e.rampSeconds) {
    parts.push(`ramps ~${e.rampSeconds}s`);
  }
  return parts.join(' · ');
}

// ── Summary (collapsed default view) ────────────────────────────────────

interface SummaryProps {
  state: DebuffState;
  build: Build;
  onManage: () => void;
}

export function DebuffsSummary({ state, build, onManage }: SummaryProps) {
  const auto = useMemo(() => autoActiveDebuffIds(build), [build]);
  const active = useMemo(
    () => DEBUFF_CATALOG.filter(e => state[e.id]?.enabled || auto.has(e.id)),
    [state, auto],
  );

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>
          Debuffs · {active.length} active
        </span>
        <button
          type="button"
          className={styles.manageBtn}
          onClick={onManage}
          title="Pick which target debuffs are active in the simulation"
        >
          + Manage
        </button>
      </div>
      {active.length === 0 ? (
        <div className={styles.summaryEmpty}>
          No active debuffs — target damage uses baseline values.
        </div>
      ) : (
        <div className={styles.chips}>
          {active.map(e => {
            const isAuto = auto.has(e.id);
            const titleParts = [
              e.description,
              formatEffect(e),
              isAuto ? 'Auto-applied: triggered by your equipped gear.' : '',
            ].filter(Boolean);
            return (
              <span key={e.id} className={styles.chip} title={titleParts.join('\n')}>
                {e.label}
                {isAuto && <span className={styles.chipAuto}>auto</span>}
                {!isAuto && (
                  <span className={styles.chipScope}>
                    {state[e.id]?.scope === 'party' ? 'party' : 'self'}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Dialog (full toggle UI) ─────────────────────────────────────────────

interface DialogProps {
  open: boolean;
  state: DebuffState;
  build: Build;
  onChange: (state: DebuffState) => void;
  onClose: () => void;
}

export function ManageDebuffsDialog({ open, state, build, onChange, onClose }: DialogProps) {
  const grouped = useMemo(() => {
    const m = new Map<DebuffSource, DebuffEntry[]>();
    for (const entry of DEBUFF_CATALOG) {
      const list = m.get(entry.source) ?? [];
      list.push(entry);
      m.set(entry.source, list);
    }
    return [...m.entries()];
  }, []);

  const auto = useMemo(() => autoActiveDebuffIds(build), [build]);
  // Auto-applied debuffs are also "active" for the count even if the
  // user hasn't manually toggled them.
  const activeCount = DEBUFF_CATALOG.filter(e =>
    state[e.id]?.enabled || auto.has(e.id),
  ).length;

  function toggle(id: string) {
    const cur = state[id];
    if (!cur) return;
    onChange({ ...state, [id]: { ...cur, enabled: !cur.enabled } });
  }
  function setScope(id: string, scope: DebuffScope) {
    const cur = state[id];
    if (!cur) return;
    onChange({ ...state, [id]: { ...cur, scope } });
  }

  if (!open) return null;

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Manage active debuffs"
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <h3 className={styles.dialogTitle}>Manage Active Debuffs</h3>
          <span className={styles.dialogCount}>
            {activeCount} of {DEBUFF_CATALOG.length} active
          </span>
          <button
            type="button"
            className={styles.dialogCloseBtn}
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </header>

        <div className={styles.dialogBody}>
          {grouped.map(([source, entries]) => (
            <div key={source} className={styles.group}>
              <h4 className={styles.groupHeading}>{SOURCE_LABEL[source]}</h4>
              <div className={styles.rows}>
                {entries.map(entry => {
                  const s = state[entry.id];
                  if (!s) return null;
                  const isAuto = auto.has(entry.id);
                  const effectivelyActive = s.enabled || isAuto;
                  return (
                    <div
                      key={entry.id}
                      className={effectivelyActive ? styles.rowActive : styles.row}
                      title={isAuto
                        ? `${entry.description}\nAuto-applied: triggered by your equipped gear.`
                        : entry.description}
                    >
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={effectivelyActive}
                          disabled={isAuto}
                          onChange={() => toggle(entry.id)}
                        />
                        <span className={styles.label}>{entry.label}</span>
                        {isAuto && <span className={styles.autoBadge}>auto</span>}
                      </label>
                      <span className={styles.effect}>{formatEffect(entry)}</span>
                      <select
                        className={styles.scope}
                        value={s.scope}
                        disabled={!effectivelyActive || isAuto}
                        onChange={e => setScope(entry.id, e.target.value as DebuffScope)}
                        aria-label={`${entry.label} scope`}
                      >
                        <option value="self">Self</option>
                        <option value="party">Party</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <footer className={styles.dialogFooter}>
          <button type="button" className={styles.doneBtn} onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
