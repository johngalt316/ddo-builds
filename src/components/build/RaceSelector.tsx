import { useBuild } from '@/hooks/useBuild';
import { useGameDataStore } from '@/store/gameDataStore';
import { ddoRaceDataToRace } from '@/utils/classAdapter';
import { iconUrl } from '@/utils/ddoXmlParser';
import type { Race } from '@/types/gameData';
import racesJson from '@/data/races.json';
import styles from './RaceSelector.module.css';

const STUB_RACES = racesJson as unknown as Race[];

export function RaceSelector() {
  const { build, race, updateRace } = useBuild();
  const gameData = useGameDataStore();

  const races: Race[] = gameData.status === 'ready' && gameData.races.length > 0
    ? gameData.races.map(ddoRaceDataToRace).sort((a, b) => a.name.localeCompare(b.name))
    : STUB_RACES;

  // Try to get the icon from ClassImages (DDO stores race icons there too)
  const raceIconUrl = (() => {
    const iconName = gameData.races.find(
      r => r.name.toLowerCase() === race.name.toLowerCase()
    )?.name.replace(/\s+/g, '_') ?? '';
    return iconName ? iconUrl(iconName, 'Class') : '';
  })();

  const racialBonusText = () => {
    const bonuses = race.abilityBonuses as Record<string, number>;
    const parts: string[] = [];
    if ('any' in bonuses && bonuses['any']) parts.push(`+${bonuses['any']} any`);
    for (const [stat, val] of Object.entries(bonuses)) {
      if (stat === 'any') continue;
      if (val && val > 0) parts.push(`+${val} ${stat}`);
      if (val && val < 0) parts.push(`${val} ${stat}`);
    }
    return parts.length ? parts.join(', ') : 'No ability adjustments';
  };

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Race</h2>
      <select
        className={styles.select}
        value={build.raceId}
        onChange={e => updateRace(e.target.value)}
        aria-label="Race"
      >
        {races.map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      <div className={styles.raceInfo}>
        {raceIconUrl && (
          <img
            src={raceIconUrl}
            alt=""
            className={styles.raceIcon}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div>
          <p className={styles.description}>{race.description}</p>
          <p className={styles.bonuses}><strong>Ability adjustments:</strong> {racialBonusText()}</p>
        </div>
      </div>
    </section>
  );
}
