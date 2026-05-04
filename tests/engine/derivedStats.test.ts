// @vitest-environment happy-dom
//
// Snapshots the output of every pure engine function for our reference
// builds. Phase 2 will replace `useCharacterStats` with a real Effect/Bonus
// engine — these snapshots are the regression net that flags accidental
// drift in the underlying calculations during that work.
//
// Lives in `engine/` (not `parser/`) because it's testing the engine, but
// uses the parser to load the fixture, so it needs happy-dom for DOMParser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import {
  abilityModifier,
  applyRacialBonuses,
  calculateBAB,
  calculateHitPoints,
  calculateSaves,
  calculateAllSkillBonuses,
  characterLevel,
  totalPointBuyCost,
} from '@/engine';
import racesJson from '@/data/races.json';
import classesJson from '@/data/classes.json';
import skillsJson from '@/data/skills.json';
import type { Race, DDOClass, Skill } from '@/types/gameData';
import type { Build, Stat } from '@/types/build';

const RACES = racesJson as unknown as Race[];
const CLASSES = classesJson as unknown as DDOClass[];
const SKILLS = skillsJson as unknown as Skill[];

const FIXTURES = resolve(__dirname, '../fixtures');
const SNAPSHOTS = resolve(__dirname, '../snapshots');

function loadBuild(filename: string): Build {
  const xml = readFileSync(resolve(FIXTURES, filename), 'utf8');
  const result = parseDDOBuildFile(xml);
  if (!result) throw new Error(`parseDDOBuildFile returned null for ${filename}`);
  return result.build;
}

function deriveStats(build: Build) {
  const race =
    RACES.find(r => r.id === build.raceId) ??
    RACES.find(r => r.name.toLowerCase() === build.raceId.replace(/_/g, ' ')) ??
    RACES[0]!;

  const effectiveScores = applyRacialBonuses(build.abilityScores, race);

  const modifiers = {
    STR: abilityModifier(effectiveScores.STR),
    DEX: abilityModifier(effectiveScores.DEX),
    CON: abilityModifier(effectiveScores.CON),
    INT: abilityModifier(effectiveScores.INT),
    WIS: abilityModifier(effectiveScores.WIS),
    CHA: abilityModifier(effectiveScores.CHA),
  } as Record<Stat, number>;

  return {
    raceResolved:    race.id,
    charLevel:       characterLevel(build.classes),
    pointBuySpent:   totalPointBuyCost(build.abilityScores),
    effectiveScores,
    modifiers,
    bab:             calculateBAB(build.classes, CLASSES),
    hitPoints:       calculateHitPoints(build.classes, CLASSES, effectiveScores.CON, build.epicLevels),
    saves:           calculateSaves(
      build.classes, CLASSES,
      effectiveScores.CON, effectiveScores.DEX, effectiveScores.WIS,
    ),
    skillBonuses:    calculateAllSkillBonuses(
      build.skillRanks, SKILLS,
      effectiveScores as unknown as Record<string, number>,
      build.classes, CLASSES,
      race.skillBonuses as Record<string, number>,
    ),
  };
}

describe('engine output snapshots', () => {
  it('kemton derived stats are stable', async () => {
    const stats = deriveStats(loadBuild('kemton.DDOBuild'));
    await expect(JSON.stringify(stats, null, 2)).toMatchFileSnapshot(
      resolve(SNAPSHOTS, 'kemton.stats.snap.json'),
    );
  });

  it('zentek derived stats are stable', async () => {
    const stats = deriveStats(loadBuild('zentek.DDOBuild'));
    await expect(JSON.stringify(stats, null, 2)).toMatchFileSnapshot(
      resolve(SNAPSHOTS, 'zentek.stats.snap.json'),
    );
  });
});
