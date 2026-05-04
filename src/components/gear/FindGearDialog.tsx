import { useEffect, useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { loadAllItems, itemRecordToGearItem, type ItemRecord } from '@/utils/itemCatalog';
import type { GearSlot } from '@/types/build';
import styles from './FindGearDialog.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-select the slot filter (using the canonical item-slot tag, e.g. "Helmet"
   *  or "Weapon1"). Pass `undefined` for "Any". */
  initialSlot?: string;
}

const RESULT_LIMIT = 200;

// Slot tags as they appear on items (canonical) → user-facing label and
// the build-side GearSlot we equip to. Items list multiple slots (e.g. a
// dagger has Weapon1+Weapon2); we equip into the first.
const SLOT_LABELS: Record<string, string> = {
  Helmet: 'Helmet', Goggles: 'Goggles', Necklace: 'Necklace',
  Trinket: 'Trinket', Cloak: 'Cloak', Belt: 'Belt', Bracers: 'Bracers',
  Gloves: 'Gloves', Boots: 'Boots', Armor: 'Armor',
  Weapon1: 'Main Hand', Weapon2: 'Off Hand',
  Quiver: 'Quiver', Ring: 'Ring',
};

/**
 * Map a canonical item slot tag → the build-side GearSlot to equip to.
 * For two-slot weapons / rings the user clicks an item — we pick the
 * primary slot. They can move it to the other slot via the regular
 * ItemPickerDialog if needed.
 */
function primaryGearSlot(slots: string[]): GearSlot | null {
  if (slots.includes('Weapon1')) return 'MainHand';
  if (slots.includes('Weapon2')) return 'OffHand';
  if (slots.includes('Ring')) return 'Ring1';
  const s = slots[0];
  if (!s) return null;
  if (s === 'Helmet' || s === 'Goggles' || s === 'Necklace' || s === 'Trinket'
   || s === 'Cloak'  || s === 'Belt'    || s === 'Bracers'  || s === 'Gloves'
   || s === 'Boots'  || s === 'Armor'   || s === 'Quiver'   || s === 'Arrow') {
    return s as GearSlot;
  }
  return null;
}

/**
 * Match the item's buffs against a free-text query. Each whitespace-separated
 * word must appear in at least one buff's fields. So "Insightful Constitution"
 * matches items where one buff has bonusType=Insightful AND another (or the
 * same) has item=Constitution.
 */
function itemMatchesBuffQuery(item: ItemRecord, words: string[]): boolean {
  if (words.length === 0) return true;
  const buffs = item.buffs ?? [];
  if (buffs.length === 0) return false;
  const buffStrings = buffs.flatMap(b =>
    [b.type, b.bonusType, b.item, b.description]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .map(s => s.toLowerCase()),
  );
  return words.every(w => buffStrings.some(s => s.includes(w)));
}

export function FindGearDialog({ open, onClose, initialSlot }: Props) {
  const equipItem = useBuildStore(s => s.equipItem);

  const [records, setRecords] = useState<ItemRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText]       = useState('');
  const [buff, setBuff]       = useState('');
  const [slot, setSlot]       = useState<string>('any');
  const [minLevel, setMinLevel] = useState<number | ''>('');
  const [maxLevel, setMaxLevel] = useState<number | ''>('');

  useEffect(() => {
    if (!open) return;
    if (records) return;   // already loaded
    setLoading(true);
    let cancelled = false;
    loadAllItems().then(items => {
      if (cancelled) return;
      setRecords(items);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, records]);

  // Reset filters and apply the caller's initial slot whenever the dialog
  // re-opens (so successive double-clicks on different slots don't carry
  // stale state from a previous open).
  useEffect(() => {
    if (!open) return;
    setText('');
    setBuff('');
    setMinLevel('');
    setMaxLevel('');
    setSlot(initialSlot ?? 'any');
  }, [open, initialSlot]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const lowText = text.trim().toLowerCase();
  const buffWords = buff.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const results = useMemo(() => {
    if (!records) return [];
    const min = typeof minLevel === 'number' ? minLevel : -Infinity;
    const max = typeof maxLevel === 'number' ? maxLevel : Infinity;
    const matches = records.filter(item => {
      if (slot !== 'any' && !item.slots.includes(slot)) return false;
      const lvl = item.minLevel ?? 0;
      if (lvl < min || lvl > max) return false;
      if (lowText) {
        const match = item.name.toLowerCase().includes(lowText)
                   || item.dropLocation?.toLowerCase().includes(lowText)
                   || item.setBonus?.toLowerCase().includes(lowText)
                   || item.description?.toLowerCase().includes(lowText);
        if (!match) return false;
      }
      if (!itemMatchesBuffQuery(item, buffWords)) return false;
      return true;
    });
    return [...matches]
      .sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0))
      .slice(0, RESULT_LIMIT);
  }, [records, slot, lowText, buffWords, minLevel, maxLevel]);

  if (!open) return null;

  function handlePick(item: ItemRecord) {
    const target = primaryGearSlot(item.slots);
    if (!target) return;
    equipItem(target, itemRecordToGearItem(item, target));
    onClose();
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-label="Find gear">
        <div className={styles.header}>
          <h3>Find Gear</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.filters}>
          <input
            type="search"
            className={styles.search}
            placeholder={loading
              ? 'Loading items…'
              : records ? `Search ${records.length} items by name, set, drop…` : 'Loading…'}
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
            disabled={loading}
          />
          <input
            type="search"
            className={styles.search}
            placeholder={`Buff filter (e.g. "Insightful Constitution", "Doublestrike")`}
            value={buff}
            onChange={e => setBuff(e.target.value)}
            disabled={loading}
          />
          <div className={styles.filterRow}>
            <label className={styles.filterLabel}>
              Slot
              <select
                className={styles.select}
                value={slot}
                onChange={e => setSlot(e.target.value)}
                disabled={loading}
              >
                <option value="any">Any</option>
                {Object.entries(SLOT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className={styles.filterLabel}>
              Min Lv
              <input
                type="number"
                className={styles.numInput}
                value={minLevel}
                onChange={e => setMinLevel(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={loading}
              />
            </label>
            <label className={styles.filterLabel}>
              Max Lv
              <input
                type="number"
                className={styles.numInput}
                value={maxLevel}
                onChange={e => setMaxLevel(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={loading}
              />
            </label>
          </div>
        </div>

        <div className={styles.results}>
          {loading && <div className={styles.empty}>Loading {/* roughly */} 8,000+ items…</div>}
          {!loading && records && results.length === 0 && (
            <div className={styles.empty}>
              {lowText || buffWords.length || slot !== 'any' || minLevel !== '' || maxLevel !== ''
                ? 'No items match these filters.'
                : 'Type a name or buff to search.'}
            </div>
          )}
          {results.map(item => {
            const matchSlots = item.slots.map(s => SLOT_LABELS[s] ?? s).join(' / ');
            return (
              <button
                key={item.name}
                className={styles.itemRow}
                onClick={() => handlePick(item)}
                title={item.description ?? item.name}
              >
                <img
                  src={`/assets/images/ItemImages/${item.icon}.png`}
                  alt=""
                  className={styles.itemIcon}
                  onError={e => { e.currentTarget.src = '/assets/images/ItemImages/NoImage.png'; }}
                />
                <div className={styles.itemBody}>
                  <div className={styles.itemNameRow}>
                    <span className={styles.itemName}>{item.name}</span>
                    <span className={styles.itemSlotTag}>{matchSlots}</span>
                  </div>
                  <div className={styles.itemMeta}>
                    {item.minLevel !== undefined && <span>Lv {item.minLevel}</span>}
                    {item.material && <span>{item.material}</span>}
                    {item.setBonus && <span className={styles.itemSet}>{item.setBonus}</span>}
                    {(item.buffs?.length ?? 0) > 0 && (
                      <span className={styles.itemBuffCount}>
                        {item.buffs!.length} buff{item.buffs!.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {!loading && records && results.length === RESULT_LIMIT && (
            <div className={styles.resultsTrunc}>
              Showing top {RESULT_LIMIT} matches — refine your filters to see more.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
