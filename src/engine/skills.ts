import type { ClassLevel, SkillRanks } from '@/types/build';
import type { DDOClass, Skill } from '@/types/gameData';
import { abilityModifier } from './abilityScores';

export function characterLevel(classLevels: ClassLevel[]): number {
  return classLevels.reduce((s, c) => s + c.levels, 0);
}

export function maxClassSkillRanks(charLevel: number): number {
  return charLevel + 3;
}

export function maxCrossClassSkillRanks(charLevel: number): number {
  return Math.floor((charLevel + 3) / 2);
}

export function isClassSkill(skillId: string, classLevels: ClassLevel[], classData: DDOClass[]): boolean {
  const classMap = new Map(classData.map(c => [c.id, c]));
  return classLevels.some(({ classId }) => classMap.get(classId)?.classSkills.includes(skillId) ?? false);
}

export interface SkillBonus {
  total: number;
  ranks: number;
  abilityMod: number;
  isClassSkill: boolean;
  maxRanks: number;
}

export function calculateSkillBonuses(
  skillId: string,
  ranks: number,
  abilityScores: Record<string, number>,
  skill: Skill,
  classLevels: ClassLevel[],
  classData: DDOClass[],
  racialBonuses: Record<string, number> = {},
  skillTomeBonus: number = 0,
): SkillBonus {
  const charLevel = characterLevel(classLevels);
  const classSkill = isClassSkill(skillId, classLevels, classData);
  const baseMax = classSkill
    ? maxClassSkillRanks(charLevel)
    : maxCrossClassSkillRanks(charLevel);
  // Skill tomes raise the max-rank cap; they do NOT add free ranks.
  const maxRanks = baseMax + skillTomeBonus;
  const abilityMod = abilityModifier(abilityScores[skill.keyAbility] ?? 10);
  const racialBonus = racialBonuses[skillId] ?? 0;

  return {
    total: ranks + abilityMod + racialBonus + skillTomeBonus,
    ranks,
    abilityMod,
    isClassSkill: classSkill,
    maxRanks,
  };
}

export function calculateAllSkillBonuses(
  skillRanks: SkillRanks,
  skills: Skill[],
  abilityScores: Record<string, number>,
  classLevels: ClassLevel[],
  classData: DDOClass[],
  racialBonuses: Record<string, number> = {},
  skillTomes: Record<string, number> = {},
): Record<string, SkillBonus> {
  const result: Record<string, SkillBonus> = {};
  for (const skill of skills) {
    result[skill.id] = calculateSkillBonuses(
      skill.id,
      skillRanks[skill.id] ?? 0,
      abilityScores,
      skill,
      classLevels,
      classData,
      racialBonuses,
      skillTomes[skill.id] ?? 0,
    );
  }
  return result;
}

/**
 * Total skill points the build is allowed to spend.
 *
 * Per DDO: each class level grants `max(1, class.skillPointsPerLevel + intMod)`
 * skill points; the FIRST character level grants 4× that. We approximate
 * "first character level" as the first class in `classLevels[0]`.
 *
 * Cost per rank = 1 (cross-class skills are limited via a lower max-rank cap
 * rather than via a higher per-rank cost in our simplified model).
 *
 * Out of scope (return-value will be slightly low until added):
 *   - Skill tomes (extend max ranks per skill, not budget)
 *   - Human / Half-Elf +1 SP per level
 *   - Sub-1 floor for class data not yet loaded (returns 0)
 *
 * NOTE: `engineClasses` here are post-adapter (DDOClass with id+skillPointsPerLevel),
 * matching what `calculateAllSkillBonuses` accepts.
 */
export function calculateSkillPointBudget(
  classLevels: ClassLevel[],
  classData: DDOClass[],
  intMod: number,
): number {
  const classMap = new Map(classData.map(c => [c.id, c]));
  let total = 0;

  for (const cl of classLevels) {
    const cls = classMap.get(cl.classId);
    if (!cls) continue;
    const perLevel = Math.max(1, cls.skillPointsPerLevel + intMod);
    total += perLevel * cl.levels;
  }

  // First character level: bonus 3× perLevel on top of the base 1× already counted.
  const first = classLevels[0];
  if (first) {
    const cls = classMap.get(first.classId);
    if (cls) {
      total += Math.max(1, cls.skillPointsPerLevel + intMod) * 3;
    }
  }

  return total;
}
