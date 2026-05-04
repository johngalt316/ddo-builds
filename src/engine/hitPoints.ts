import type { ClassLevel } from '@/types/build';
import type { DDOClass } from '@/types/gameData';
import { abilityModifier } from './abilityScores';

/**
 * Per-level HP for the Epic / Legendary pseudo-classes (mirrors
 * `<HitPoints>10</HitPoints>` in Epic.class.xml / Legendary.class.xml).
 * Stored as a constant because they're not in the heroic `build.classes`
 * array — see Build.epicLevels.
 */
const EPIC_HP_PER_LEVEL = 10;

/**
 * Sum HP from class hit dice across heroic classes + Epic/Legendary levels.
 * Doesn't include CON contribution — runEngine adds that as a synthetic
 * 'Hitpoints' bonus once the CON breakdown is final, mirroring DDOBuilderV2's
 * BreakdownItemHitpoints which reads `m_pConstitutionBreakdown->Total()` (gear,
 * augments, set bonuses, … all factor in).
 */
export function classHitPoints(
  classLevels: ClassLevel[],
  classData: DDOClass[],
  epicLevels: number = 0,
): number {
  const classMap = new Map(classData.map(c => [c.id, c]));
  let hp = 0;
  for (const { classId, levels } of classLevels) {
    const cls = classMap.get(classId);
    if (!cls) continue;
    hp += cls.hitDie * levels;
  }
  hp += EPIC_HP_PER_LEVEL * epicLevels;
  return hp;
}

/**
 * Class HP + CON-modifier × total level. Used by the basic stat hook
 * `useBuild` and by tests that want the seed without going through the
 * full breakdown pipeline.
 */
export function calculateHitPoints(
  classLevels: ClassLevel[],
  classData: DDOClass[],
  con: number,
  epicLevels: number = 0,
): number {
  const heroicLevels = classLevels.reduce((s, c) => s + c.levels, 0);
  const totalLevels = heroicLevels + epicLevels;
  const conMod = abilityModifier(con);
  return Math.max(1, classHitPoints(classLevels, classData, epicLevels) + conMod * totalLevels);
}
