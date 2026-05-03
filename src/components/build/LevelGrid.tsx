import { useMemo, useState } from 'react';
import { useBuild } from '@/hooks/useBuild';
import { useGameDataStore } from '@/store/gameDataStore';
import { useBuildStore } from '@/store/buildStore';
import { ddoClassDataToEngineClass, nameToId } from '@/utils/classAdapter';
import { classIconUrl } from '@/utils/ddoXmlParser';
import { resolveLevelClasses } from '@/utils/levelClasses';
import type { DDOClass } from '@/types/gameData';
import classesJson from '@/data/classes.json';
import styles from './LevelGrid.module.css';

const STUB_CLASSES = classesJson as unknown as DDOClass[];
const MAX_HEROIC_LEVEL = 20;

/**
 * Per-level class assignment grid. Shows a cell for each character level;
 * click a cell to change which class that level is. Total levels per
 * class are kept in sync via store actions.
 *
 * Out of scope (Phase 3.x):
 *   - Per-level feat slots (heroic / class-bonus / epic — class XML driven)
 *   - Per-level skill rank assignment
 *   - Epic / Legendary pseudo-class levels (21–40)
 */
export function LevelGrid() {
  const { build, charLevel } = useBuild();
  const setLevelClass = useBuildStore(s => s.setLevelClass);
  const gameData = useGameDataStore();

  const [picker, setPicker] = useState<number | null>(null);

  const classOptions: DDOClass[] = useMemo(
    () => (gameData.status === 'ready' && gameData.classes.length > 0
      ? gameData.classes
          .map(ddoClassDataToEngineClass)
          .filter(c => c.name !== 'Epic' && c.name !== 'Legendary' && c.name !== 'Unknown')
      : STUB_CLASSES
    ).sort((a, b) => a.name.localeCompare(b.name)),
    [gameData.status, gameData.classes],
  );

  const levels = useMemo(() => resolveLevelClasses(build), [build]);

  function classIcon(classId: string): string | null {
    const cls = gameData.classes.find(c => nameToId(c.name) === classId);
    return cls ? classIconUrl(cls.smallIcon || cls.largeIcon, false) : null;
  }
  function className(classId: string): string {
    const cls = classOptions.find(c => c.id === classId);
    return cls?.name ?? classId.replace(/_/g, ' ');
  }

  function pick(level: number, classId: string) {
    setLevelClass(level, classId);
    setPicker(null);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Levels</h3>
        <span className={styles.meta}>
          1–{Math.min(charLevel, MAX_HEROIC_LEVEL)}
          {charLevel > MAX_HEROIC_LEVEL && ` (+${charLevel - MAX_HEROIC_LEVEL} epic)`}
        </span>
      </div>
      <div className={styles.grid}>
        {levels.slice(0, MAX_HEROIC_LEVEL).map((classId, i) => {
          const level = i + 1;
          const icon = classIcon(classId);
          return (
            <button
              key={i}
              className={styles.cell}
              onClick={() => setPicker(level)}
              title={`Level ${level}: ${className(classId)} — click to change`}
              aria-label={`Level ${level}: ${className(classId)}`}
            >
              <span className={styles.levelNum}>{level}</span>
              {icon
                ? <img src={icon} alt="" className={styles.classIcon}
                       onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                : <span className={styles.classIconPlaceholder} />}
              <span className={styles.className}>{className(classId)}</span>
            </button>
          );
        })}
      </div>

      {picker !== null && (
        <div className={styles.pickerOverlay} onClick={() => setPicker(null)}>
          <div className={styles.pickerDialog} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Pick class for level ${picker}`}>
            <div className={styles.pickerHeader}>
              <span>Level {picker}</span>
              <button className={styles.closeBtn} onClick={() => setPicker(null)} aria-label="Close">×</button>
            </div>
            <div className={styles.classList}>
              {classOptions.map(c => {
                const icon = classIcon(c.id);
                const current = levels[picker - 1] === c.id;
                return (
                  <button
                    key={c.id}
                    className={current ? styles.classOptionActive : styles.classOption}
                    onClick={() => pick(picker, c.id)}
                  >
                    {icon
                      ? <img src={icon} alt="" className={styles.classIcon}
                             onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <span className={styles.classIconPlaceholder} />}
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
