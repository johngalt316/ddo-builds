import { useEffect, useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import type { DDOFiligreeData } from '@/types/ddoData';
import { formatRareBonus } from '@/utils/formatBuff';
import styles from './AugmentPickerDialog.module.css';

interface Props {
  open: boolean;
  /** Which slot table the picker is editing — sentient-weapon or artifact. */
  target: 'weapon' | 'artifact' | null;
  /** Index into the slot list for the picked target. */
  slotIdx: number | null;
  onClose: () => void;
}

export function FiligreePickerDialog({ open, target, slotIdx, onClose }: Props) {
  const filigrees   = useGameDataStore(s => s.filigrees);
  const setFiligree = useBuildStore(s => s.setFiligree);
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) { setQuery(''); setSetFilter(''); }
  }, [open]);

  const lowQuery = query.trim().toLowerCase();
  const candidates = useMemo(() => {
    let pool = filigrees;
    if (setFilter) pool = pool.filter(f => f.setBonus === setFilter);
    if (lowQuery) {
      pool = pool.filter(f =>
        f.name.toLowerCase().includes(lowQuery) ||
        f.description.toLowerCase().includes(lowQuery) ||
        f.setBonus.toLowerCase().includes(lowQuery));
    }
    return [...pool].sort((a, b) =>
      a.setBonus.localeCompare(b.setBonus) || a.name.localeCompare(b.name));
  }, [filigrees, setFilter, lowQuery]);

  const allSets = useMemo(() => {
    const s = new Set<string>();
    for (const f of filigrees) if (f.setBonus) s.add(f.setBonus);
    return [...s].sort();
  }, [filigrees]);

  if (!open || target === null || slotIdx === null) return null;

  function pick(f: DDOFiligreeData) {
    setFiligree(target!, slotIdx!, f.name);
    onClose();
  }
  function clear() {
    setFiligree(target!, slotIdx!, null);
    onClose();
  }

  const targetLabel = target === 'weapon' ? 'sentient-weapon' : 'artifact';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Pick filigree for ${targetLabel} slot ${slotIdx + 1}`}>
        <div className={styles.header}>
          <h3>{targetLabel} filigree · slot {slotIdx + 1}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.controls}>
          <input
            type="search"
            className={styles.search}
            placeholder={`Search ${candidates.length}…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <select
            className={styles.search}
            style={{ flex: '0 0 11rem' }}
            value={setFilter}
            onChange={e => setSetFilter(e.target.value)}
            title="Filter by set"
          >
            <option value="">All sets</option>
            {allSets.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={styles.clearBtn} onClick={clear} title="Empty this slot">Clear</button>
        </div>

        <div className={styles.list}>
          {candidates.length === 0 && (
            <div className={styles.empty}>
              {filigrees.length === 0
                ? 'Filigree data is still loading…'
                : 'No filigrees match.'}
            </div>
          )}
          {candidates.map(f => {
            const rareBonus = formatRareBonus(f.effects);
            return (
              <button
                key={f.name}
                className={styles.augRow}
                onClick={() => pick(f)}
                title={f.description}
              >
                <div className={styles.augBody}>
                  <div className={styles.augName}>{f.name}</div>
                  <div className={styles.augMeta}>
                    <span>{f.setBonus}</span>
                  </div>
                  {rareBonus && (
                    <div className={styles.augDesc}>
                      <span className={styles.augTier}>Rare:</span> {rareBonus}
                    </div>
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
