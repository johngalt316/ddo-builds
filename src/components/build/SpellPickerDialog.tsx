import { useEffect, useMemo, useState } from 'react';
import type { DDOSpellData } from '@/types/ddoData';
import styles from './SpellPickerDialog.module.css';

interface Props {
  open: boolean;
  /** The spell level the slot corresponds to (1-9). */
  spellLevel: number | null;
  /** Pre-filtered list of spells that can be trained into this slot. */
  availableSpells: { name: string; data?: DDOSpellData }[];
  onClose: () => void;
  onPick: (spellName: string) => void;
}

export function SpellPickerDialog({ open, spellLevel, availableSpells, onClose, onPick }: Props) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => { if (open) setQuery(''); }, [open]);

  const lowQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = lowQuery
      ? availableSpells.filter(s =>
          s.name.toLowerCase().includes(lowQuery) ||
          s.data?.school.toLowerCase().includes(lowQuery) ||
          s.data?.description.toLowerCase().includes(lowQuery))
      : availableSpells;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [availableSpells, lowQuery]);

  if (!open || spellLevel === null) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Pick a level ${spellLevel} spell`}>
        <div className={styles.header}>
          <h3>Level {spellLevel} spell</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          type="search"
          className={styles.search}
          placeholder={availableSpells.length > 0 ? `Search ${availableSpells.length}…` : 'No spells available'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        <div className={styles.list}>
          {filtered.length === 0 && (
            <div className={styles.empty}>
              {availableSpells.length === 0
                ? 'No trainable spells at this level (all already trained?).'
                : `No spells match "${query}".`}
            </div>
          )}
          {filtered.map(s => (
            <button
              key={s.name}
              className={styles.row}
              onClick={() => onPick(s.name)}
              title={s.data?.description ?? s.name}
            >
              {s.data?.icon && (
                <img
                  src={`/assets/images/SpellImages/${s.data.icon}.png`}
                  alt=""
                  className={styles.rowIcon}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className={styles.rowBody}>
                <div className={styles.rowName}>{s.name}</div>
                <div className={styles.rowMeta}>
                  {s.data?.school && <span className={styles.rowSchool}>{s.data.school}</span>}
                  {s.data?.cost !== undefined && <span>{s.data.cost} SP</span>}
                  {s.data?.maxCasterLevel && <span>Max CL {s.data.maxCasterLevel}</span>}
                </div>
                {s.data?.description && (
                  <div className={styles.rowDesc}>
                    {s.data.description.slice(0, 160)}{s.data.description.length > 160 ? '…' : ''}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
