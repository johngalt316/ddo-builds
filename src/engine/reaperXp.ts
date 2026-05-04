/**
 * Reaper XP required to have spent N reaper points, expressed in thousands.
 *
 * DDO formula (from DDOBuilderV2 ReaperEnhancementsPane.cpp):
 *   xp = sum of (i*2 + 1) for i = 0..N-1
 *      = sum of first N odd numbers
 *      = N²
 *
 * So: 1 RAP → 1k, 5 RAPs → 25k, 10 RAPs → 100k, 20 RAPs → 400k.
 */
export function requiredReaperXp(totalRaps: number): number {
  return Math.max(0, totalRaps) ** 2;
}
