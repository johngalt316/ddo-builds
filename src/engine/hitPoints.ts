import type { ClassLevel, SelectedFeat } from '@/types/build';
import type { DDOClass } from '@/types/gameData';
import { abilityModifier } from './abilityScores';

export function calculateHitPoints(
  classLevels: ClassLevel[],
  classData: DDOClass[],
  con: number,
  feats: SelectedFeat[],
): number {
  const classMap = new Map(classData.map(c => [c.id, c]));
  const conMod = abilityModifier(con);
  const totalLevels = classLevels.reduce((s, c) => s + c.levels, 0);

  // Toughness: +3 HP + 1 per character level (stackable in DDO)
  const toughnessCount = feats.filter(f => f.featId === 'toughness').length;
  const toughnessBonus = toughnessCount * (3 + totalLevels);

  let hp = 0;
  for (const { classId, levels } of classLevels) {
    const cls = classMap.get(classId);
    if (!cls) continue;
    // DDO uses max hit die per level
    hp += cls.hitDie * levels;
  }

  // CON modifier applies per level
  hp += conMod * totalLevels;
  hp += toughnessBonus;

  return Math.max(1, hp);
}
