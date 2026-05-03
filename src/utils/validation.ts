import type { Build, ClassLevel } from '@/types/build';
import type { Feat, FeatPrerequisite } from '@/types/gameData';

export const MAX_CHARACTER_LEVEL = 20;
export const MAX_CLASS_SPLITS = 3;
export const POINT_BUY_BUDGET = 32;

export function totalCharacterLevel(classes: ClassLevel[]): number {
  return classes.reduce((s, c) => s + c.levels, 0);
}

export function isFeatPrerequisiteMet(
  prereq: FeatPrerequisite,
  build: Build,
  currentBab: number,
  takenFeatIds: Set<string>,
): boolean {
  switch (prereq.type) {
    case 'feat':
      return prereq.id !== undefined && takenFeatIds.has(prereq.id);
    case 'bab':
      return prereq.value !== undefined && currentBab >= prereq.value;
    case 'stat':
      return prereq.stat !== undefined &&
             prereq.value !== undefined &&
             build.abilityScores[prereq.stat] >= prereq.value;
    case 'class':
      if (!prereq.classId || prereq.classLevel === undefined) return false;
      return (build.classes.find(c => c.classId === prereq.classId)?.levels ?? 0) >= prereq.classLevel;
    case 'race':
      return prereq.id !== undefined && build.raceId === prereq.id;
    default:
      return true;
  }
}

export function isFeatAvailable(
  feat: Feat,
  build: Build,
  currentBab: number,
  slotIndex: number,
): boolean {
  const takenFeatIds = new Set(
    build.feats.filter(f => f.slotIndex < slotIndex).map(f => f.featId),
  );

  return feat.prerequisites.every(prereq =>
    isFeatPrerequisiteMet(prereq, build, currentBab, takenFeatIds),
  );
}

export interface BuildValidation {
  valid: boolean;
  errors: string[];
}

export function validateBuild(build: Build): BuildValidation {
  const errors: string[] = [];

  if (build.classes.length === 0) {
    errors.push('Build must have at least one class.');
  }
  if (build.classes.length > MAX_CLASS_SPLITS) {
    errors.push(`DDO allows at most ${MAX_CLASS_SPLITS} class splits.`);
  }
  if (totalCharacterLevel(build.classes) > MAX_CHARACTER_LEVEL) {
    errors.push(`Total character level cannot exceed ${MAX_CHARACTER_LEVEL}.`);
  }
  if (build.classes.some(c => c.levels < 1)) {
    errors.push('Each class must have at least 1 level.');
  }

  return { valid: errors.length === 0, errors };
}
