import { useState, useMemo } from 'react';
import { useBuildStore, apSpent, MAX_HEROIC_AP } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { nameToId } from '@/utils/classAdapter';
import type { EnhancementTreeData } from '@/types/ddoData';
import type { DDOClassData } from '@/types/ddoData';
import { EnhancementTreeGrid } from './EnhancementTreeGrid';
import styles from './EnhancementsTab.module.css';

/**
 * Determine whether an enhancement tree is available to the current build.
 *
 * Rules (matching DDOBuilderV2 logic):
 *  - Universal trees: always available (feat/favor requirement only)
 *  - Racial trees: available when character race matches
 *  - Class=X: available when build has exactly class X
 *  - BaseClass=Y: available when build has any class whose BaseClass is Y
 *    (i.e. the prestige class and its base class both access these trees)
 */
function isTreeAvailable(
  tree: EnhancementTreeData,
  buildClassIds: Set<string>,
  buildRaceId: string,
  classDataList: DDOClassData[],
): boolean {
  if (tree.isUniversal) return true;

  // Race tree
  if (tree.isRacialTree || tree.raceReq) {
    const req = tree.raceReq ?? tree.name;
    return nameToId(req) === buildRaceId;
  }

  if (tree.classReqs.length === 0) return false;

  // Build a map: classId → baseClass name (lower-cased)
  const baseClassMap = new Map<string, string>();
  for (const cls of classDataList) {
    if (cls.baseClass) {
      baseClassMap.set(nameToId(cls.name), nameToId(cls.baseClass));
    }
  }

  // Check each requirement — any match is sufficient (RequiresOneOf semantics)
  for (const req of tree.classReqs) {
    const reqId = nameToId(req.className);
    if (req.matchType === 'Class') {
      if (buildClassIds.has(reqId)) return true;
    } else {
      // BaseClass: check if any build class IS the base or has it as its base
      for (const classId of buildClassIds) {
        if (classId === reqId) return true;               // base class itself
        if (baseClassMap.get(classId) === reqId) return true; // prestige of base
      }
    }
  }
  return false;
}

export function EnhancementsTab() {
  const build         = useBuildStore(s => s.build);
  const toggleTree    = useBuildStore(s => s.toggleTree);
  const trees         = useGameDataStore(s => s.enhancementTrees);
  const classDataList = useGameDataStore(s => s.classes);
  const status        = useGameDataStore(s => s.status);
  const [pickerOpen, setPickerOpen] = useState(false);

  const totalAP    = apSpent(build.enhancements);
  const remaining  = MAX_HEROIC_AP - totalAP;

  const buildClassIds = useMemo(
    () => new Set(build.classes.map(c => c.classId)),
    [build.classes],
  );

  // All heroic trees eligible for this character (destiny trees handled separately)
  const allEligible = useMemo(
    () => trees
      .filter(t => !t.isDestinyTree && isTreeAvailable(t, buildClassIds, build.raceId, classDataList))
      .sort((a, b) => {
        // Sort: race tree first, then class trees, then universal
        if (a.isRacialTree !== b.isRacialTree) return a.isRacialTree ? -1 : 1;
        if (a.isUniversal !== b.isUniversal) return a.isUniversal ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [trees, buildClassIds, build.raceId, classDataList],
  );

  // The currently selected tree objects
  const selectedTrees = useMemo(
    () => build.selectedEnhancementTrees
      .map(name => trees.find(t => t.name === name))
      .filter((t): t is NonNullable<typeof t> => t !== null && t !== undefined),
    [build.selectedEnhancementTrees, trees],
  );

  if (status === 'loading') {
    return <div className={styles.loading}>Loading enhancement data…</div>;
  }

  if (status === 'error') {
    return <div className={styles.error}>Failed to load enhancement trees.</div>;
  }

  return (
    <div className={styles.tab}>
      {/* AP Budget bar */}
      <div className={styles.apBar}>
        <span className={styles.apLabel}>Action Points</span>
        <div className={styles.apTrack}>
          <div
            className={styles.apFill}
            style={{ width: `${Math.min(100, (totalAP / MAX_HEROIC_AP) * 100)}%` }}
          />
        </div>
        <span className={remaining < 0 ? styles.apOver : styles.apRemaining}>
          {totalAP} / {MAX_HEROIC_AP}
        </span>
        <button
          className={styles.addTreeBtn}
          onClick={() => setPickerOpen(p => !p)}
          title="Add / remove enhancement trees"
        >
          {pickerOpen ? '✕ Close' : '＋ Trees'}
        </button>
      </div>

      {/* Tree picker */}
      {pickerOpen && (
        <div className={styles.picker}>
          <p className={styles.pickerHint}>
            Select up to 6 trees. Trees for your current classes and race are shown.
          </p>
          <div className={styles.pickerList}>
            {allEligible.length === 0 && (
              <span className={styles.pickerEmpty}>No matching trees found for current build.</span>
            )}
            {allEligible.map(t => {
              const selected = build.selectedEnhancementTrees.includes(t.name);
              const canAdd   = !selected && build.selectedEnhancementTrees.length >= 6;
              return (
                <button
                  key={t.name}
                  className={[styles.pickerTree, selected ? styles.pickerSelected : ''].join(' ')}
                  onClick={() => toggleTree(t.name)}
                  disabled={canAdd}
                  title={selected ? 'Remove tree' : 'Add tree'}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected tree panels */}
      {selectedTrees.length === 0 ? (
        <div className={styles.empty}>
          {trees.length === 0
            ? 'Enhancement data is still loading — please wait.'
            : 'No enhancement trees selected. Click "＋ Trees" to add trees for your class.'}
        </div>
      ) : (
        <div className={styles.treePanels}>
          {selectedTrees.map(tree => (
            <EnhancementTreeGrid key={tree.name} tree={tree} />
          ))}
        </div>
      )}
    </div>
  );
}
