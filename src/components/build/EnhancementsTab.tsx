import { useEffect, useState, useMemo } from 'react';
import {
  useBuildStore,
  apSpentByCategory, applyAPOverflow, specialFeatBonusAP,
  BASE_STANDARD_AP, BASE_RACIAL_AP, BASE_UNIVERSAL_AP,
  MAX_RACIAL_AP_TOME, MAX_UNIVERSAL_AP_TOME,
} from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { nameToId } from '@/utils/classAdapter';
import { computeDefaultEnhancementTrees } from '@/utils/defaultEnhancementTrees';
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
  const build           = useBuildStore(s => s.build);
  const toggleTree      = useBuildStore(s => s.toggleTree);
  const setSelectedTrees = useBuildStore(s => s.setSelectedTrees);
  const trees           = useGameDataStore(s => s.enhancementTrees);
  const classDataList   = useGameDataStore(s => s.classes);
  const status          = useGameDataStore(s => s.status);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-seed (and re-seed) selectedEnhancementTrees from race + top class
  // whenever those change — until the user explicitly toggles a tree, which
  // sets `treesManuallyOverridden: true` and locks in their choice.
  useEffect(() => {
    if (status !== 'ready') return;
    if (build.treesManuallyOverridden) return;
    if (build.classes.length === 0 || trees.length === 0) return;

    const defaults = computeDefaultEnhancementTrees(build, classDataList, trees);
    if (defaults.length === 0) return;

    // Only push state if the new defaults actually differ from current —
    // avoids a render loop when the effect's deps tick but defaults are stable.
    const cur = build.selectedEnhancementTrees;
    const same = cur.length === defaults.length && cur.every((t, i) => t === defaults[i]);
    if (!same) setSelectedTrees(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status,
    build.treesManuallyOverridden,
    build.classes,
    build.raceId,
    classDataList,
    trees,
  ]);

  // RAP / UAP bonuses come from trained special feats (racial past lives,
  // Inherent Racial Action Point tome, etc.). Standard AP has no bonus
  // source — it's fixed at 80.
  const allFeats = useGameDataStore(s => s.feats);
  const setEnhancementTome = useBuildStore(s => s.setEnhancementTome);
  const tomes = build.enhancementTomes ?? {};
  const racialBonus    = useMemo(
    () => specialFeatBonusAP(build.specialFeats, allFeats, 'RAPBonus'),
    [build.specialFeats, allFeats],
  );
  const universalBonus = useMemo(
    () => specialFeatBonusAP(build.specialFeats, allFeats, 'UAPBonus'),
    [build.specialFeats, allFeats],
  );
  const racialTome    = tomes.racial    ?? 0;
  const universalTome = tomes.universal ?? 0;
  const racialCap    = BASE_RACIAL_AP    + racialBonus    + racialTome;
  const universalCap = BASE_UNIVERSAL_AP + universalBonus + universalTome;

  // AP totals per category use real costPerRank tables. Then apply the
  // overflow rule: racial / universal spend over their caps spills into
  // the standard pool (matching DDOBuilderV2's pool accounting).
  const rawSpent = useMemo(
    () => apSpentByCategory(build.enhancements, trees),
    [build.enhancements, trees],
  );
  const pools = useMemo(
    () => applyAPOverflow(rawSpent, racialCap, universalCap),
    [rawSpent, racialCap, universalCap],
  );

  const buildClassIds = useMemo(
    () => new Set(build.classes.map(c => c.classId)),
    [build.classes],
  );

  // All heroic trees eligible for this character. Destiny trees and reaper
  // trees are rendered on their own tabs, so exclude them here.
  const allEligible = useMemo(
    () => trees
      .filter(t => !t.isDestinyTree && !t.isReaperTree
        && isTreeAvailable(t, buildClassIds, build.raceId, classDataList))
      .sort((a, b) => {
        // Sort: race tree first, then class trees, then universal
        if (a.isRacialTree !== b.isRacialTree) return a.isRacialTree ? -1 : 1;
        if (a.isUniversal !== b.isUniversal) return a.isUniversal ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [trees, buildClassIds, build.raceId, classDataList],
  );

  // The currently selected tree objects (heroic only — destiny / reaper trees
  // share the same `selectedEnhancementTrees` list but render on their own
  // tabs and must not appear here).
  const selectedTrees = useMemo(
    () => build.selectedEnhancementTrees
      .map(name => trees.find(t => t.name === name))
      .filter((t): t is NonNullable<typeof t> =>
        t !== null && t !== undefined && !t.isDestinyTree && !t.isReaperTree),
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
      {/* AP pools. Standard absorbs overflow from racial/universal. */}
      <div className={styles.apPools}>
        {(['standard','racial','universal'] as const).map(kind => {
          const pool = pools[kind];
          const remaining = pool.cap - pool.spent;
          const base = kind === 'standard' ? BASE_STANDARD_AP
                     : kind === 'racial'   ? BASE_RACIAL_AP
                                           : BASE_UNIVERSAL_AP;
          const label = kind === 'standard' ? 'Standard' : kind === 'racial' ? 'Racial' : 'Universal';
          const featBonus = kind === 'racial' ? racialBonus
                          : kind === 'universal' ? universalBonus
                          : 0;
          const tomeVal = kind === 'racial' ? racialTome
                        : kind === 'universal' ? universalTome
                        : 0;
          const tomeMax = kind === 'racial' ? MAX_RACIAL_AP_TOME
                        : kind === 'universal' ? MAX_UNIVERSAL_AP_TOME
                        : 0;
          const showTomeRow = kind !== 'standard';
          const overflowFrom: string[] = [];
          if (kind === 'standard') {
            if (pools.racial.overflow    > 0) overflowFrom.push(`+${pools.racial.overflow} racial overflow`);
            if (pools.universal.overflow > 0) overflowFrom.push(`+${pools.universal.overflow} universal overflow`);
          }
          const breakdownParts = [`Base ${base}`];
          if (featBonus > 0) {
            breakdownParts.push(`+${featBonus} from ${kind === 'racial' ? 'racial past lives / inherent RAP' : 'inherent UAP / favor'}`);
          }
          if (tomeVal > 0) breakdownParts.push(`+${tomeVal} tome`);
          if (overflowFrom.length) breakdownParts.push(...overflowFrom);
          return (
            <div key={kind} className={styles.apPool}>
              <div className={styles.apPoolHead}>
                <span className={styles.apPoolLabel}>{label}</span>
                <span className={remaining < 0 ? styles.apOver : styles.apRemaining}>
                  {pool.spent} / {pool.cap}
                </span>
              </div>
              {kind !== 'standard' && (
                <div className={styles.apTrack}>
                  <div
                    className={styles.apFill}
                    style={{ width: `${pool.cap > 0 ? Math.min(100, (pool.spent / pool.cap) * 100) : 0}%` }}
                  />
                </div>
              )}
              <span className={styles.apBreakdown} title={breakdownParts.join(' · ')}>
                {breakdownParts.join(' + ')}
              </span>
              {showTomeRow && (
                <div className={styles.apTomeRow}>
                  <span className={styles.apTomeLabel}>Tome</span>
                  <button
                    className={styles.apTomeBtn}
                    onClick={() => setEnhancementTome(kind, tomeVal - 1)}
                    disabled={tomeVal <= 0}
                    aria-label={`Decrease ${label} AP tome`}
                  >−</button>
                  <span className={styles.apTomeValue}>+{tomeVal}</span>
                  <button
                    className={styles.apTomeBtn}
                    onClick={() => setEnhancementTome(kind, tomeVal + 1)}
                    disabled={tomeVal >= tomeMax}
                    aria-label={`Increase ${label} AP tome`}
                  >+</button>
                  <span className={styles.apTomeMax}>(max +{tomeMax})</span>
                  {pool.overflow > 0 && (
                    <span className={styles.apTomeMax} title="Spend over this pool's cap deducts from Standard">
                      · {pool.overflow} → Standard
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
