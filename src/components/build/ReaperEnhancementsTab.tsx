import { useMemo } from 'react';
import { useBuildStore, apSpent, MAX_REAPER_AP } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { EnhancementTreeGrid } from './EnhancementTreeGrid';
import { requiredReaperXp } from '@/engine/reaperXp';
import styles from './DestiniesTab.module.css';

/**
 * Reaper enhancements tab.
 *
 * In DDO, all characters automatically have access to all 3 reaper trees —
 * unlike heroic enhancements / epic destinies, the player never picks which
 * trees to display. So this tab renders all reaper trees in a fixed order
 * with no selection picker.
 */
const REAPER_TREE_ORDER = ['Dread Adversary', 'Dire Thaumaturge', 'Grim Barricade'];

export function ReaperEnhancementsTab() {
  const reaperEnhancements = useBuildStore(s => s.build.reaperEnhancements);
  const allTrees = useGameDataStore(s => s.enhancementTrees);
  const status   = useGameDataStore(s => s.status);

  // Pull the 3 reaper trees in canonical order (any tree not in REAPER_TREE_ORDER
  // — e.g. future additions — appears at the end alphabetically).
  const reaperTrees = useMemo(() => {
    const reaper = allTrees.filter(t => t.isReaperTree);
    const ordered = REAPER_TREE_ORDER
      .map(name => reaper.find(t => t.name === name))
      .filter((t): t is NonNullable<typeof t> => !!t);
    const remainder = reaper
      .filter(t => !REAPER_TREE_ORDER.includes(t.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...ordered, ...remainder];
  }, [allTrees]);

  const totalAP = useMemo(
    () => apSpent(reaperEnhancements ?? [], allTrees),
    [reaperEnhancements, allTrees],
  );

  if (status === 'loading') {
    return <div className={styles.loading}>Loading reaper data…</div>;
  }
  if (reaperTrees.length === 0) {
    return <div className={styles.empty}>Reaper trees aren't loaded yet.</div>;
  }

  return (
    <div className={styles.tab}>
      <div className={styles.apBar}>
        <span className={styles.apLabel}>Reaper Points</span>
        <div className={styles.apTrack}>
          <div
            className={styles.apFill}
            style={{ width: `${Math.min(100, (totalAP / MAX_REAPER_AP) * 100)}%` }}
          />
        </div>
        <span className={styles.apRemaining}>
          {totalAP} spent
          {totalAP > 0 && (
            <span className={styles.reaperXp}> · {requiredReaperXp(totalAP)}k Reaper XP required</span>
          )}
        </span>
      </div>

      <div className={styles.treePanels}>
        {reaperTrees.map(tree => (
          <EnhancementTreeGrid key={tree.name} tree={tree} treeKind="reaper" />
        ))}
      </div>
    </div>
  );
}
