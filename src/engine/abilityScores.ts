import type { AbilityScores, Stat } from '@/types/build';
import type { Race } from '@/types/gameData';

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function applyRacialBonuses(
  base: AbilityScores,
  race: Race,
  racialStatChoice?: Stat,
): AbilityScores {
  const result = { ...base };

  for (const [stat, bonus] of Object.entries(race.abilityBonuses)) {
    if (stat === 'any') {
      if (racialStatChoice) {
        result[racialStatChoice] += bonus as number;
      }
    } else {
      result[stat as Stat] += bonus as number;
    }
  }

  return result;
}

// DDO 28-point buy costs (base value 8, max purchase to 18 before racial bonuses)
const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 8, 16: 10, 17: 13, 18: 16,
};

export function pointBuyCost(score: number): number {
  return POINT_BUY_COSTS[score] ?? 0;
}

export function totalPointBuyCost(scores: AbilityScores): number {
  return Object.values(scores).reduce((sum, score) => sum + pointBuyCost(score), 0);
}

/**
 * Apply per-stat ability tomes (+N to each stat). Tomes are permanent
 * inherent bonuses and stack with everything.
 */
export function applyAbilityTomes(
  scores: AbilityScores,
  tomes: Partial<Record<Stat, number>> | undefined,
): AbilityScores {
  if (!tomes) return scores;
  const result = { ...scores };
  for (const [stat, bonus] of Object.entries(tomes) as [Stat, number][]) {
    if (typeof bonus === 'number') result[stat] += bonus;
  }
  return result;
}

/**
 * Apply level-up ability assignments. Each entry contributes +1 to the
 * chosen stat. Tier levels in DDO are 4, 8, 12, 16, 20 (heroic) and
 * 24, 28, 32, 36, 40 (epic/legendary).
 */
export function applyLevelUps(
  scores: AbilityScores,
  levelUps: Partial<Record<number, Stat>> | undefined,
): AbilityScores {
  if (!levelUps) return scores;
  const result = { ...scores };
  for (const stat of Object.values(levelUps)) {
    if (stat) result[stat] += 1;
  }
  return result;
}
