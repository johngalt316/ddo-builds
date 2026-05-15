import { useBuild } from '@/hooks/useBuild';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { ddoClassDataToEngineClass, nameToId } from '@/utils/classAdapter';
import { classIconUrl } from '@/utils/ddoXmlParser';
import type { DDOClass } from '@/types/gameData';
import type { ClassLevel } from '@/types/build';
import classesJson from '@/data/classes.json';
import styles from './ClassSelector.module.css';

const STUB_CLASSES = classesJson as unknown as DDOClass[];
const MAX_CLASSES = 3;
const MAX_LEVEL = 20;
/** Live game cap on epic + legendary pseudo-class levels (U72 = 14). Future
 *  cap bumps will only require updating this number; the engine + store
 *  clamp at 20 (full design ceiling) so we can also model planned content. */
const MAX_EPIC_LEVELS = 14;

export function ClassSelector() {
  const { build, charLevel, updateClasses } = useBuild();
  const setEpicLevels = useBuildStore(s => s.setEpicLevels);
  const epicLevels = build.epicLevels ?? 0;
  const totalCharLevel = charLevel + epicLevels;
  const gameData = useGameDataStore();

  const allClasses: DDOClass[] = gameData.status === 'ready' && gameData.classes.length > 0
    ? gameData.classes
        .map(ddoClassDataToEngineClass)
        .filter(c => c.name !== 'Epic' && c.name !== 'Legendary' && c.name !== 'Unknown')
        .sort((a, b) => a.name.localeCompare(b.name))
    : STUB_CLASSES;

  function addClassSplit() {
    if (build.classes.length >= MAX_CLASSES) return;
    const remaining = MAX_LEVEL - charLevel;
    if (remaining < 1) return;
    const firstAvailable = allClasses.find(
      c => !build.classes.some(cl => cl.classId === c.id),
    );
    if (!firstAvailable) return;
    updateClasses([...build.classes, { classId: firstAvailable.id, levels: 1 }]);
  }

  function removeClass(index: number) {
    if (build.classes.length <= 1) return;
    updateClasses(build.classes.filter((_, i) => i !== index));
  }

  function setClassId(index: number, classId: string) {
    updateClasses(build.classes.map((c, i) => i === index ? { ...c, classId } : c));
  }

  function setLevels(index: number, levels: number) {
    const clamped = Math.max(1, Math.min(levels, MAX_LEVEL));
    const updated = build.classes.map((c, i) => i === index ? { ...c, levels: clamped } : c);
    if (updated.reduce((s, c) => s + c.levels, 0) > MAX_LEVEL) return;
    updateClasses(updated);
  }

  const remaining = MAX_LEVEL - charLevel;

  // Find the icon for a class
  function classIcon(classId: string): string {
    const cls = gameData.classes.find(c => nameToId(c.name) === classId);
    return cls ? classIconUrl(cls.smallIcon || cls.largeIcon, false) : '';
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Classes</h2>
        <span className={remaining < 0 ? styles.levelOver : styles.levelInfo}>
          Heroic {charLevel} / {MAX_LEVEL}
          {epicLevels > 0 && (
            <> · Epic {epicLevels} · Total {totalCharLevel}</>
          )}
        </span>
      </div>

      <div className={styles.classList}>
        {build.classes.map((cls: ClassLevel, index: number) => {
          const icon = classIcon(cls.classId);
          return (
            <div key={index} className={styles.classRow}>
              {icon && (
                <img
                  src={icon}
                  alt=""
                  className={styles.classIcon}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <select
                className={styles.classSelect}
                value={cls.classId}
                onChange={e => setClassId(index, e.target.value)}
                aria-label="Class"
              >
                {/* Keep currently selected class in list even if not in allClasses */}
                {!allClasses.some(c => c.id === cls.classId) && (
                  <option value={cls.classId}>{cls.classId.replace(/_/g, ' ')}</option>
                )}
                {allClasses.map(c => (
                  <option
                    key={c.id}
                    value={c.id}
                    disabled={c.id !== cls.classId && build.classes.some(cl => cl.classId === c.id)}
                  >
                    {c.name}
                  </option>
                ))}
              </select>

              <div className={styles.levelControls}>
                <button
                  className={styles.btn}
                  onClick={() => setLevels(index, cls.levels - 1)}
                  disabled={cls.levels <= 1}
                  aria-label="Decrease levels"
                >−</button>
                <span className={styles.levelBadge}>{cls.levels}</span>
                <button
                  className={styles.btn}
                  onClick={() => setLevels(index, cls.levels + 1)}
                  disabled={remaining <= 0}
                  aria-label="Increase levels"
                >+</button>
              </div>

              {build.classes.length > 1 && (
                <button
                  className={styles.removeBtn}
                  onClick={() => removeClass(index)}
                  aria-label="Remove class"
                >×</button>
              )}
            </div>
          );
        })}
      </div>

      {build.classes.length < MAX_CLASSES && remaining > 0 && (
        <button className={styles.addBtn} onClick={addClassSplit}>
          + Add Splash
        </button>
      )}

      {/* Epic / Legendary levels — pseudo-class levels stacked on top of
       *  heroic 1-20. Engine splits the first 10 into "Epic" and the rest
       *  into "Legendary"; the user just sees a single counter. */}
      <div className={styles.epicRow}>
        <span className={styles.epicLabel}>Epic / Legendary</span>
        <div className={styles.levelControls}>
          <button
            className={styles.btn}
            onClick={() => setEpicLevels(epicLevels - 1)}
            disabled={epicLevels <= 0}
            aria-label="Decrease epic levels"
          >−</button>
          <span className={styles.levelBadge}>{epicLevels}</span>
          <button
            className={styles.btn}
            onClick={() => setEpicLevels(epicLevels + 1)}
            disabled={epicLevels >= MAX_EPIC_LEVELS}
            aria-label="Increase epic levels"
          >+</button>
        </div>
        <span className={styles.epicHint}>
          adds onto heroic 1-{MAX_LEVEL}; live cap is {MAX_LEVEL + MAX_EPIC_LEVELS}
        </span>
      </div>
    </section>
  );
}
