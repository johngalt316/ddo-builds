import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EnhancementTreeData, EnhancementItemData } from '@/types/ddoData';
import {
  useBuildStore,
  apSpentInTree,
  apSpent,
  apSpentByCategory, applyAPOverflow, specialFeatBonusAP, treeAPCategory,
  BASE_RACIAL_AP, BASE_UNIVERSAL_AP,
  MAX_DESTINY_AP,
  MAX_REAPER_AP,
} from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { iconUrl } from '@/utils/ddoXmlParser';
import { SelectionPickerDialog } from './SelectionPickerDialog';
import styles from './EnhancementTreeGrid.module.css';

const COLS    = 6;
const MAX_TIER = 5;

export type TreeKind = 'enhancement' | 'destiny' | 'reaper';

interface Props {
  tree: EnhancementTreeData;
  /** Which tree-spend pool the grid reads/writes. */
  treeKind?: TreeKind;
  /** Deprecated alias kept for back-compat: equivalent to treeKind="destiny". */
  destinyMode?: boolean;
}

export function EnhancementTreeGrid({ tree, treeKind, destinyMode = false }: Props) {
  // Resolve treeKind: explicit prop wins; legacy destinyMode falls back to "destiny";
  // default is "enhancement" (heroic).
  const kind: TreeKind = treeKind ?? (destinyMode ? 'destiny' : 'enhancement');
  const build = useBuildStore(s => s.build);

  const spendHeroic    = useBuildStore(s => s.spendEnhancement);
  const revokeHeroic   = useBuildStore(s => s.revokeEnhancement);
  const resetHeroic    = useBuildStore(s => s.resetTree);
  const spendDestiny   = useBuildStore(s => s.spendDestinyEnhancement);
  const revokeDestiny  = useBuildStore(s => s.revokeDestinyEnhancement);
  const resetDestiny   = useBuildStore(s => s.resetDestinyTree);
  const spendReaper    = useBuildStore(s => s.spendReaperEnhancement);
  const revokeReaper   = useBuildStore(s => s.revokeReaperEnhancement);
  const resetReaper    = useBuildStore(s => s.resetReaperTree);

  const spend   = kind === 'destiny' ? spendDestiny   : kind === 'reaper' ? spendReaper   : spendHeroic;
  const revoke  = kind === 'destiny' ? revokeDestiny  : kind === 'reaper' ? revokeReaper  : revokeHeroic;
  const resetFn = kind === 'destiny' ? resetDestiny   : kind === 'reaper' ? resetReaper   : resetHeroic;

  const pool      = kind === 'destiny' ? build.destinyEnhancements
                  : kind === 'reaper'  ? build.reaperEnhancements
                  : build.enhancements;
  // For heroic trees, AP is split across three pools (Standard / Racial /
  // Universal) using each enhancement item's `costPerRank` table. Racial
  // and universal spend over their caps spills into the standard pool.
  // Destiny / reaper still use a single global cap.
  const heroicTrees = useGameDataStore(s => s.enhancementTrees);
  const allFeats    = useGameDataStore(s => s.feats);
  // All trees (heroic / destiny / reaper) live in the same store array;
  // pass it for every kind so apSpentInTree can resolve item costPerRank
  // (and selection-level overrides) instead of falling back to rank=cost.
  const treeAP    = apSpentInTree(tree.name, pool, heroicTrees);
  let totalAP: number;
  let cap: number;
  if (kind === 'destiny') {
    totalAP = apSpent(pool, heroicTrees);
    cap = MAX_DESTINY_AP;
  } else if (kind === 'reaper') {
    totalAP = apSpent(pool, heroicTrees);
    cap = MAX_REAPER_AP;
  } else {
    const apCat = treeAPCategory(tree);
    const tomes = build.enhancementTomes ?? {};
    const racialCap    = BASE_RACIAL_AP    + specialFeatBonusAP(build.specialFeats, allFeats, 'RAPBonus') + (tomes.racial ?? 0);
    const universalCap = BASE_UNIVERSAL_AP + specialFeatBonusAP(build.specialFeats, allFeats, 'UAPBonus') + (tomes.universal ?? 0);
    const byCategory = apSpentByCategory(pool, heroicTrees);
    const pools = applyAPOverflow(byCategory, racialCap, universalCap);
    // For racial/universal trees we still bind the cap to the pool, but
    // additional spending is allowed (overflow flows into Standard). To
    // make the cell-level "totalAPLeft > 0" check honest across all three
    // pools, compute remaining as: (this pool's room) + (Standard's room).
    const standardRoom = pools.standard.cap - pools.standard.spent;
    if (apCat === 'standard') {
      totalAP = pools.standard.spent;
      cap     = pools.standard.cap;
    } else {
      // For racial/universal: the *displayed* cap is the dedicated pool.
      // The user can keep spending past it as long as Standard has room.
      totalAP = pools[apCat].spent;
      cap     = pools[apCat].cap + Math.max(0, standardRoom);
    }
  }
  const remaining = cap - totalAP;

  const treeEntry = pool.find(e => e.treeId === tree.name);
  function ranksFor(internalName: string): number {
    return treeEntry?.enhancements.find(e => e.enhancementId === internalName)?.rank ?? 0;
  }
  function selectionFor(internalName: string): string | undefined {
    return treeEntry?.enhancements.find(e => e.enhancementId === internalName)?.selection;
  }

  // Selector dialog state. When an enhancement with a <Selector> is clicked
  // for the first time (rank 0), we open the picker rather than spending
  // directly — otherwise the per-selection effects (e.g. Stolen Spells'
  // SLA grants) are never wired through. To re-pick a selection, the user
  // right-clicks to revoke and then re-takes it.
  const [selectorPicker, setSelectorPicker] = useState<EnhancementItemData | null>(null);

  function trySpend(item: EnhancementItemData) {
    const hasSelector = (item.selector?.length ?? 0) > 0;
    const currentSel = selectionFor(item.internalName);
    if (hasSelector && !currentSel) {
      setSelectorPicker(item);
      return;
    }
    spend(tree.name, item.internalName, item.ranks, currentSel);
  }

  const coreItems = useMemo(() => tree.items.filter(i => i.isCore), [tree]);
  const tierItems = useMemo(() => tree.items.filter(i => !i.isCore), [tree]);

  // Rows: YPosition 5→1 top-to-bottom
  const rows = useMemo(() => {
    const grid: (EnhancementItemData | null)[][] = [];
    for (let y = MAX_TIER; y >= 1; y--) {
      const row: (EnhancementItemData | null)[] = Array(COLS).fill(null);
      for (const item of tierItems) {
        if (item.yPosition === y && item.xPosition < COLS) row[item.xPosition] = item;
      }
      grid.push(row);
    }
    return grid;
  }, [tierItems]);

  // Core row sorted by XPosition
  const coreRow = useMemo(() => {
    const row: (EnhancementItemData | null)[] = Array(COLS).fill(null);
    for (const item of coreItems) {
      if (item.xPosition < COLS) row[item.xPosition] = item;
    }
    return row;
  }, [coreItems]);

  // Minimum AP-in-tree threshold per tier
  const tierThresholds = useMemo(() => {
    const t: number[] = Array(MAX_TIER + 1).fill(0) as number[];
    for (const item of tierItems) {
      if (item.yPosition >= 1 && item.yPosition <= MAX_TIER) {
        const cur = t[item.yPosition] ?? 0;
        t[item.yPosition] = Math.min(cur === 0 ? 999 : cur, item.minSpent);
      }
    }
    return t.map(v => v === 999 ? 0 : v);
  }, [tierItems]);

  const bgImage = `/assets/images/UIImages/${tree.background}.png`;

  return (
    <div className={styles.treePanel}>
      <div className={styles.background} style={{ backgroundImage: `url('${bgImage}')` }} />

      <div className={styles.header}>
        <img
          src={iconUrl(tree.icon, 'Class')}
          alt=""
          className={styles.headerIcon}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <span className={styles.treeName}>{tree.name}</span>
        <span className={styles.apCount}>{treeAP} AP</span>
      </div>

      <div className={styles.tierGridWrapper}>
        <DependencyArrows rows={rows} />
        <div className={styles.tierGrid}>
          {rows.map((row, rowIdx) => {
            const yPos      = MAX_TIER - rowIdx;
            const threshold = tierThresholds[yPos] ?? 0;
            // "Unlocked" means the tier-AP-spent prerequisite is met. Pool
            // exhaustion is checked separately (canSpend in the cell), so
            // already-purchased enhancements stay at full brightness when
            // the cap is reached.
            const unlocked  = treeAP >= threshold;
            return (
              <div key={yPos} className={styles.tierRow}>
                {row.map((item, col) => (
                  <EnhancementCell
                    key={col}
                    item={item}
                    ranks={item ? ranksFor(item.internalName) : 0}
                    unlocked={unlocked}
                    totalAPLeft={remaining}
                    onSpend={() => item && trySpend(item)}
                    onRevoke={() => item && revoke(tree.name, item.internalName)}
                    core={false}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.coreOverlay}>
        <div className={styles.coreRow}>
          {coreRow.map((item, col) => (
            <EnhancementCell
              key={col}
              item={item}
              ranks={item ? ranksFor(item.internalName) : 0}
              unlocked={item ? treeAP >= item.minSpent : false}
              totalAPLeft={remaining}
              onSpend={() => item && trySpend(item)}
              onRevoke={() => item && revoke(tree.name, item.internalName)}
              core={true}
            />
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <button
          className={styles.resetBtn}
          onClick={() => resetFn(tree.name)}
          disabled={treeAP === 0}
          title="Reset this tree"
        >
          Reset
        </button>
      </div>

      <SelectionPickerDialog
        open={selectorPicker !== null}
        title={selectorPicker?.name ?? ''}
        selections={selectorPicker?.selector ?? []}
        current={selectorPicker ? selectionFor(selectorPicker.internalName) : undefined}
        onClose={() => setSelectorPicker(null)}
        onPick={(name) => {
          if (!selectorPicker) return;
          spend(tree.name, selectorPicker.internalName, selectorPicker.ranks, name);
          setSelectorPicker(null);
        }}
      />
    </div>
  );
}

// ── Dependency arrows (SVG overlay) ──────────────────────────────────────────
// Arrows are stored on the SOURCE/prerequisite item. They point toward the
// item that REQUIRES this one. Arrow directions match the visual layout:
//   ArrowUp / LongArrowUp / ExtraLongArrowUp → toward a higher-tier item
//     (higher YPosition = higher on screen = lower rowIndex)
//   ArrowRight → toward col+1, same row
//   ArrowLeft  → toward col-1, same row

const CELL_SIZE = 46;   // approximate cell width/height in px
const COL_GAP   = 3;    // horizontal gap between cells (within a row)
const ROW_GAP   = 8;    // vertical gap between tier rows — keep in sync
                        // with .tierGrid `gap` in EnhancementTreeGrid.module.css
const COL_STEP  = CELL_SIZE + COL_GAP;
const ROW_STEP  = CELL_SIZE + ROW_GAP;
const GRID_PAD  = 4;    // tierGrid padding

function cellCenterX(col: number): number {
  return GRID_PAD + col * COL_STEP + CELL_SIZE / 2;
}
function cellCenterY(rowIndex: number): number {
  return rowIndex * ROW_STEP + CELL_SIZE / 2;
}

interface ArrowDef {
  x1: number; y1: number;
  x2: number; y2: number;
}

function DependencyArrows({ rows }: { rows: (EnhancementItemData | null)[][] }) {
  const totalRows = rows.length;
  const svgH = totalRows * ROW_STEP;
  const svgW = COLS * COL_STEP + GRID_PAD * 2;

  const arrows = useMemo<ArrowDef[]>(() => {
    const result: ArrowDef[] = [];
    rows.forEach((row, rowIdx) => {
      row.forEach((item, col) => {
        if (!item) return;
        const cx = cellCenterX(col);
        const cy = cellCenterY(rowIdx);

        if (item.arrowUp && rowIdx > 0) {
          result.push({ x1: cx, y1: cy - CELL_SIZE / 2, x2: cx, y2: cellCenterY(rowIdx - 1) + CELL_SIZE / 2 });
        }
        if (item.longArrowUp && rowIdx > 1) {
          result.push({ x1: cx, y1: cy - CELL_SIZE / 2, x2: cx, y2: cellCenterY(rowIdx - 2) + CELL_SIZE / 2 });
        }
        if (item.extraLongArrowUp && rowIdx > 2) {
          result.push({ x1: cx, y1: cy - CELL_SIZE / 2, x2: cx, y2: cellCenterY(rowIdx - 3) + CELL_SIZE / 2 });
        }
        if (item.arrowRight && col < COLS - 1) {
          result.push({ x1: cx + CELL_SIZE / 2, y1: cy, x2: cellCenterX(col + 1) - CELL_SIZE / 2, y2: cy });
        }
        if (item.arrowLeft && col > 0) {
          result.push({ x1: cx - CELL_SIZE / 2, y1: cy, x2: cellCenterX(col - 1) + CELL_SIZE / 2, y2: cy });
        }
      });
    });
    return result;
  }, [rows]);

  if (arrows.length === 0) return null;

  return (
    <svg
      className={styles.arrowSvg}
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="5"
          refX="3"
          refY="2.5"
          orient="auto"
        >
          <polygon points="0 0, 6 2.5, 0 5" fill="rgba(201,162,39,0.8)" />
        </marker>
      </defs>
      {arrows.map((a, i) => (
        <line
          key={i}
          x1={a.x1} y1={a.y1}
          x2={a.x2} y2={a.y2}
          stroke="rgba(201,162,39,0.55)"
          strokeWidth="1.5"
          markerEnd="url(#arrowhead)"
        />
      ))}
    </svg>
  );
}

// ── Cell ──────────────────────────────────────────────────────────────────────

interface CellProps {
  item: EnhancementItemData | null;
  ranks: number;
  unlocked: boolean;
  totalAPLeft: number;
  onSpend: () => void;
  onRevoke: () => void;
  core: boolean;
}

// Show-delay before the tooltip appears, in ms. Lower = snappier feel,
// higher = fewer accidental flashes when sweeping the cursor across.
const TOOLTIP_DELAY_MS = 150;

function EnhancementCell({ item, ranks, unlocked, totalAPLeft, onSpend, onRevoke, core }: CellProps) {
  // Always-called hooks (must be at top level — early-returning a `null` cell
  // before the hooks would violate React's rules-of-hooks).
  const cellRef = useRef<HTMLDivElement>(null);
  const [showTip, setShowTip] = useState(false);
  const [tipPos, setTipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const showTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
  }, []);

  if (!item) return <div className={core ? styles.emptyCoreCell : styles.emptyCell} />;

  const purchased = ranks > 0;
  const maxed     = ranks >= item.ranks;
  const canSpend  = !maxed && unlocked && totalAPLeft > 0;
  const iconName  = (item.selector && item.selector.length > 0)
    ? (item.selector[0]?.icon ?? item.icon)
    : item.icon;

  // Class layering rule: `.locked` applies a heavy dim filter that visually
  // overrides `.purchased`'s blue outline. Don't apply it when the cell is
  // purchased — once you've paid for an enhancement, it stays lit even if
  // the next-tier prereq isn't met or the AP cap is reached.
  const cellClass = [
    core ? styles.coreCell : styles.cell,
    purchased ? styles.purchased : '',
    (!purchased && !unlocked) ? styles.locked : '',
    !purchased && unlocked ? styles.untaken : '',   // grayscale until taken
    canSpend ? styles.available : '',
  ].filter(Boolean).join(' ');

  function handleEnter() {
    if (!cellRef.current) return;
    const rect = cellRef.current.getBoundingClientRect();
    setTipPos({ top: rect.top, left: rect.left + rect.width / 2 });
    showTimer.current = window.setTimeout(() => setShowTip(true), TOOLTIP_DELAY_MS);
  }
  function handleLeave() {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setShowTip(false);
  }

  return (
    <div
      ref={cellRef}
      className={cellClass}
      onClick={canSpend ? onSpend : undefined}
      onContextMenu={e => { e.preventDefault(); if (purchased) onRevoke(); }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <img
        src={iconUrl(iconName, 'Enhancement')}
        alt={item.name}
        className={core ? styles.coreIcon : styles.icon}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
      {purchased && (
        <span className={styles.rankBadge}>{ranks}/{item.ranks}</span>
      )}
      {showTip && createPortal(
        <div
          className={styles.tooltip}
          role="tooltip"
          style={{
            // Position the tooltip's bottom-center 4px above the cell's top-center.
            // The CSS class applies the centering transform.
            top: tipPos.top - 4,
            left: tipPos.left,
          }}
        >
          <div className={styles.tooltipName}>{item.name}</div>
          <div className={styles.tooltipRank}>
            Rank {ranks}/{item.ranks}
            {item.ranks > 1 && item.minSpent > 0 && ` · ${item.minSpent} AP min`}
          </div>
          {item.description && (
            <div className={styles.tooltipDesc}>{item.description}</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
