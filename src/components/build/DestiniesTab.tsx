import { useState, useMemo } from 'react';
import {
  useBuildStore, apSpent, MAX_DESTINY_TREES, MAX_DESTINY_AP,
} from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { EnhancementTreeGrid } from './EnhancementTreeGrid';
import styles from './DestiniesTab.module.css';

export function DestiniesTab() {
  const build           = useBuildStore(s => s.build);
  const toggleTree      = useBuildStore(s => s.toggleTree);
  const allTrees        = useGameDataStore(s => s.enhancementTrees);
  const status          = useGameDataStore(s => s.status);
  const [pickerOpen, setPickerOpen] = useState(false);

  // All destiny trees from the loaded data
  const destinyTrees = useMemo(
    () => allTrees.filter(t => t.isDestinyTree).sort((a, b) => a.name.localeCompare(b.name)),
    [allTrees],
  );

  // Use the cost-aware AP calc so multi-AP-per-rank destiny enhancements
  // (e.g. some Tier-5 abilities cost 2 AP/rank) are reported correctly.
  const totalAP = useMemo(
    () => apSpent(build.destinyEnhancements, allTrees),
    [build.destinyEnhancements, allTrees],
  );

  // Selected destiny tree objects (from selectedEnhancementTrees that are destiny trees)
  const selectedDestinyTrees = useMemo(
    () => build.selectedEnhancementTrees
      .map(name => destinyTrees.find(t => t.name === name))
      .filter((t): t is NonNullable<typeof t> => t !== null && t !== undefined),
    [build.selectedEnhancementTrees, destinyTrees],
  );

  if (status === 'loading') {
    return <div className={styles.loading}>Loading destiny data…</div>;
  }

  return (
    <div className={styles.tab}>
      {/* AP bar */}
      <div className={styles.apBar}>
        <span className={styles.apLabel}>Fate Points</span>
        <div className={styles.apTrack}>
          <div
            className={styles.apFill}
            style={{ width: `${Math.min(100, (totalAP / MAX_DESTINY_AP) * 100)}%` }}
          />
        </div>
        <span className={styles.apRemaining}>{totalAP} spent</span>
        <button
          className={styles.addTreeBtn}
          onClick={() => setPickerOpen(p => !p)}
        >
          {pickerOpen ? '✕ Close' : '＋ Destinies'}
        </button>
      </div>

      {/* Picker */}
      {pickerOpen && (
        <div className={styles.picker}>
          <p className={styles.pickerHint}>
            Select up to {MAX_DESTINY_TREES} epic destiny trees.
          </p>
          <div className={styles.pickerList}>
            {destinyTrees.length === 0 && (
              <span className={styles.pickerEmpty}>No destiny trees found.</span>
            )}
            {destinyTrees.map(t => {
              const selected = build.selectedEnhancementTrees.includes(t.name);
              const canAdd   = !selected && build.selectedEnhancementTrees.filter(
                n => destinyTrees.some(d => d.name === n),
              ).length >= MAX_DESTINY_TREES;
              return (
                <button
                  key={t.name}
                  className={[styles.pickerTree, selected ? styles.pickerSelected : ''].join(' ')}
                  onClick={() => toggleTree(t.name)}
                  disabled={canAdd}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Destiny tree panels */}
      {selectedDestinyTrees.length === 0 ? (
        <div className={styles.empty}>
          {destinyTrees.length === 0
            ? 'Destiny data is still loading — please wait.'
            : 'No epic destiny trees selected. Click "＋ Destinies" to choose yours.'}
        </div>
      ) : (
        <div className={styles.treePanels}>
          {selectedDestinyTrees.map(tree => (
            <EnhancementTreeGrid key={tree.name} tree={tree} treeKind="destiny" />
          ))}
        </div>
      )}
    </div>
  );
}
