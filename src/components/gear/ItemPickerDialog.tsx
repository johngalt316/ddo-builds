import { useEffect, useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { loadItemsForSlot, itemRecordToGearItem, type ItemRecord } from '@/utils/itemCatalog';
import { formatBuff, formatBuffsAsTitle } from '@/utils/formatBuff';
import type { GearBuff, GearSlot } from '@/types/build';
import styles from './ItemPickerDialog.module.css';

interface Props {
  open: boolean;
  slot: GearSlot | null;
  onClose: () => void;
  /** Called after the user picks an item, so callers can surface details. */
  onItemEquipped?: (slot: GearSlot) => void;
}

const RESULT_LIMIT = 200;

/**
 * Slot-filtered item picker. Loads `/data/items/by-slot/<slot>.json` on
 * first open (cached), text-filters by name + drop location, displays the
 * top RESULT_LIMIT matches sorted by minLevel desc (highest-level items
 * appear first since builds tend to be end-game).
 *
 * Out of scope (Phase 4 follow-ups):
 *   - Augment slot editing
 *   - Effect-type filter ("show me everything with Insightful CON")
 *   - Virtualized long-list (current cap is RESULT_LIMIT — sufficient with
 *     filtering, but a virtualized list would let us drop the cap).
 */
export function ItemPickerDialog({ open, slot, onClose, onItemEquipped }: Props) {
  const equipItem   = useBuildStore(s => s.equipItem);
  const unequipItem = useBuildStore(s => s.unequipItem);
  // Subscribe to the slices we need separately so each selector returns a
  // stable reference. (A combined selector returning `set?.items ?? []`
  // creates a fresh array on every render when no active set exists,
  // triggering an infinite re-render loop.)
  const gearSets       = useBuildStore(s => s.build.gearSets);
  const activeGearSet  = useBuildStore(s => s.build.activeGearSet);
  const activeSetItems = useMemo(
    () => gearSets.find(g => g.name === activeGearSet)?.items ?? [],
    [gearSets, activeGearSet],
  );

  const [records, setRecords] = useState<ItemRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery]     = useState('');

  // Reset state and load shard whenever the dialog opens for a new slot.
  useEffect(() => {
    if (!open || !slot) return;
    setQuery('');
    setLoading(true);
    let cancelled = false;
    loadItemsForSlot(slot).then(items => {
      if (cancelled) return;
      setRecords(items);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, slot]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const lowQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!records) return [];
    const matches = lowQuery
      ? records.filter(r =>
          r.name.toLowerCase().includes(lowQuery) ||
          r.dropLocation?.toLowerCase().includes(lowQuery) ||
          r.setBonus?.toLowerCase().includes(lowQuery))
      : records;
    return [...matches]
      .sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0))
      .slice(0, RESULT_LIMIT);
  }, [records, lowQuery]);

  if (!open || !slot) return null;

  const currentlyEquipped = activeSetItems.find(it => it.slot === slot);

  function handlePick(record: ItemRecord) {
    if (!slot) return;
    equipItem(slot, itemRecordToGearItem(record, slot));
    onItemEquipped?.(slot);
    onClose();
  }

  function handleUnequip() {
    if (!slot) return;
    unequipItem(slot);
    onClose();
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Pick item for ${slot}`}>
        <div className={styles.header}>
          <h3>Equip {slot}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {currentlyEquipped && (
          <div className={styles.currentBar}>
            <span className={styles.currentLabel}>Currently equipped:</span>
            <span className={styles.currentName}>{currentlyEquipped.name}</span>
            <button
              className={styles.unequipBtn}
              onClick={handleUnequip}
              title="Remove this item"
            >Unequip</button>
          </div>
        )}

        <input
          type="search"
          className={styles.search}
          placeholder={loading
            ? 'Loading items…'
            : records ? `Search ${records.length} items…` : 'Search…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          disabled={loading}
        />

        <div className={styles.results}>
          {loading && <div className={styles.empty}>Loading…</div>}
          {!loading && records?.length === 0 && (
            <div className={styles.empty}>No items found for {slot}.</div>
          )}
          {!loading && records && filtered.length === 0 && lowQuery && (
            <div className={styles.empty}>No items match "{query}".</div>
          )}
          {filtered.map(item => {
            const buffs = (item.buffs ?? []) as GearBuff[];
            const fullBuffList = formatBuffsAsTitle(buffs);
            const titleParts = [
              item.description,
              fullBuffList ? `\nEffects:\n${fullBuffList}` : '',
            ].filter(Boolean);
            return (
              <button
                key={item.name}
                className={styles.itemRow}
                onClick={() => handlePick(item)}
                title={titleParts.join('\n') || item.name}
              >
                <img
                  src={`/assets/images/ItemImages/${item.icon}.png`}
                  alt=""
                  className={styles.itemIcon}
                  onError={e => { e.currentTarget.src = '/assets/images/ItemImages/NoImage.png'; }}
                />
                <div className={styles.itemBody}>
                  <div className={styles.itemName}>{item.name}</div>
                  <div className={styles.itemMeta}>
                    {item.minLevel !== undefined && <span>Lv {item.minLevel}</span>}
                    {item.material && <span>{item.material}</span>}
                    {item.setBonus && <span className={styles.itemSet}>{item.setBonus}</span>}
                  </div>
                  {buffs.length > 0 && (
                    <div className={styles.itemBuffs}>
                      {buffs.slice(0, 4).map((b, i) => (
                        <span key={i} className={styles.itemBuff}>{formatBuff(b)}</span>
                      ))}
                      {buffs.length > 4 && (
                        <span className={styles.itemBuffMore}>+{buffs.length - 4} more</span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          {!loading && records && records.length > 0 && filtered.length === RESULT_LIMIT && (
            <div className={styles.resultsTrunc}>
              Showing top {RESULT_LIMIT} matches — refine search to see more.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
