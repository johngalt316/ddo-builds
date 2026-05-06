// Phase 6.x — Enhancement-set selector bar.
//
// Renders at the top of the Enhancements / Destinies / Reaper tabs.
// Mirrors the gear-set tab pattern: per-set tabs + CRUD toolbar (+, ✎,
// ⧉, ✕). Switching the active tab changes which EnhancementSet the
// engine reads, which in turn flips the displayed allocations across
// all three tabs in lockstep.

import { useBuildStore } from '@/store/buildStore';
import styles from './EnhancementSetBar.module.css';

export function EnhancementSetBar() {
  const sets       = useBuildStore(s => s.build.enhancementSets);
  const activeName = useBuildStore(s => s.build.activeEnhancementSet);
  const setActive            = useBuildStore(s => s.setActiveEnhancementSet);
  const createSet            = useBuildStore(s => s.createEnhancementSet);
  const duplicateSet         = useBuildStore(s => s.duplicateEnhancementSet);
  const renameSet            = useBuildStore(s => s.renameEnhancementSet);
  const deleteSet            = useBuildStore(s => s.deleteEnhancementSet);

  const list   = sets ?? [];
  const active = list.find(s => s.name === activeName) ?? list[0];

  function handleNew() {
    const proposed = `Set ${list.length + 1}`;
    const name = window.prompt('New enhancement set name:', proposed);
    if (!name) return;
    if (list.some(s => s.name === name)) {
      window.alert(`A set named "${name}" already exists.`);
      return;
    }
    createSet(name);
  }
  function handleRename() {
    if (!active) return;
    const name = window.prompt('Rename enhancement set:', active.name);
    if (!name || name === active.name) return;
    if (list.some(s => s.name === name)) {
      window.alert(`A set named "${name}" already exists.`);
      return;
    }
    renameSet(active.name, name);
  }
  function handleDuplicate() {
    if (!active) return;
    const name = window.prompt('Copy enhancement set as:', `${active.name} (copy)`);
    if (!name) return;
    if (list.some(s => s.name === name)) {
      window.alert(`A set named "${name}" already exists.`);
      return;
    }
    duplicateSet(active.name, name);
  }
  function handleDelete() {
    if (!active || list.length <= 1) return;
    if (!window.confirm(`Delete enhancement set "${active.name}"?`)) return;
    deleteSet(active.name);
  }

  return (
    <div className={styles.bar}>
      <div className={styles.tabs} role="tablist" aria-label="Enhancement sets">
        {list.map(set => {
          const viewing = set.name === activeName;
          return (
            <button
              key={set.name}
              role="tab"
              aria-selected={viewing}
              className={viewing ? styles.tabActive : styles.tab}
              onClick={() => { if (!viewing) setActive(set.name); }}
              title="Switch to this enhancement set"
            >
              {set.name}
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button className={styles.btn} onClick={handleNew} title="New set">+</button>
        <button className={styles.btn} onClick={handleRename} title="Rename" disabled={!active}>✎</button>
        <button className={styles.btn} onClick={handleDuplicate} title="Duplicate" disabled={!active}>⧉</button>
        <button
          className={styles.btnDanger}
          onClick={handleDelete}
          title={list.length <= 1 ? 'Cannot delete the last set' : 'Delete set'}
          disabled={list.length <= 1}
        >✕</button>
      </div>
    </div>
  );
}
