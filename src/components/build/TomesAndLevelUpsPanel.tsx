import { useBuild } from '@/hooks/useBuild';
import { useBuildStore } from '@/store/buildStore';
import type { Stat } from '@/types/build';
import styles from './TomesAndLevelUpsPanel.module.css';

const STATS: Stat[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const STAT_NAMES: Record<Stat, string> = {
  STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution',
  INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma',
};

const HEROIC_TIERS = [4, 8, 12, 16, 20];
const EPIC_TIERS = [24, 28, 32, 36, 40];

/**
 * Compact panel for ability tomes (max +8 each) and the level-up assignment
 * picker (every 4 levels). Both flow into `effectiveScores` via `useBuild`.
 */
export function TomesAndLevelUpsPanel() {
  const { build, totalCharLevel } = useBuild();
  const setAbilityTome = useBuildStore(s => s.setAbilityTome);
  const setLevelUp = useBuildStore(s => s.setLevelUp);

  const tomes = build.abilityTomes ?? {};
  const levelUps = build.levelUps ?? {};

  // Show only tier rows whose level is achievable. `totalCharLevel`
  // includes heroic + epic + legendary; using heroic-only `charLevel`
  // would hide tier 24+ even on level-30+ builds.
  const visibleTiers = [
    ...HEROIC_TIERS,
    ...EPIC_TIERS.filter(t => totalCharLevel >= t),
  ];

  return (
    <section className={styles.panel}>
      <h3 className={styles.heading}>Tomes &amp; Level-Ups</h3>

      <div className={styles.grid}>
        <div className={styles.col}>
          <h4 className={styles.colHeading}>Ability Tomes</h4>
          <table className={styles.tomeTable}>
            <tbody>
              {STATS.map(stat => {
                const v = tomes[stat] ?? 0;
                return (
                  <tr key={stat}>
                    <td className={styles.tomeName}>{STAT_NAMES[stat]}</td>
                    <td className={styles.tomeControls}>
                      <button
                        className={styles.btn}
                        onClick={() => setAbilityTome(stat, v - 1)}
                        disabled={v <= 0}
                        aria-label={`Decrease ${STAT_NAMES[stat]} tome`}
                      >−</button>
                      <span className={styles.tomeValue}>+{v}</span>
                      <button
                        className={styles.btn}
                        onClick={() => setAbilityTome(stat, v + 1)}
                        disabled={v >= 8}
                        aria-label={`Increase ${STAT_NAMES[stat]} tome`}
                      >+</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.col}>
          <h4 className={styles.colHeading}>Level-Up Assignments</h4>
          <table className={styles.levelTable}>
            <tbody>
              {visibleTiers.map(level => {
                const sel = levelUps[level] ?? '';
                const reached = totalCharLevel >= level;
                return (
                  <tr key={level} className={reached ? '' : styles.dimRow}>
                    <td className={styles.levelLabel}>Level {level}</td>
                    <td>
                      <select
                        className={styles.select}
                        value={sel}
                        onChange={e => setLevelUp(level, (e.target.value as Stat) || null)}
                        disabled={!reached}
                        aria-label={`Level ${level} ability assignment`}
                      >
                        <option value="">—</option>
                        {STATS.map(s => (
                          <option key={s} value={s}>{STAT_NAMES[s]}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
