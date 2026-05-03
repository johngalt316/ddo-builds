// Helpers for the per-level class assignment array.
//
// `build.classes` is a list of {classId, levels} totals — what the engine
// reads. `build.levelClasses` is a parallel array where `levelClasses[i]`
// is the classId taken at character level (i+1). The two are kept in
// sync by store actions: editing any level recomputes the totals.
//
// Why both? Engine math doesn't care which level was which class (BAB
// totals etc. are commutative for our simplified model). UI does — users
// want to see and edit "level 5: rogue, level 6: fighter, ...".

import type { Build, ClassLevel } from '@/types/build';

/**
 * Resolve a per-level class array, deriving from `build.classes` if the
 * field is absent or doesn't match charLevel. Derivation order: classes[0]'s
 * levels first, then classes[1], etc.
 */
export function resolveLevelClasses(build: Build): string[] {
  const charLevel = build.classes.reduce((s, c) => s + c.levels, 0);
  const stored = build.levelClasses ?? [];
  if (stored.length === charLevel && charLevel > 0) return stored;

  // Derive from classes[]
  const out: string[] = [];
  for (const cl of build.classes) {
    for (let i = 0; i < cl.levels; i++) out.push(cl.classId);
  }
  return out;
}

/**
 * Aggregate a per-level class array back into ClassLevel[] totals.
 * Order in the output array is order-of-first-appearance in levels[].
 */
export function aggregateClasses(levelClasses: string[]): ClassLevel[] {
  const counts = new Map<string, number>();
  for (const id of levelClasses) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([classId, levels]) => ({ classId, levels }));
}
