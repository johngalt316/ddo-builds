import { useMemo } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import {
  abilityModifier,
  applyRacialBonuses,
  applyAbilityTomes,
  applyLevelUps,
  calculateBAB,
  calculateHitPoints,
  calculateSaves,
  calculateAllSkillBonuses,
  calculateSkillPointBudget,
  characterLevel,
  totalPointBuyCost,
} from '@/engine';
import { ddoClassDataToEngineClass, ddoRaceDataToRace } from '@/utils/classAdapter';
import racesJson from '@/data/races.json';
import classesJson from '@/data/classes.json';
import skillsJson from '@/data/skills.json';
import type { Race, DDOClass, Skill } from '@/types/gameData';
import type { Stat } from '@/types/build';

const STUB_RACES   = racesJson   as unknown as Race[];
const STUB_CLASSES = classesJson as unknown as DDOClass[];
const SKILLS_DATA  = skillsJson  as unknown as Skill[];

export function useBuild() {
  const store    = useBuildStore();
  const { build } = store;
  const gameData = useGameDataStore();

  // Use real loaded data when available; fall back to stubs so the app is
  // usable before the XML files finish fetching.
  const racesData = useMemo(
    () => gameData.status === 'ready' && gameData.races.length > 0
      ? gameData.races.map(ddoRaceDataToRace)
      : STUB_RACES,
    [gameData.status, gameData.races],
  );

  const classesData = useMemo(
    () => gameData.status === 'ready' && gameData.classes.length > 0
      ? gameData.classes.map(ddoClassDataToEngineClass)
      : STUB_CLASSES,
    [gameData.status, gameData.classes],
  );

  const race = useMemo(
    () =>
      racesData.find(r => r.id === build.raceId) ??
      racesData.find(r => r.name.toLowerCase() === build.raceId.replace(/_/g, ' ')) ??
      racesData[0]!,
    [racesData, build.raceId],
  );

  // Score build pipeline: base → race → tomes → level-ups → effective.
  // Engine's stance/feat/etc. effects layer on top of this in runEngine,
  // which reads `effectiveScores` as the seed for AbilityScore breakdowns.
  const effectiveScores = useMemo(
    () => applyLevelUps(
      applyAbilityTomes(
        applyRacialBonuses(build.abilityScores, race),
        build.abilityTomes,
      ),
      build.levelUps,
    ),
    [build.abilityScores, race, build.abilityTomes, build.levelUps],
  );

  const charLevel = useMemo(
    () => characterLevel(build.classes),
    [build.classes],
  );

  const bab = useMemo(
    () => calculateBAB(build.classes, classesData),
    [build.classes, classesData],
  );

  const hitPoints = useMemo(
    () => calculateHitPoints(build.classes, classesData, effectiveScores.CON, build.epicLevels),
    [build.classes, classesData, effectiveScores.CON, build.epicLevels],
  );

  const saves = useMemo(
    () => calculateSaves(
      build.classes,
      classesData,
      effectiveScores.CON,
      effectiveScores.DEX,
      effectiveScores.WIS,
    ),
    [build.classes, classesData, effectiveScores],
  );

  const modifiers = useMemo(
    () => ({
      STR: abilityModifier(effectiveScores.STR),
      DEX: abilityModifier(effectiveScores.DEX),
      CON: abilityModifier(effectiveScores.CON),
      INT: abilityModifier(effectiveScores.INT),
      WIS: abilityModifier(effectiveScores.WIS),
      CHA: abilityModifier(effectiveScores.CHA),
    } as Record<Stat, number>),
    [effectiveScores],
  );

  const pointBuySpent = useMemo(
    () => totalPointBuyCost(build.abilityScores),
    [build.abilityScores],
  );

  // Point-buy budget depends on race + heroic/racial past life count
  // (mirrors DDOBuilderV2's Build::DetermineBuildPoints):
  //   - race.BuildPoints is a 4-tuple [adventurer, champion, 1-PL, 2+PL]
  //   - 0 past lives → index 1 (champion; we don't model the F2P adventurer
  //     tier since "Champion" is the default for any reasonably set-up account)
  //   - 1 past life → index 2
  //   - 2+ past lives → index 3
  //   - Only HeroicPastLife and RacialPastLife count for this purpose
  //     (Epic & Iconic do not affect point buy)
  const rawRaces = useGameDataStore(s => s.races);
  const pointBuyBudget = useMemo(() => {
    const rawRace =
      rawRaces.find(r => r.name.toLowerCase().replace(/[\s']+/g, '_') === build.raceId) ??
      rawRaces[0];
    const bp = rawRace?.buildPoints ?? [28, 32, 34, 36];
    // DDOBuilderV2 sums total ranks (each rank = one past-life instance),
    // so a single rank-3 Past Life: Wizard already crosses the "2+" threshold.
    const plCount = (build.specialFeats ?? [])
      .filter(f => f.type === 'HeroicPastLife' || f.type === 'RacialPastLife')
      .reduce((sum, f) => sum + f.rank, 0);
    if (plCount === 0) return bp[1] ?? 32;
    if (plCount === 1) return bp[2] ?? 34;
    return bp[3] ?? 36;
  }, [rawRaces, build.raceId, build.specialFeats]);

  const skillBonuses = useMemo(
    () => calculateAllSkillBonuses(
      build.skillRanks,
      SKILLS_DATA,
      effectiveScores as unknown as Record<string, number>,
      build.classes,
      classesData,
      race.skillBonuses as Record<string, number>,
      build.skillTomes ?? {},
    ),
    [build.skillRanks, effectiveScores, build.classes, classesData, race, build.skillTomes],
  );

  const skillPointBudget = useMemo(
    () => calculateSkillPointBudget(
      build.classes,
      classesData,
      abilityModifier(effectiveScores.INT),
      race.bonusSkillPoints ?? 0,
    ),
    [build.classes, classesData, effectiveScores.INT, race.bonusSkillPoints],
  );

  const skillPointsSpent = useMemo(
    () => Object.values(build.skillRanks).reduce((s, n) => s + n, 0),
    [build.skillRanks],
  );

  const { build: _build, ...storeActions } = store;

  return {
    build,
    race,
    effectiveScores,
    charLevel,
    bab,
    hitPoints,
    saves,
    modifiers,
    pointBuySpent,
    pointBuyBudget,
    skillBonuses,
    skillPointBudget,
    skillPointsSpent,
    ...storeActions,
  };
}
