import { useBuild } from '@/hooks/useBuild';
import { abilityModifier, pointBuyCost } from '@/engine';
import type { Stat } from '@/types/build';
import styles from './AbilityScorePanel.module.css';

const STATS: { key: Stat; label: string }[] = [
  { key: 'STR', label: 'Strength' },
  { key: 'DEX', label: 'Dexterity' },
  { key: 'CON', label: 'Constitution' },
  { key: 'INT', label: 'Intelligence' },
  { key: 'WIS', label: 'Wisdom' },
  { key: 'CHA', label: 'Charisma' },
];

const POINT_BUY_BUDGET = 32;
const MIN_BASE_STAT = 8;
const MAX_BASE_STAT = 18;

export function AbilityScorePanel() {
  const { build, pointBuySpent, updateAbilityScore } = useBuild();
  const remaining = POINT_BUY_BUDGET - pointBuySpent;

  function canIncrease(stat: Stat): boolean {
    const current = build.abilityScores[stat];
    if (current >= MAX_BASE_STAT) return false;
    const cost = pointBuyCost(current + 1) - pointBuyCost(current);
    return remaining >= cost;
  }

  function canDecrease(stat: Stat): boolean {
    return build.abilityScores[stat] > MIN_BASE_STAT;
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Ability Scores</h2>
        <span className={remaining < 0 ? styles.budgetOver : styles.budget}>
          {remaining} pts remaining
        </span>
      </div>
      <p className={styles.hint}>Base stats before racial bonuses. 32-point buy.</p>

      <div className={styles.grid}>
        {STATS.map(({ key, label }) => {
          const base = build.abilityScores[key];
          const mod = abilityModifier(base);
          const modStr = mod >= 0 ? `+${mod}` : String(mod);
          return (
            <div key={key} className={styles.row}>
              <span className={styles.label}>{label}</span>
              <div className={styles.controls}>
                <button
                  className={styles.btn}
                  onClick={() => updateAbilityScore(key, base - 1)}
                  disabled={!canDecrease(key)}
                  aria-label={`Decrease ${label}`}
                >−</button>
                <span className={styles.score}>{base}</span>
                <button
                  className={styles.btn}
                  onClick={() => updateAbilityScore(key, base + 1)}
                  disabled={!canIncrease(key)}
                  aria-label={`Increase ${label}`}
                >+</button>
              </div>
              <span className={styles.mod}>{modStr}</span>
              <span className={styles.cost}>({pointBuyCost(base)} pts)</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
