// Phase 6.2 — "Active spells" palette: the curated, priority-ordered
// subset the user wants in their rotation.
//
// • Click a tile to append it to the timeline.
// • Drag a tile within the palette to change its priority order — the
//   first tile is `#1`, the optimizer / "Auto" rotation will lean on
//   that order in 6.6.
// • The Manage button opens the full trained-spell picker.
//
// Trained (Spells tab) → Active (this palette) → Rotation (timeline).

import { useRef, useState } from 'react';
import type { MagicAbility } from '@/engine/dps/abilities';
import styles from './RotationPalette.module.css';

interface Props {
  /** Curated, priority-ordered set the user has marked as Active. */
  abilities: MagicAbility[];
  /** Total trained damaging spells — used in the empty-state hint. */
  totalTrained: number;
  onAdd: (ability: MagicAbility) => void;
  onManage: () => void;
  /** Reorder priority. From/to are indices within `abilities`. */
  onReorder: (fromIdx: number, toIdx: number) => void;
}

export function RotationPalette({ abilities, totalTrained, onAdd, onManage, onReorder }: Props) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, idx: number) {
    dragFrom.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== idx) setDragOver(idx);
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === idx) return;
    onReorder(from, idx);
  }
  function handleDragEnd() {
    dragFrom.current = null;
    setDragOver(null);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>
          Active · {abilities.length} spell{abilities.length === 1 ? '' : 's'}
          {abilities.length > 1 && (
            <span className={styles.priorityHint}> · drag to reorder priority</span>
          )}
        </span>
        <button
          type="button"
          className={styles.manageBtn}
          onClick={onManage}
          title="Pick which trained spells are available in your rotation"
        >
          + Manage
        </button>
      </div>

      {abilities.length === 0 ? (
        <div className={styles.empty}>
          {totalTrained === 0 ? (
            <>No damaging spells trained. Open the <strong>Spells</strong> tab to train spells with damage rolls.</>
          ) : (
            <>You have <strong>{totalTrained}</strong> trained damaging spells. Click <strong>Manage</strong> to pick which ones are active in your rotation.</>
          )}
        </div>
      ) : (
        <div className={styles.palette} role="list" aria-label="Active spells">
          {abilities.map((a, i) => (
            <div
              key={a.id}
              role="listitem"
              draggable
              onDragStart={e => handleDragStart(e, i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={e => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
              onClick={() => onAdd(a)}
              className={[
                styles.tile,
                dragOver === i ? styles.tileDragOver : '',
              ].filter(Boolean).join(' ')}
              title={[
                a.displayName,
                a.source === 'spell'
                  ? `L${a.spellLevel} ${a.school}`
                  : `SLA · ${a.school}${a.slaSource ? `\n${a.slaSource}` : ''}`,
                `${a.cost} SP${a.cooldown ? ` · ${a.cooldown}s CD` : ''}`,
                'Click to add to rotation · drag to reorder priority',
              ].join('\n')}
            >
              <span className={styles.priorityBadge}>#{i + 1}</span>
              {a.icon && (
                <img
                  src={`/assets/images/SpellImages/${a.icon}.png`}
                  alt=""
                  className={styles.tileIcon}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <span className={styles.tileName}>{a.displayName}</span>
              <span className={styles.tileMeta}>
                {a.source === 'spell'
                  ? <span className={styles.tileLevel}>L{a.spellLevel}</span>
                  : <span className={styles.tileSla} title="Spell-like ability">SLA</span>}
                <span className={styles.tileCost}>{a.cost} SP</span>
                {a.cooldown > 0 && <span className={styles.tileCd}>{a.cooldown}s</span>}
                {a.charges > 0 && (
                  <span className={styles.tileCharges} title={`${a.charges} charges per rest`}>
                    {a.charges}×
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
