import { useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import styles from './StancesPicker.module.css';

/**
 * Toggleable list of stances. Active stances feed `BuildContext.activeStances`,
 * which gates all <Stance>-requirement Effects in the engine.
 *
 * No requirement enforcement here — the user can opt into any stance
 * regardless of weapon/feat prerequisites. The engine evaluates per-Effect
 * stance gates separately.
 */
export function StancesPicker() {
  const stances = useGameDataStore(s => s.stances);
  const active = useBuildStore(s => s.build.activeStances);
  const toggleStance = useBuildStore(s => s.toggleStance);

  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const grouped = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    const matches = stances.filter(s =>
      !lc || s.name.toLowerCase().includes(lc) || s.description.toLowerCase().includes(lc),
    );
    const m = new Map<string, typeof stances>();
    for (const s of matches) {
      const g = s.group || 'Other';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(s);
    }
    return m;
  }, [stances, filter]);

  const activeSet = new Set(active);
  const totalCount = stances.length;
  const displayedCount = [...grouped.values()].reduce((n, l) => n + l.length, 0);

  if (stances.length === 0) {
    return <div className={styles.empty}>Loading stances…</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <input
          type="search"
          className={styles.filter}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={`Filter ${totalCount} stances…`}
          aria-label="Filter stances"
        />
        <span className={styles.activeCount}>
          {active.length} active{filter && ` · ${displayedCount} matching`}
        </span>
        {!showAll && active.length > 0 && (
          <button className={styles.linkBtn} onClick={() => setShowAll(true)}>
            show all
          </button>
        )}
        {showAll && (
          <button className={styles.linkBtn} onClick={() => setShowAll(false)}>
            show active only
          </button>
        )}
      </div>

      {[...grouped.entries()].map(([group, list]) => {
        const visible = showAll || filter ? list : list.filter(s => activeSet.has(s.name));
        if (visible.length === 0) return null;
        return (
          <section key={group} className={styles.group}>
            <h4 className={styles.groupHeading}>{group}</h4>
            <div className={styles.chips}>
              {visible.map(s => {
                const on = activeSet.has(s.name);
                return (
                  <button
                    key={s.name}
                    className={on ? styles.chipActive : styles.chip}
                    onClick={() => toggleStance(s.name)}
                    title={s.description}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {!showAll && !filter && active.length === 0 && (
        <div className={styles.hint}>
          No active stances. Click <button className={styles.inlineBtn} onClick={() => setShowAll(true)}>show all</button> to browse and toggle.
        </div>
      )}
    </div>
  );
}
