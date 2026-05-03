import { useBuild } from '@/hooks/useBuild';
import { useGameDataStore } from '@/store/gameDataStore';
import styles from './StatsSummary.module.css';

export function StatsSummary() {
  const { build, charLevel, bab, hitPoints, saves, effectiveScores, modifiers } = useBuild();
  const gameStatus = useGameDataStore(s => s.status);

  const stats: { label: string; value: string | number }[] = [
    { label: 'Character Level', value: charLevel },
    { label: 'Hit Points',      value: hitPoints },
    { label: 'Base Attack',     value: `+${bab}` },
    { label: 'Fortitude',       value: saves.fortitude >= 0 ? `+${saves.fortitude}` : saves.fortitude },
    { label: 'Reflex',          value: saves.reflex >= 0 ? `+${saves.reflex}` : saves.reflex },
    { label: 'Will',            value: saves.will >= 0 ? `+${saves.will}` : saves.will },
  ];

  const abilities: { label: string; key: keyof typeof effectiveScores }[] = [
    { label: 'STR', key: 'STR' },
    { label: 'DEX', key: 'DEX' },
    { label: 'CON', key: 'CON' },
    { label: 'INT', key: 'INT' },
    { label: 'WIS', key: 'WIS' },
    { label: 'CHA', key: 'CHA' },
  ];

  const classSummary = build.classes
    .map(c => `${c.classId.replace(/_/g, ' ')} ${c.levels}`)
    .join(' / ');

  return (
    <aside className={styles.panel}>
      <div className={styles.heading}>
        <span>Build Summary</span>
        {gameStatus === 'loading' && <span className={styles.loadingBadge}>loading data…</span>}
      </div>
      {classSummary && <p className={styles.classSummary}>{classSummary}</p>}

      <section className={styles.section}>
        <h3 className={styles.subheading}>Core Stats</h3>
        <dl className={styles.statList}>
          {stats.map(({ label, value }) => (
            <div key={label} className={styles.statRow}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <h3 className={styles.subheading}>Ability Scores</h3>
        <div className={styles.abilityGrid}>
          {abilities.map(({ label, key }) => {
            const mod = modifiers[key];
            const modStr = mod !== undefined && mod >= 0 ? `+${mod}` : String(mod);
            return (
              <div key={label} className={styles.abilityCell}>
                <span className={styles.abilityLabel}>{label}</span>
                <span className={styles.abilityScore}>{effectiveScores[key]}</span>
                <span className={styles.abilityMod}>{modStr}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
