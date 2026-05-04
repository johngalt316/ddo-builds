// Default enhancement-tree selection for fresh / unset builds.
//
// When `build.selectedEnhancementTrees` is empty (new build, or imported
// build with no `<Enhancement_SelectedTrees>` data), the editor seeds
// the selection with sensible defaults:
//   - The racial enhancement tree (1 tree)
//   - The 3 class-specific enhancement trees for the class with the most
//     levels in the build
//
// Universal trees (Falconry / Harper Agent / etc.) are deliberately
// excluded — they're feat-gated and not always taken.

import type { Build } from '@/types/build';
import type { DDOClassData, EnhancementTreeData } from '@/types/ddoData';
import { nameToId } from './classAdapter';

/**
 * Find the classId with the most levels in the build. Ties resolved by
 * insertion order (earliest split wins).
 */
function topClassId(build: Build): string | null {
  let best: { classId: string; levels: number } | null = null;
  for (const cl of build.classes) {
    if (!best || cl.levels > best.levels) best = { ...cl };
  }
  return best?.classId ?? null;
}

/**
 * Returns the tree name list to seed `selectedEnhancementTrees` with —
 * race tree first, then up to 3 class trees for the top class. Returns []
 * if game data isn't loaded enough to compute the defaults.
 */
export function computeDefaultEnhancementTrees(
  build: Build,
  classData: DDOClassData[],
  allTrees: EnhancementTreeData[],
): string[] {
  if (allTrees.length === 0) return [];
  const out: string[] = [];

  // ── Race tree ─────────────────────────────────────────────────────
  // Match by raceReq (preferred) or by the tree being flagged racial
  // and named after the race.
  const raceTree = allTrees.find(t =>
    !t.isDestinyTree && !t.isReaperTree
    && (t.raceReq && nameToId(t.raceReq) === build.raceId)
  ) ?? allTrees.find(t =>
    !t.isDestinyTree && !t.isReaperTree
    && t.isRacialTree && nameToId(t.name) === build.raceId
  );
  if (raceTree) out.push(raceTree.name);

  // ── Top class's 3 trees ───────────────────────────────────────────
  const topId = topClassId(build);
  if (topId) {
    // Build classId → baseClass map for prestige-class resolution.
    const baseClassMap = new Map<string, string>();
    for (const c of classData) {
      if (c.baseClass) {
        baseClassMap.set(nameToId(c.name), nameToId(c.baseClass));
      }
    }
    const baseOfTop = baseClassMap.get(topId);

    function matchesTopClass(t: EnhancementTreeData): boolean {
      if (t.isDestinyTree || t.isReaperTree || t.isRacialTree || t.isUniversal) return false;
      for (const req of t.classReqs) {
        const reqId = nameToId(req.className);
        if (req.matchType === 'Class' && reqId === topId) return true;
        if (req.matchType === 'BaseClass') {
          if (reqId === topId) return true;             // class IS the base
          if (reqId === baseOfTop) return true;         // class shares this base
        }
      }
      return false;
    }

    const classTrees = allTrees
      .filter(matchesTopClass)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const t of classTrees.slice(0, 3)) out.push(t.name);
  }

  return out;
}
