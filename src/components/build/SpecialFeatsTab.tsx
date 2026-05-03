import { useMemo, useState } from 'react';
import { useBuild } from '@/hooks/useBuild';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { iconUrl } from '@/utils/ddoXmlParser';
import type { DDOFeatData } from '@/types/ddoData';
import styles from './SpecialFeatsTab.module.css';

// Special feat acquire types we surface as edit categories. The ordering
// below is the tab order shown in the UI.
const CATEGORIES: { type: string; label: string }[] = [
  { type: 'HeroicPastLife',  label: 'Heroic Past Lives' },
  { type: 'RacialPastLife',  label: 'Racial Past Lives' },
  { type: 'IconicPastLife',  label: 'Iconic Past Lives' },
  { type: 'EpicPastLife',    label: 'Epic Past Lives' },
  { type: 'EpicDestinyTree', label: 'Epic Destinies Unlocked' },
  { type: 'UniversalTree',   label: 'Universal Trees Unlocked' },
];

export function SpecialFeatsTab() {
  const { build } = useBuild();
  const setSpecialFeatRank = useBuildStore(s => s.setSpecialFeatRank);
  const allFeats = useGameDataStore(s => s.feats);
  const featIcons = useGameDataStore(s => s.featIcons);
  const [activeCat, setActiveCat] = useState(CATEGORIES[0]!.type);

  // Group feats by acquire type to populate each category. The dropdown
  // / tabs only need feats whose `acquire` matches a known category.
  const featsByCategory = useMemo(() => {
    const m = new Map<string, DDOFeatData[]>();
    for (const cat of CATEGORIES) m.set(cat.type, []);
    for (const f of allFeats) {
      const list = m.get(f.acquire);
      if (list) list.push(f);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [allFeats]);

  // Current ranks per (featId, type) for fast lookup.
  const ranksByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const sf of build.specialFeats ?? []) {
      m.set(`${sf.type}:${sf.featId}`, sf.rank);
    }
    return m;
  }, [build.specialFeats]);

  const currentList = featsByCategory.get(activeCat) ?? [];

  function rankFor(featName: string, type: string): number {
    return ranksByKey.get(`${type}:${featName}`) ?? 0;
  }

  function adjust(featName: string, type: string, delta: number, max: number) {
    const cur = rankFor(featName, type);
    const next = Math.max(0, Math.min(max, cur + delta));
    if (next !== cur) setSpecialFeatRank(featName, type, next);
  }

  // Sum of all ranks in the active category, for the header.
  const totalRanksInCategory = currentList.reduce(
    (n, f) => n + rankFor(f.name, activeCat), 0,
  );

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist">
        {CATEGORIES.map(cat => {
          const active = cat.type === activeCat;
          const taken = (featsByCategory.get(cat.type) ?? [])
            .reduce((n, f) => n + rankFor(f.name, cat.type), 0);
          return (
            <button
              key={cat.type}
              role="tab"
              aria-selected={active}
              className={active ? styles.tabActive : styles.tab}
              onClick={() => setActiveCat(cat.type)}
            >
              {cat.label}
              {taken > 0 && <span className={styles.tabBadge}>{taken}</span>}
            </button>
          );
        })}
      </div>

      <p className={styles.summary}>
        {totalRanksInCategory} ranks in <em>{CATEGORIES.find(c => c.type === activeCat)?.label}</em>
      </p>

      {currentList.length === 0 ? (
        <div className={styles.empty}>No feats are loaded for this category.</div>
      ) : (
        <div className={styles.grid}>
          {currentList.map(feat => {
            const rank = rankFor(feat.name, activeCat);
            const max = feat.maxTimesAcquire || 1;
            const iconName = featIcons[feat.name.toLowerCase()] ?? feat.icon;
            const iconSrc = iconName ? iconUrl(iconName, 'Feat') : '';
            return (
              <div
                key={feat.name}
                className={rank > 0 ? styles.cardActive : styles.card}
                title={feat.description}
              >
                {iconSrc
                  ? <img src={iconSrc} alt="" className={styles.icon} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <div className={styles.iconPlaceholder} />}
                <div className={styles.cardBody}>
                  <div className={styles.featName}>{feat.name}</div>
                  <div className={styles.controls}>
                    <button
                      className={styles.btn}
                      onClick={() => adjust(feat.name, activeCat, -1, max)}
                      disabled={rank <= 0}
                      aria-label={`Decrease ${feat.name}`}
                    >−</button>
                    <span className={styles.rank}>
                      {rank} / {max}
                    </span>
                    <button
                      className={styles.btn}
                      onClick={() => adjust(feat.name, activeCat, +1, max)}
                      disabled={rank >= max}
                      aria-label={`Increase ${feat.name}`}
                    >+</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
