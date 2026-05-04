import { useEffect } from 'react';
import type { EnhancementSelectionData } from '@/types/ddoData';
import styles from './SelectionPickerDialog.module.css';

interface Props {
  open: boolean;
  /** Title shown in the dialog header (e.g. "Stolen Spell I"). */
  title: string;
  /** Available picks for this selector enhancement. */
  selections: EnhancementSelectionData[];
  /** Currently selected option's name, if reopening to change. */
  current?: string;
  onClose: () => void;
  onPick: (selectionName: string) => void;
}

export function SelectionPickerDialog({
  open, title, selections, current, onClose, onPick,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Pick option for ${title}`}>
        <div className={styles.header}>
          <h3>{title}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.list}>
          {selections.length === 0 && (
            <div className={styles.empty}>No options available.</div>
          )}
          {selections.map(sel => (
            <button
              key={sel.name}
              className={sel.name === current ? styles.rowActive : styles.row}
              onClick={() => onPick(sel.name)}
            >
              {sel.icon && (
                <img
                  src={`/assets/images/EnhancementImages/${sel.icon}.png`}
                  alt=""
                  className={styles.rowIcon}
                  onError={e => {
                    // Some selector icons live under SpellImages (e.g. ATConjureBolts).
                    const img = e.currentTarget as HTMLImageElement;
                    if (img.src.includes('/EnhancementImages/')) {
                      img.src = `/assets/images/SpellImages/${sel.icon}.png`;
                    } else {
                      img.style.display = 'none';
                    }
                  }}
                />
              )}
              <div className={styles.rowBody}>
                <div className={styles.rowName}>{sel.name}</div>
                {sel.description && (
                  <div className={styles.rowDesc}>
                    {sel.description.slice(0, 220)}{sel.description.length > 220 ? '…' : ''}
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
