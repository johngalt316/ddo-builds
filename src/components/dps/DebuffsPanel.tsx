// Phase 6.4.7b — Debuffs panel.
//
// Toggle-and-scope UI over `DEBUFF_CATALOG`. Each row enables a debuff,
// chooses Self/Party scope (informational), and displays the effect
// magnitude. Active debuffs aggregate into `Debuffs` upstream and flow
// into `damagePerCast` so the rotation palette tile damage updates
// live as toggles change.

import { useMemo } from 'react';
import {
  DEBUFF_CATALOG,
  type DebuffEntry,
  type DebuffSource,
  type DebuffScope,
  type DebuffState,
} from '@/engine/dps/debuffs';
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
  return parts.join(' · ');
}

interface Props {
  state: DebuffState;
  onChange: (state: DebuffState) => void;
}

export function DebuffsPanel({ state, onChange }: Props) {
  const grouped = useMemo(() => {
    const m = new Map<DebuffSource, DebuffEntry[]>();
    for (const entry of DEBUFF_CATALOG) {
      const list = m.get(entry.source) ?? [];
      list.push(entry);
      m.set(entry.source, list);
    }
    return [...m.entries()];
  }, []);

  const activeCount = Object.values(state).filter(s => s.enabled).length;

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

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.title}>Active Debuffs</span>
        <span className={styles.count}>
          {activeCount} active of {DEBUFF_CATALOG.length}
        </span>
      </header>

      {grouped.map(([source, entries]) => (
        <div key={source} className={styles.group}>
          <h4 className={styles.groupHeading}>{SOURCE_LABEL[source]}</h4>
          <div className={styles.rows}>
            {entries.map(entry => {
              const s = state[entry.id];
              if (!s) return null;
              return (
                <div
                  key={entry.id}
                  className={s.enabled ? styles.rowActive : styles.row}
                  title={entry.description}
                >
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => toggle(entry.id)}
                    />
                    <span className={styles.label}>{entry.label}</span>
                  </label>
                  <span className={styles.effect}>{formatEffect(entry)}</span>
                  <select
                    className={styles.scope}
                    value={s.scope}
                    disabled={!s.enabled}
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
    </section>
  );
}
