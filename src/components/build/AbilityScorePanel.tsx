import { useBuild } from '@/hooks/useBuild';
import { useBuildStore } from '@/store/buildStore';
import { abilityModifier, pointBuyCost, applyRacialBonuses } from '@/engine';
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

const MIN_BASE_STAT = 8;
const MAX_BASE_STAT = 18;
const MAX_ABILITY_TOME = 8;
// All level-up tiers are always rendered so users can plan ahead. Tiers
// above the build's current character level are visually dimmed but still
// editable (so the budget reflects intended assignments).
const ALL_LEVEL_TIERS = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40];

export function AbilityScorePanel() {
  const { build, race, totalCharLevel, pointBuySpent, pointBuyBudget, updateAbilityScore } = useBuild();
  const setAbilityTome = useBuildStore(s => s.setAbilityTome);
  const setLevelUp = useBuildStore(s => s.setLevelUp);
  const remaining = pointBuyBudget - pointBuySpent;
  const tomes = build.abilityTomes ?? {};
  const levelUps = build.levelUps ?? {};
  // Post-racial scores ("Score" column). The +/- controls still operate on
  // the raw point-buy base; pointBuyCost / canIncrease etc. read base too.
  // Displaying the racial-adjusted score is what users expect (Bladeforged's
  // -2 DEX / +2 CON / -2 WIS show through to a starting 8/14/18/18/8/6
  // line for kemton).
  const postRacial = applyRacialBonuses(build.abilityScores, race);

  function canIncrease(stat: Stat): boolean {
    const current = build.abilityScores[stat];
    if (current >= MAX_BASE_STAT) return false;
    const cost = pointBuyCost(current + 1) - pointBuyCost(current);
    return remaining >= cost;
  }

  function canDecrease(stat: Stat): boolean {
    return build.abilityScores[stat] > MIN_BASE_STAT;
  }

  // Count how many times each stat has been picked at level-up tiers (only
  // counting tiers actually reached by total character level — heroic +
  // epic + legendary — so the +N badge reflects the *current* effective
  // bonus on builds with epic levels).
  const levelUpCount: Partial<Record<Stat, number>> = {};
  for (const tier of ALL_LEVEL_TIERS) {
    if (totalCharLevel < tier) continue;
    const stat = levelUps[tier];
    if (!stat) continue;
    levelUpCount[stat] = (levelUpCount[stat] ?? 0) + 1;
  }

  // Fill every reached tier with the same stat (or clear all when '').
  function fillAllLevelUps(stat: Stat | '') {
    for (const tier of ALL_LEVEL_TIERS) {
      if (totalCharLevel < tier) continue;
      setLevelUp(tier, stat || null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Ability Scores</h2>
        <span className={remaining < 0 ? styles.budgetOver : styles.budget}>
          {remaining} pts remaining
        </span>
      </div>
      <p className={styles.hint}>
        Score column shows your point-buy result with {race.name} racial bonuses applied.
        Tomes add on top; level-ups grant +1 each at every 4th level. Hover any score to see
        the point-buy / racial breakdown.
      </p>

      <div className={styles.grid}>
        <div className={styles.headerRow}>
          <span />
          <span className={styles.headerLabel}>Base</span>
          <span className={styles.headerLabel}>Mod</span>
          <span className={styles.headerLabel}>Tome</span>
          <span className={styles.headerLabel}>Level-ups</span>
        </div>
        {STATS.map(({ key, label }) => {
          const base = build.abilityScores[key];
          // Show the racial-adjusted score in the Score column. The +/-
          // buttons still spend point-buy on the raw base, and the score
          // displayed updates correspondingly.
          const displayed = postRacial[key];
          const mod = abilityModifier(displayed);
          const modStr = mod >= 0 ? `+${mod}` : String(mod);
          const racialDelta = displayed - base;
          const baseTitle = racialDelta === 0
            ? undefined
            : `Point-buy ${base} ${racialDelta >= 0 ? '+' : ''}${racialDelta} ${race.name} = ${displayed}`;
          const tome = tomes[key] ?? 0;
          const luCount = levelUpCount[key] ?? 0;
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
                <span className={styles.score} title={baseTitle}>{displayed}</span>
                <button
                  className={styles.btn}
                  onClick={() => updateAbilityScore(key, base + 1)}
                  disabled={!canIncrease(key)}
                  aria-label={`Increase ${label}`}
                >+</button>
                <span className={styles.cost}>({pointBuyCost(base)} pt)</span>
              </div>
              <span className={styles.mod}>{modStr}</span>
              <div className={styles.controls}>
                <button
                  className={styles.btn}
                  onClick={() => setAbilityTome(key, tome - 1)}
                  disabled={tome <= 0}
                  aria-label={`Decrease ${label} tome`}
                >−</button>
                <span className={styles.tomeValue}>+{tome}</span>
                <button
                  className={styles.btn}
                  onClick={() => setAbilityTome(key, tome + 1)}
                  disabled={tome >= MAX_ABILITY_TOME}
                  aria-label={`Increase ${label} tome`}
                >+</button>
              </div>
              <span className={luCount > 0 ? styles.levelUpCount : styles.levelUpCountEmpty}>
                {luCount > 0 ? `+${luCount}` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.subHeader}>
        <h3 className={styles.subHeading}>Level-Up Assignments</h3>
        <label className={styles.fillAllLabel}>
          Fill all reached:
          <select
            className={styles.select}
            value=""
            onChange={e => {
              fillAllLevelUps(e.target.value as Stat | '');
              // Reset back to placeholder so the same option can be re-applied.
              e.target.value = '';
            }}
            aria-label="Apply one stat to every reached level-up tier"
          >
            <option value="">— pick a stat —</option>
            {STATS.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
            <option value="__clear__">(clear all)</option>
          </select>
        </label>
      </div>
      <p className={styles.subHint}>
        Pick a stat at every 4 levels. Each grants +1 to that ability. Tiers above the build's
        level (level {totalCharLevel}) are dimmed but editable for planning.
      </p>
      <div className={styles.levelUpGrid}>
        {ALL_LEVEL_TIERS.map(level => {
          const sel = levelUps[level] ?? '';
          const reached = totalCharLevel >= level;
          return (
            <label
              key={level}
              className={reached ? styles.levelUpRow : styles.levelUpRowDim}
            >
              <span className={styles.levelUpLabel}>L{level}</span>
              <select
                className={styles.select}
                value={sel}
                onChange={e => setLevelUp(level, (e.target.value as Stat) || null)}
                aria-label={`Level ${level} ability assignment`}
              >
                <option value="">—</option>
                {STATS.map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}
