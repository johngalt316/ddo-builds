// Per-level feat-slot computation.
//
// Combines three sources of feat-slot grants:
//   1. Standard heroic feats — at character levels 1, 3, 6, 9, 12, 15, 18
//      (every 3 levels from L3, plus L1). DDO rule, hardcoded — not in XML.
//   2. Class-specific feat slots — `class.featSlots[].level` is the Nth level
//      OF that class (1, 2, 4, ...). Granted when the build reaches that
//      Nth level for the class. Multiclassed builds get class slots in the
//      character level where they took that class level.
//   3. Race feat slots — typically all at character level 1.
//
// Out of scope for now:
//   - Epic feat slots (levels 21+) from Epic.class.xml — same logic should
//     apply but pseudo-class handling is a separate cleanup.
//   - Slot assignment (which feat fills which slot). This module computes
//     availability only; FeatsTab still owns the actual feat list.

import type { ClassLevel } from '@/types/build';
import type { DDOClassData, DDORaceData } from '@/types/ddoData';
import { resolveLevelClasses } from './levelClasses';

export interface FeatSlotInstance {
  /** 1-indexed character level where this slot is granted. */
  characterLevel: number;
  /** Feat-type tag from class/race XML (e.g. "Standard", "Fighter Bonus Feat", "Human Bonus Feat"). */
  featType: string;
  /** Allowed feat names; empty array means unrestricted. */
  options: string[];
  /** Origin label for display (e.g. "Heroic", "Fighter L1", "Human"). */
  source: string;
  /**
   * Stable, deterministic key. Format: "L<level>:<source>:<featType>:<ordinal>".
   * Used as the SelectedFeat.slotIndex when click-to-pick is added later.
   */
  slotKey: string;
}

const STANDARD_HEROIC_LEVELS = new Set([1, 3, 6, 9, 12, 15, 18]);

/**
 * Index a class by `nameToId(class.name)` so we can resolve build.classes[i].classId.
 * Mirrors `classAdapter.nameToId` without importing it (avoids cycle).
 */
function nameToId(s: string): string {
  return s.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
}

export function computeFeatSlots(
  classes: ClassLevel[],
  classData: DDOClassData[],
  races: DDORaceData[],
  raceId: string,
): FeatSlotInstance[] {
  const out: FeatSlotInstance[] = [];

  const classMap = new Map<string, DDOClassData>();
  for (const c of classData) classMap.set(nameToId(c.name), c);

  const raceData = races.find(r => nameToId(r.name) === raceId);

  // Track how many levels of each class have been taken so far, so we can
  // detect when the current character level is the Nth level of a class.
  const classLevelsSeen = new Map<string, number>();

  // Resolve the per-level class array from totals (deterministic order).
  const levelClasses = resolveLevelClasses({
    classes, levelClasses: undefined,
  } as never);

  for (let i = 0; i < levelClasses.length; i++) {
    const characterLevel = i + 1;
    const classId = levelClasses[i]!;
    let ordinal = 0;
    const slotsHere: FeatSlotInstance[] = [];

    // 1. Standard heroic slots at L1, 3, 6, 9, 12, 15, 18.
    if (STANDARD_HEROIC_LEVELS.has(characterLevel)) {
      slotsHere.push({
        characterLevel,
        featType: 'Standard',
        options: [],
        source: 'Heroic',
        slotKey: `L${characterLevel}:Heroic:Standard:${ordinal++}`,
      });
    }

    // 2. Race feat slots at the levels listed in race XML (usually 1).
    if (raceData && characterLevel === 1) {
      for (const fs of raceData.featSlots) {
        if (fs.level !== 1) continue;
        slotsHere.push({
          characterLevel,
          featType: fs.featType,
          options: [...fs.options],
          source: raceData.name,
          slotKey: `L${characterLevel}:${raceData.name}:${fs.featType}:${ordinal++}`,
        });
      }
    }

    // 3. Class slots: increment seen count, then look up `level == seen`.
    const seen = (classLevelsSeen.get(classId) ?? 0) + 1;
    classLevelsSeen.set(classId, seen);

    const cls = classMap.get(classId);
    if (cls) {
      for (const fs of cls.featSlots) {
        if (fs.level !== seen) continue;
        slotsHere.push({
          characterLevel,
          featType: fs.featType,
          options: [...fs.options],
          source: `${cls.name} L${seen}`,
          slotKey: `L${characterLevel}:${cls.name}L${seen}:${fs.featType}:${ordinal++}`,
        });
      }
    }

    out.push(...slotsHere);
  }

  return out;
}

/** Group computed slots by character level for grid rendering. */
export function groupSlotsByLevel(slots: FeatSlotInstance[]): Map<number, FeatSlotInstance[]> {
  const m = new Map<number, FeatSlotInstance[]>();
  for (const s of slots) {
    const list = m.get(s.characterLevel) ?? [];
    list.push(s);
    m.set(s.characterLevel, list);
  }
  return m;
}

/**
 * Compact label for a slot type — used for tooltip-free hover/legend.
 * "Standard" → "S", "Fighter Bonus Feat" → "FB", "Human Bonus Feat" → "HB", etc.
 */
export function shortFeatType(featType: string): string {
  if (featType === 'Standard') return 'S';
  // Take first letter of each significant word.
  return featType
    .split(/\s+/)
    .filter(w => !/^(Bonus|Feat|the|of|a)$/i.test(w))
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3) || '?';
}
