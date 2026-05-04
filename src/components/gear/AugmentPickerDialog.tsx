import { useEffect, useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import type { GearSlot } from '@/types/build';
import type { DDOAugmentData } from '@/types/ddoData';
import styles from './AugmentPickerDialog.module.css';

interface Props {
  open: boolean;
  itemSlot: GearSlot | null;
  /** Index into the item's `augmentSlots` array. */
  augmentSlotIdx: number | null;
  /** The slot's color/type for filtering compatible augments (e.g. "Green"). */
  slotType: string | null;
  /** Item min level — used to suggest a starting tier for scaling augments. */
  itemMinLevel?: number;
  onClose: () => void;
}

export function AugmentPickerDialog({
  open, itemSlot, augmentSlotIdx, slotType, itemMinLevel, onClose,
}: Props) {
  const augments     = useGameDataStore(s => s.augments);
  const setItemAugment = useBuildStore(s => s.setItemAugment);
  const [query, setQuery] = useState('');

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => { if (open) setQuery(''); }, [open, slotType]);

  // Filter to augments whose `slotTypes` contains this slot's color, then
  // optional text filter.
  const lowQuery = query.trim().toLowerCase();
  const candidates = useMemo(() => {
    if (!slotType) return [];
    const compatible = augments.filter(a => a.slotTypes.includes(slotType));
    const filtered = lowQuery
      ? compatible.filter(a =>
          a.name.toLowerCase().includes(lowQuery) ||
          a.description.toLowerCase().includes(lowQuery))
      : compatible;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [augments, slotType, lowQuery]);

  if (!open || itemSlot === null || augmentSlotIdx === null || !slotType) return null;

  /**
   * Pick the largest level-tier index whose `levels[i]` is ≤ itemMinLevel.
   * That gives the augment its highest valid power for this item.
   */
  function defaultLevelIndex(aug: DDOAugmentData): number | undefined {
    if (!aug.scalesWithLevel) return undefined;
    if (aug.levels.length === 0) return undefined;
    const minL = itemMinLevel ?? 0;
    let best = 0;
    for (let i = 0; i < aug.levels.length; i++) {
      if ((aug.levels[i] ?? 99) <= minL) best = i;
    }
    return best;
  }

  function pick(aug: DDOAugmentData) {
    setItemAugment(itemSlot!, augmentSlotIdx!, aug.name, defaultLevelIndex(aug));
    onClose();
  }
  function clear() {
    setItemAugment(itemSlot!, augmentSlotIdx!, null);
    onClose();
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Pick augment for ${slotType} slot`}>
        <div className={styles.header}>
          <h3>{slotType} augment</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.controls}>
          <input
            type="search"
            className={styles.search}
            placeholder={candidates.length > 0 ? `Search ${candidates.length}…` : 'No augments fit this slot'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <button className={styles.clearBtn} onClick={clear} title="Remove augment from this slot">
            Clear
          </button>
        </div>

        <div className={styles.list}>
          {candidates.length === 0 && (
            <div className={styles.empty}>
              {augments.length === 0
                ? 'Augment data is still loading…'
                : `No augments fit a "${slotType}" slot.`}
            </div>
          )}
          {candidates.map(aug => {
            const lvlIdx = defaultLevelIndex(aug);
            const tierValue = lvlIdx !== undefined ? aug.levelValues[lvlIdx] : undefined;
            return (
              <button
                key={aug.name}
                className={styles.augRow}
                onClick={() => pick(aug)}
                title={aug.description}
              >
                <div className={styles.augBody}>
                  <div className={styles.augName}>{aug.name}</div>
                  <div className={styles.augMeta}>
                    {aug.slotTypes.join(' · ')}
                    {aug.scalesWithLevel && tierValue !== undefined && (
                      <span className={styles.augTier}>tier {lvlIdx! + 1} = {tierValue}</span>
                    )}
                  </div>
                  {aug.description && (
                    <div className={styles.augDesc}>{aug.description.slice(0, 160)}{aug.description.length > 160 ? '…' : ''}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
