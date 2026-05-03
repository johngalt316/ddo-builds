import type { ClassLevel } from '@/types/build';
import type { BabProgression, DDOClass } from '@/types/gameData';

function classBab(progression: BabProgression, levels: number): number {
  switch (progression) {
    case 'full':          return levels;
    case 'three_quarter': return Math.floor(levels * 3 / 4);
    case 'half':          return Math.floor(levels / 2);
  }
}

export function calculateBAB(
  classLevels: ClassLevel[],
  classData: DDOClass[],
): number {
  const classMap = new Map(classData.map(c => [c.id, c]));

  return classLevels.reduce((total, { classId, levels }) => {
    const cls = classMap.get(classId);
    if (!cls) return total;
    return total + classBab(cls.babProgression, levels);
  }, 0);
}
