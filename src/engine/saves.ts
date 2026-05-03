import type { ClassLevel } from '@/types/build';
import type { DDOClass, SaveProgression } from '@/types/gameData';
import { abilityModifier } from './abilityScores';

function baseSave(progression: SaveProgression, levels: number): number {
  return progression === 'high'
    ? 2 + Math.floor(levels / 2)
    : Math.floor(levels / 3);
}

export interface Saves {
  fortitude: number;
  reflex: number;
  will: number;
}

export function calculateSaves(
  classLevels: ClassLevel[],
  classData: DDOClass[],
  con: number,
  dex: number,
  wis: number,
): Saves {
  const classMap = new Map(classData.map(c => [c.id, c]));

  let fort = 0;
  let ref = 0;
  let will = 0;

  for (const { classId, levels } of classLevels) {
    const cls = classMap.get(classId);
    if (!cls) continue;
    fort += baseSave(cls.saveProgressions.fortitude, levels);
    ref  += baseSave(cls.saveProgressions.reflex, levels);
    will += baseSave(cls.saveProgressions.will, levels);
  }

  return {
    fortitude: fort + abilityModifier(con),
    reflex:    ref  + abilityModifier(dex),
    will:      will + abilityModifier(wis),
  };
}
