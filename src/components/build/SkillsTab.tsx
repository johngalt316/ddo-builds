import { useBuild } from '@/hooks/useBuild';
import skillsJson from '@/data/skills.json';
import type { Skill } from '@/types/gameData';
import styles from './SkillsTab.module.css';

const ALL_SKILLS = skillsJson as unknown as Skill[];

export function SkillsTab() {
  const {
    skillBonuses,
    charLevel,
    skillPointBudget,
    skillPointsSpent,
    updateSkillRank,
  } = useBuild();

  const remaining = skillPointBudget - skillPointsSpent;
  const overBudget = remaining < 0;

  return (
    <div className={styles.panel}>
      <div className={styles.budget}>
        <span>Character level {charLevel}</span>
        <span className={styles.budgetSpacer}>·</span>
        <span className={overBudget ? styles.budgetOver : styles.budgetSpent}>
          {skillPointsSpent} / {skillPointBudget} skill points spent
        </span>
        <span className={styles.budgetSpacer}>·</span>
        <span className={overBudget ? styles.budgetOver : styles.budgetRemaining}>
          {remaining >= 0 ? `${remaining} remaining` : `${-remaining} over`}
        </span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thName}>Skill</th>
              <th className={styles.thAbility}>Key Ability</th>
              <th className={styles.thNum}>Ranks</th>
              <th className={styles.thControls} />
              <th className={styles.thNum}>Max</th>
              <th className={styles.thNum}>Ability Mod</th>
              <th className={styles.thNum}>Total</th>
            </tr>
          </thead>
          <tbody>
            {ALL_SKILLS.map(skill => {
              const b = skillBonuses[skill.id];
              if (!b) return null;
              const isClass = b.isClassSkill;
              const hasRanks = b.ranks > 0;
              const atMax = b.ranks >= b.maxRanks;
              const atMin = b.ranks <= 0;
              return (
                <tr
                  key={skill.id}
                  className={
                    hasRanks
                      ? styles.rowActive
                      : isClass
                      ? styles.rowClass
                      : styles.rowCross
                  }
                >
                  <td className={styles.tdName}>
                    {skill.name}
                    {isClass && <span className={styles.badge}>C</span>}
                    {skill.trainedOnly && <span className={styles.badgeT}>T</span>}
                  </td>
                  <td className={styles.tdAbility}>{skill.keyAbility}</td>
                  <td className={styles.tdNum}>{b.ranks}</td>
                  <td className={styles.tdControls}>
                    <button
                      className={styles.rankBtn}
                      onClick={() => updateSkillRank(skill.id, b.ranks - 1)}
                      disabled={atMin}
                      aria-label={`Decrease ${skill.name} ranks`}
                    >−</button>
                    <button
                      className={styles.rankBtn}
                      onClick={() => updateSkillRank(skill.id, b.ranks + 1)}
                      disabled={atMax}
                      aria-label={`Increase ${skill.name} ranks`}
                    >+</button>
                  </td>
                  <td className={styles.tdMax}>{b.maxRanks}</td>
                  <td className={styles.tdNum}>
                    {b.abilityMod >= 0 ? `+${b.abilityMod}` : b.abilityMod}
                  </td>
                  <td className={`${styles.tdNum} ${styles.total}`}>
                    {b.total >= 0 ? `+${b.total}` : b.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.legend}>
        <span className={styles.badgeLegend}>C</span> class skill &nbsp;
        <span className={styles.badgeTLegend}>T</span> trained only
      </p>
    </div>
  );
}
