import { useMemo } from 'react';
import type { EnhancementTreeData, EnhancementItemData } from '@/types/ddoData';
import {
  useBuildStore,
  apSpentInTree,
  apSpent,
  MAX_HEROIC_AP,
  MAX_DESTINY_AP,
} from '@/store/buildStore';
import { iconUrl } from '@/utils/ddoXmlParser';
import styles from './EnhancementTreeGrid.module.css';

const COLS    = 6;
const MAX_TIER = 5;

interface Props {
  tree: EnhancementTreeData;
  /** When true, reads/writes destinyEnhancements instead of enhancements */
  destinyMode?: boolean;
}

export function EnhancementTreeGrid({ tree, destinyMode = false }: Props) {
  const build = useBuildStore(s => s.build);

  const spendHeroic   = useBuildStore(s => s.spendEnhancement);
  const revokeHeroic  = useBuildStore(s => s.revokeEnhancement);
  const resetHeroic   = useBuildStore(s => s.resetTree);
  const spendDestiny  = useBuildStore(s => s.spendDestinyEnhancement);
  const revokeDestiny = useBuildStore(s => s.revokeDestinyEnhancement);
  const resetDestiny  = useBuildStore(s => s.resetDestinyTree);

  const spend     = destinyMode ? spendDestiny  : spendHeroic;
  const revoke    = destinyMode ? revokeDestiny : revokeHeroic;
  const resetFn   = destinyMode ? resetDestiny  : resetHeroic;

  const pool        = destinyMode ? build.destinyEnhancements : build.enhancements;
  const treeAP      = apSpentInTree(tree.name, pool);
  const totalAP     = apSpent(pool);
  const cap         = destinyMode ? MAX_DESTINY_AP : MAX_HEROIC_AP;
  const remaining   = cap - totalAP;

  const treeEntry = pool.find(e => e.treeId === tree.name);
  function ranksFor(internalName: string): number {
    return treeEntry?.enhancements.find(e => e.enhancementId === internalName)?.rank ?? 0;
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
            const unlocked  = treeAP >= threshold && remaining > 0;
            return (
              <div key={yPos} className={styles.tierRow}>
                {row.map((item, col) => (
                  <EnhancementCell
                    key={col}
                    item={item}
                    ranks={item ? ranksFor(item.internalName) : 0}
                    unlocked={unlocked}
                    totalAPLeft={remaining}
                    onSpend={() => item && spend(tree.name, item.internalName, item.ranks)}
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
              unlocked={item ? treeAP >= item.minSpent && remaining > 0 : false}
              totalAPLeft={remaining}
              onSpend={() => item && spend(tree.name, item.internalName, item.ranks)}
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
const CELL_GAP  = 3;    // gap between cells
const CELL_STEP = CELL_SIZE + CELL_GAP;
const GRID_PAD  = 4;    // tierGrid padding

function cellCenterX(col: number): number {
  return GRID_PAD + col * CELL_STEP + CELL_SIZE / 2;
}
function cellCenterY(rowIndex: number): number {
  return rowIndex * CELL_STEP + CELL_SIZE / 2;
}

interface ArrowDef {
  x1: number; y1: number;
  x2: number; y2: number;
}

function DependencyArrows({ rows }: { rows: (EnhancementItemData | null)[][] }) {
  const totalRows = rows.length;
  const svgH = totalRows * CELL_STEP;
  const svgW = COLS * CELL_STEP + GRID_PAD * 2;

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

function EnhancementCell({ item, ranks, unlocked, totalAPLeft, onSpend, onRevoke, core }: CellProps) {
  if (!item) return <div className={core ? styles.emptyCoreCell : styles.emptyCell} />;

  const purchased = ranks > 0;
  const maxed     = ranks >= item.ranks;
  const canSpend  = !maxed && unlocked && totalAPLeft > 0;
  const iconName  = (item.selector && item.selector.length > 0)
    ? (item.selector[0]?.icon ?? item.icon)
    : item.icon;

  const cellClass = [
    core ? styles.coreCell : styles.cell,
    purchased ? styles.purchased : '',
    !unlocked ? styles.locked : '',
    canSpend ? styles.available : '',
  ].filter(Boolean).join(' ');

  const tooltip = [
    item.name,
    item.ranks > 1 ? `Rank ${ranks}/${item.ranks}` : '',
    item.description.slice(0, 150),
  ].filter(Boolean).join('\n');

  return (
    <div
      className={cellClass}
      title={tooltip}
      onClick={canSpend ? onSpend : undefined}
      onContextMenu={e => { e.preventDefault(); if (purchased) onRevoke(); }}
    >
      <img
        src={iconUrl(iconName, 'Enhancement')}
        alt={item.name}
        className={core ? styles.coreIcon : styles.icon}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
      {item.ranks > 1 && ranks > 0 && (
        <span className={styles.rankBadge}>{ranks}/{item.ranks}</span>
      )}
      {purchased && <div className={styles.purchasedOverlay} />}
    </div>
  );
}
