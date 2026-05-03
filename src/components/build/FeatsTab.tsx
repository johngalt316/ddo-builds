import { useState } from 'react';
import { useBuild } from '@/hooks/useBuild';
import { useGameDataStore } from '@/store/gameDataStore';
import { iconUrl } from '@/utils/ddoXmlParser';
import { FeatPickerDialog } from './FeatPickerDialog';
import styles from './FeatsTab.module.css';

// Last-resort fallback: derive an icon filename from the feat name when neither
// the comprehensive store map nor game data has an entry.
function deriveIconName(featName: string): string {
  return featName
    .replace(/[:.,'!?]/g, '')
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export function FeatsTab() {
  const { build, removeFeat } = useBuild();
  const featIcons = useGameDataStore(s => s.featIcons);
  const [picker, setPicker] = useState<{ open: boolean; editingSlotIndex?: number }>({ open: false });

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <p className={styles.count}>{build.feats.length} {build.feats.length === 1 ? 'feat' : 'feats'}</p>
        <button
          className={styles.addBtn}
          onClick={() => setPicker({ open: true })}
        >
          + Add Feat
        </button>
      </div>

      {build.feats.length === 0 ? (
        <div className={styles.empty}>
          No feats selected. Click <strong>+ Add Feat</strong> to begin, or import a .DDOBuild file.
        </div>
      ) : (
        <div className={styles.grid}>
          {build.feats.map(sf => {
            const key = sf.featId.toLowerCase();
            const iconName = featIcons[key] ?? deriveIconName(sf.featId);
            const src = iconUrl(iconName, 'Feat');
            return (
              <div key={sf.slotIndex} className={styles.feat} title={sf.featId}>
                <FeatIcon src={src} />
                <span className={styles.name}>{sf.featId}</span>
                <span className={styles.actions}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => setPicker({ open: true, editingSlotIndex: sf.slotIndex })}
                    aria-label={`Replace ${sf.featId}`}
                    title="Replace"
                  >✎</button>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeFeat(sf.slotIndex)}
                    aria-label={`Remove ${sf.featId}`}
                    title="Remove"
                  >×</button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <FeatPickerDialog
        open={picker.open}
        onClose={() => setPicker({ open: false })}
        editingSlotIndex={picker.editingSlotIndex}
      />
    </div>
  );
}

function FeatIcon({ src }: { src: string }) {
  return (
    <div className={styles.iconWrap}>
      <img
        src={src}
        alt=""
        className={styles.icon}
        onError={e => {
          e.currentTarget.style.display = 'none';
          const p = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (p) p.style.display = 'block';
        }}
      />
      <div className={styles.iconPlaceholder} style={{ display: 'none' }} />
    </div>
  );
}
