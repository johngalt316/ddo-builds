import { create } from 'zustand';
import type { AbilityScores, Alignment, Build, ClassLevel, EnhancementSelection, GearItem, GearSlot, SelectedFeat, Stat } from '@/types/build';
import { DEFAULT_BUILD } from '@/types/build';
import { resolveLevelClasses, aggregateClasses } from '@/utils/levelClasses';

const MAX_HEROIC_AP = 80;
const MAX_TREES = 7; // MAX_ENHANCEMENT_TREES in DDOBuilderV2 stdafx.h

interface BuildState {
  build: Build;
  setBuild: (build: Build) => void;
  updateName: (name: string) => void;
  updateRace: (raceId: string) => void;
  updateAlignment: (alignment: Alignment) => void;
  updateClasses: (classes: ClassLevel[]) => void;
  updateAbilityScore: (stat: Stat, value: number) => void;
  updateAbilityScores: (scores: AbilityScores) => void;
  updateSkillRank: (skillId: string, ranks: number) => void;
  addFeat: (feat: SelectedFeat) => void;
  removeFeat: (slotIndex: number) => void;
  resetBuild: () => void;
  // Enhancement tree selection (shared between heroic and destiny)
  setSelectedTrees: (trees: string[]) => void;
  toggleTree: (treeName: string) => void;
  // Heroic enhancement spending
  spendEnhancement: (treeId: string, enhancementId: string, maxRanks: number, selection?: string) => void;
  revokeEnhancement: (treeId: string, enhancementId: string) => void;
  resetTree: (treeId: string) => void;
  // Epic destiny spending (same shape, different state key)
  spendDestinyEnhancement: (treeId: string, enhancementId: string, maxRanks: number, selection?: string) => void;
  revokeDestinyEnhancement: (treeId: string, enhancementId: string) => void;
  resetDestinyTree: (treeId: string) => void;
  // Reaper enhancement spending (same shape; max MAX_REAPER_TREES trees)
  spendReaperEnhancement: (treeId: string, enhancementId: string, maxRanks: number, selection?: string) => void;
  revokeReaperEnhancement: (treeId: string, enhancementId: string) => void;
  resetReaperTree: (treeId: string) => void;
  // Stances
  toggleStance: (name: string) => void;
  setStances: (names: string[]) => void;
  // Per-level class editing
  setLevelClass: (level: number, classId: string) => void;
  setTotalLevels: (totalLevel: number) => void;
  // Tomes + level-ups
  setAbilityTome: (stat: Stat, value: number) => void;
  setSkillTome: (skillId: string, value: number) => void;
  setLevelUp: (level: number, stat: Stat | null) => void;
  // Special feats (past lives, etc.)
  setSpecialFeatRank: (featId: string, type: string, rank: number) => void;
  // Gear editing — operates on the active gear set; auto-creates a "Standard"
  // set if none exists yet.
  equipItem: (slot: GearSlot, item: GearItem) => void;
  unequipItem: (slot: GearSlot) => void;
  setActiveGearSet: (name: string) => void;
  // Gear-set CRUD
  createGearSet: (name: string) => void;
  renameGearSet: (oldName: string, newName: string) => void;
  duplicateGearSet: (srcName: string, newName: string) => void;
  deleteGearSet: (name: string) => void;
  // Augments — sets/clears the selected augment in a specific slot of a
  // specific item in the active gear set. Pass `null` augmentName to clear.
  setItemAugment: (
    itemSlot: GearSlot,
    augmentSlotIdx: number,
    augmentName: string | null,
    levelIndex?: number,
  ) => void;
  // Filigrees — set/clear a sentient-weapon (`'weapon'`) or artifact slot
  // in the active gear set. Pass `null` to empty the slot.
  setFiligree: (
    target: 'weapon' | 'artifact',
    slotIdx: number,
    filigreeName: string | null,
  ) => void;
  // Toggle the rare-effect flag for a filigree slot in the active gear set.
  setFiligreeRare: (
    target: 'weapon' | 'artifact',
    slotIdx: number,
    rare: boolean,
  ) => void;
  // Train a spell into the given class+spellLevel slot list. No-op if the
  // spell is already trained at that level for that class.
  trainSpell: (className: string, spellLevel: number, spellName: string) => void;
  untrainSpell: (className: string, spellLevel: number, spellName: string) => void;
  // Toggle a metamagic ("Empower", "Maximize", …) in the active set.
  toggleMetamagic: (name: string) => void;
  // Toggle a self/party buff (Haste, Recitation, etc.).
  togglePartyBuff: (name: string) => void;
  // Set a racial or universal AP tome value (clamped to its cap).
  setEnhancementTome: (kind: 'racial' | 'universal', value: number) => void;
}

/** Tree-shape used by the AP-cost helpers — only the items we need are
 *  read; pass through any larger tree type (e.g. EnhancementTreeData).
 *  When the user picks a selector option, its `costPerRank` (if present)
 *  overrides the parent item's cost. */
type APTreeShape = {
  name: string;
  isRacialTree?: boolean;
  isUniversal?: boolean;
  items?: {
    internalName: string;
    costPerRank: number[];
    selector?: { name: string; costPerRank?: number[] }[] | null;
  }[];
};

/** Sum the AP cost of holding `rank` ranks of an enhancement, using its
 *  per-rank cost table. Falls back to 1 AP per rank when the cost table
 *  is missing (defensive default — every parsed tree carries one). */
function enhancementCost(rank: number, costPerRank?: number[]): number {
  if (rank <= 0) return 0;
  const table = costPerRank ?? [];
  let sum = 0;
  for (let i = 0; i < rank; i++) {
    sum += table[i] ?? table[table.length - 1] ?? 1;
  }
  return sum;
}

function apSpent(
  enhancements: EnhancementSelection[],
  trees: APTreeShape[] = [],
): number {
  if (trees.length === 0) {
    // Fallback for callers without tree data (tests). Treat each rank as 1 AP.
    return enhancements.reduce(
      (sum, t) => sum + t.enhancements.reduce((s, e) => s + e.rank, 0),
      0,
    );
  }
  return enhancements.reduce(
    (sum, ts) => sum + apSpentInTree(ts.treeId, enhancements, trees), 0,
  );
}

function apSpentInTree(
  treeId: string,
  enhancements: EnhancementSelection[],
  trees: APTreeShape[] = [],
): number {
  const ts = enhancements.find(t => t.treeId === treeId);
  if (!ts) return 0;
  const tree = trees.find(t => t.name === treeId);
  if (!tree?.items) {
    // Fallback when tree data isn't supplied — count rank as cost.
    return ts.enhancements.reduce((s, e) => s + e.rank, 0);
  }
  let sum = 0;
  for (const enh of ts.enhancements) {
    const item = tree.items.find(i => i.internalName === enh.enhancementId);
    sum += enhancementCost(enh.rank, costTableFor(item, enh.selection));
  }
  return sum;
}

/** Pick the right costPerRank table — selection cost if the user chose
 *  one and that selection has its own override; otherwise the item's cost. */
function costTableFor(
  item: APTreeShape['items'] extends (infer I)[] | undefined ? I | undefined : never,
  selectionName?: string,
): number[] | undefined {
  if (!item) return undefined;
  if (selectionName && item.selector) {
    const sel = item.selector.find(s => s.name === selectionName);
    if (sel?.costPerRank?.length) return sel.costPerRank;
  }
  return item.costPerRank;
}

export { apSpent, apSpentInTree, MAX_HEROIC_AP };
export const MAX_DESTINY_AP = 336;
export const MAX_DESTINY_TREES = 3; // MAX_DESTINY_TREES in DDOBuilderV2 stdafx.h
// Reaper points are earned via reaper XP and have no fixed in-game cap.
// We pick a generous editor cap so users can't accidentally over-allocate.
export const MAX_REAPER_AP = 200;
export const MAX_REAPER_TREES = 3; // MAX_REAPER_TREES in DDOBuilderV2 stdafx.h

// Heroic AP is split into three pools (DDO mechanics). Each tree consumes
// from its own pool only — racial trees use racial AP, universal trees use
// universal AP, all other class/prestige trees draw from the standard pool.
//
// AP totals are NOT user-configurable tomes — bonus RAP/UAP is granted
// entirely by trained special feats. Racial AP is +1 per race that has
// 3 racial past lives (granted via the racial PL feat's `<RAPBonus>`
// effect) plus inherent RAP feats. Universal AP comes from inherent UAP
// feats and quest favor. Standard AP has no in-game tome; the cap is
// fixed at 80 (4 × character level 20).
export type APCategory = 'standard' | 'racial' | 'universal';
export const BASE_STANDARD_AP  = 80;       // 4 per character level × 20
export const BASE_RACIAL_AP    = 0;        // racial AP is entirely from feats / past lives
export const BASE_UNIVERSAL_AP = 0;        // universal AP also entirely feat / favor sourced
// Tome caps — Standard has no in-game tome; Racial / Universal each accept
// up to 3 tome points from real-world purchase / consumable items.
export const MAX_RACIAL_AP_TOME    = 3;
export const MAX_UNIVERSAL_AP_TOME = 3;

/**
 * Sum RAPBonus / UAPBonus effects from the build's trained special feats.
 *
 * In DDO the bonus pool sizes are defined by per-feat <Effect Type=RAPBonus>
 * blocks (e.g. each Racial Past Life at rank 3 grants +1 RAP via a
 * `<Amount size="3">0 0 1</Amount>` table; the Inherent Racial Action
 * Point tome grants up to +10 via `<Amount size="10">1 2 3 4 5 6 7 8 9 10
 * </Amount>`). We mirror DDOBuilderV2's `Life::CountBonusRacialAP` by
 * walking those effects and summing the rank-indexed amount.
 *
 * `effectType` is `'RAPBonus'` for racial AP, `'UAPBonus'` for universal AP.
 */
export function specialFeatBonusAP(
  specialFeats: { featId: string; type: string; rank: number }[] | undefined,
  feats: { name: string; effects: { types: string[]; amount?: number[] }[] }[],
  effectType: 'RAPBonus' | 'UAPBonus',
): number {
  if (!specialFeats?.length) return 0;
  const featIdx = new Map<string, typeof feats[number]>();
  for (const f of feats) featIdx.set(f.name.toLowerCase(), f);
  let total = 0;
  for (const sf of specialFeats) {
    if (sf.rank <= 0) continue;
    const data = featIdx.get(sf.featId.toLowerCase());
    if (!data) continue;
    for (const eff of data.effects) {
      if (!eff.types.includes(effectType)) continue;
      const idx = Math.min(sf.rank, eff.amount?.length ?? 0) - 1;
      total += eff.amount?.[Math.max(0, idx)] ?? 0;
    }
  }
  return total;
}

/** Categorize a tree's AP pool. Destiny / reaper trees are handled
 *  separately and not part of these heroic pools. */
export function treeAPCategory(t: { isRacialTree?: boolean; isUniversal?: boolean }): APCategory {
  if (t.isRacialTree) return 'racial';
  if (t.isUniversal) return 'universal';
  return 'standard';
}

/** Sum AP spent by category, using each enhancement item's real
 *  costPerRank table. Trees the user hasn't unlocked yet still contribute
 *  if they're in the build — bucketed by `isRacialTree` / `isUniversal`. */
export function apSpentByCategory(
  enhancements: EnhancementSelection[],
  trees: APTreeShape[],
): Record<APCategory, number> {
  const treeIdx = new Map(trees.map(t => [t.name, t]));
  const out: Record<APCategory, number> = { standard: 0, racial: 0, universal: 0 };
  for (const ts of enhancements) {
    const t = treeIdx.get(ts.treeId);
    if (!t) continue;
    const cat = treeAPCategory(t);
    if (!t.items) {
      out[cat] += ts.enhancements.reduce((s, e) => s + e.rank, 0);
      continue;
    }
    for (const enh of ts.enhancements) {
      const item = t.items.find(i => i.internalName === enh.enhancementId);
      out[cat] += enhancementCost(enh.rank, costTableFor(item, enh.selection));
    }
  }
  return out;
}

/**
 * Apply DDO's pool-overflow rules: racial and universal trees consume from
 * their own pools first, then any spend over those caps spills into the
 * standard pool. Returns the user-facing pool totals after spillover so
 * the UI can render `spent / cap` honestly.
 *
 * `racialCap` / `universalCap` are the BUDGETS for each pool (base + bonus
 * + tomes); standard cap is fixed at BASE_STANDARD_AP. Each entry's
 * `effectiveSpent` is what the user has spent visible against that pool's
 * cap (capped at the cap itself), and `overflow` is the amount that spilled
 * into the standard pool.
 */
export function applyAPOverflow(
  raw: Record<APCategory, number>,
  racialCap: number,
  universalCap: number,
): Record<APCategory, { spent: number; cap: number; overflow: number }> {
  const racialOverflow    = Math.max(0, raw.racial    - racialCap);
  const universalOverflow = Math.max(0, raw.universal - universalCap);
  return {
    standard:  {
      spent: raw.standard + racialOverflow + universalOverflow,
      cap:   BASE_STANDARD_AP,
      overflow: 0,
    },
    racial:    {
      spent: Math.min(raw.racial,    racialCap),
      cap:   racialCap,
      overflow: racialOverflow,
    },
    universal: {
      spent: Math.min(raw.universal, universalCap),
      cap:   universalCap,
      overflow: universalOverflow,
    },
  };
}
// Sentient-weapon and artifact filigree slot caps (mirror DDOBuilderV2 stdafx.h).
export const MAX_FILIGREE = 10;
export const MAX_ARTIFACT_FILIGREE = 5;

export const useBuildStore = create<BuildState>((set, get) => ({
  build: { ...DEFAULT_BUILD },

  setBuild: (build) => set({ build }),
  updateName: (name) => set(s => ({ build: { ...s.build, name } })),
  updateRace: (raceId) => set(s => ({ build: { ...s.build, raceId } })),
  updateAlignment: (alignment) => set(s => ({ build: { ...s.build, alignment } })),
  updateClasses: (classes) =>
    set(s => {
      // Re-derive levelClasses from the new classes[] (since the user is
      // changing totals via +/- buttons, the per-level array should follow).
      const levelClasses: string[] = [];
      for (const cl of classes) {
        for (let i = 0; i < cl.levels; i++) levelClasses.push(cl.classId);
      }
      return { build: { ...s.build, classes, levelClasses } };
    }),
  updateAbilityScore: (stat, value) =>
    set(s => ({ build: { ...s.build, abilityScores: { ...s.build.abilityScores, [stat]: value } } })),
  updateAbilityScores: (scores) => set(s => ({ build: { ...s.build, abilityScores: scores } })),
  updateSkillRank: (skillId, ranks) =>
    set(s => ({ build: { ...s.build, skillRanks: { ...s.build.skillRanks, [skillId]: ranks } } })),
  addFeat: (feat) =>
    set(s => ({ build: { ...s.build, feats: [...s.build.feats.filter(f => f.slotIndex !== feat.slotIndex), feat] } })),
  removeFeat: (slotIndex) =>
    set(s => ({ build: { ...s.build, feats: s.build.feats.filter(f => f.slotIndex !== slotIndex) } })),
  resetBuild: () => set({ build: { ...DEFAULT_BUILD } }),

  toggleStance: (name) =>
    set(s => {
      const cur = s.build.activeStances;
      const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name];
      return { build: { ...s.build, activeStances: next } };
    }),
  setStances: (names) =>
    set(s => ({ build: { ...s.build, activeStances: [...names] } })),

  setLevelClass: (level, classId) =>
    set(s => {
      const cur = resolveLevelClasses(s.build);
      // 1-indexed level → 0-indexed array slot. Allow extending by 1 (= +1 level).
      const idx = level - 1;
      if (idx < 0 || idx > cur.length) return s;
      const nextLevels = [...cur];
      nextLevels[idx] = classId;
      const nextClasses = aggregateClasses(nextLevels);
      return { build: { ...s.build, levelClasses: nextLevels, classes: nextClasses } };
    }),

  setAbilityTome: (stat, value) =>
    set(s => {
      const clamped = Math.max(0, Math.min(8, Math.floor(value)));
      const next = { ...(s.build.abilityTomes ?? {}) };
      if (clamped === 0) delete next[stat];
      else next[stat] = clamped;
      return { build: { ...s.build, abilityTomes: next } };
    }),

  setSkillTome: (skillId, value) =>
    set(s => {
      const clamped = Math.max(0, Math.min(5, Math.floor(value)));
      const next = { ...(s.build.skillTomes ?? {}) };
      if (clamped === 0) delete next[skillId];
      else next[skillId] = clamped;
      return { build: { ...s.build, skillTomes: next } };
    }),

  setLevelUp: (level, stat) =>
    set(s => {
      const next = { ...(s.build.levelUps ?? {}) };
      if (stat === null) delete next[level];
      else next[level] = stat;
      return { build: { ...s.build, levelUps: next } };
    }),

  setSpecialFeatRank: (featId, type, rank) =>
    set(s => {
      const clamped = Math.max(0, Math.floor(rank));
      const list = s.build.specialFeats ?? [];
      const idx = list.findIndex(f => f.featId === featId && f.type === type);
      let next: typeof list;
      if (clamped === 0) {
        next = idx >= 0 ? list.filter((_, i) => i !== idx) : list;
      } else if (idx >= 0) {
        next = list.map((f, i) => i === idx ? { ...f, rank: clamped } : f);
      } else {
        next = [...list, { featId, type, rank: clamped }];
      }
      return { build: { ...s.build, specialFeats: next } };
    }),

  equipItem: (slot, item) =>
    set(s => {
      // Locate (or create) the active gear set.
      const sets = s.build.gearSets;
      let activeName = s.build.activeGearSet;
      let activeIdx = sets.findIndex(g => g.name === activeName);
      let nextSets = sets;
      if (activeIdx < 0) {
        // No active set yet — create "Standard" and make it active.
        activeName = 'Standard';
        nextSets = [...sets, { name: activeName, items: [] }];
        activeIdx = nextSets.length - 1;
      }
      // Replace any existing item in the slot (slot is unique per set).
      const target = nextSets[activeIdx]!;
      const newItems = [...target.items.filter(it => it.slot !== slot), { ...item, slot }];
      const updatedSet = { ...target, items: newItems };
      const finalSets = nextSets.map((g, i) => i === activeIdx ? updatedSet : g);
      return { build: { ...s.build, gearSets: finalSets, activeGearSet: activeName } };
    }),

  unequipItem: (slot) =>
    set(s => {
      const sets = s.build.gearSets;
      const activeIdx = sets.findIndex(g => g.name === s.build.activeGearSet);
      if (activeIdx < 0) return s;
      const target = sets[activeIdx]!;
      const newItems = target.items.filter(it => it.slot !== slot);
      if (newItems.length === target.items.length) return s;   // no-op
      const updatedSet = { ...target, items: newItems };
      const finalSets = sets.map((g, i) => i === activeIdx ? updatedSet : g);
      return { build: { ...s.build, gearSets: finalSets } };
    }),

  setActiveGearSet: (name) =>
    set(s => ({ build: { ...s.build, activeGearSet: name } })),

  createGearSet: (name) =>
    set(s => {
      const trimmed = name.trim();
      if (!trimmed || s.build.gearSets.some(g => g.name === trimmed)) return s;
      return {
        build: {
          ...s.build,
          gearSets: [...s.build.gearSets, { name: trimmed, items: [] }],
          activeGearSet: trimmed,
        },
      };
    }),

  renameGearSet: (oldName, newName) =>
    set(s => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return s;
      // Reject duplicates (silent — caller validates).
      if (s.build.gearSets.some(g => g.name === trimmed)) return s;
      return {
        build: {
          ...s.build,
          gearSets: s.build.gearSets.map(g =>
            g.name === oldName ? { ...g, name: trimmed } : g),
          activeGearSet: s.build.activeGearSet === oldName ? trimmed : s.build.activeGearSet,
        },
      };
    }),

  duplicateGearSet: (srcName, newName) =>
    set(s => {
      const trimmed = newName.trim();
      const src = s.build.gearSets.find(g => g.name === srcName);
      if (!src || !trimmed || s.build.gearSets.some(g => g.name === trimmed)) return s;
      // Clone items by value (each item is a fresh object).
      const cloned = { name: trimmed, items: src.items.map(it => ({ ...it, buffs: [...it.buffs] })) };
      return {
        build: {
          ...s.build,
          gearSets: [...s.build.gearSets, cloned],
          activeGearSet: trimmed,
        },
      };
    }),

  deleteGearSet: (name) =>
    set(s => {
      const idx = s.build.gearSets.findIndex(g => g.name === name);
      if (idx < 0) return s;
      const remaining = s.build.gearSets.filter(g => g.name !== name);
      // If the deleted set was active, fall back to the first remaining set
      // (or empty string if no sets left).
      const nextActive = s.build.activeGearSet === name
        ? (remaining[0]?.name ?? '')
        : s.build.activeGearSet;
      return {
        build: { ...s.build, gearSets: remaining, activeGearSet: nextActive },
      };
    }),

  setItemAugment: (itemSlot, augmentSlotIdx, augmentName, levelIndex) =>
    set(s => {
      const sets = s.build.gearSets;
      const activeIdx = sets.findIndex(g => g.name === s.build.activeGearSet);
      if (activeIdx < 0) return s;
      const target = sets[activeIdx]!;
      const itemIdx = target.items.findIndex(it => it.slot === itemSlot);
      if (itemIdx < 0) return s;
      const item = target.items[itemIdx]!;
      const augSlots = item.augmentSlots ?? [];
      if (augmentSlotIdx < 0 || augmentSlotIdx >= augSlots.length) return s;
      const newAugSlots = augSlots.map((slot, i) =>
        i === augmentSlotIdx
          ? augmentName === null
            ? { slotType: slot.slotType }   // cleared
            : { slotType: slot.slotType, selectedAugment: augmentName, selectedLevelIndex: levelIndex }
          : slot
      );
      const newItem = { ...item, augmentSlots: newAugSlots };
      const newItems = target.items.map((it, i) => i === itemIdx ? newItem : it);
      const newSet = { ...target, items: newItems };
      const newSets = sets.map((g, i) => i === activeIdx ? newSet : g);
      return { build: { ...s.build, gearSets: newSets } };
    }),

  setFiligree: (target, slotIdx, filigreeName) =>
    set(s => {
      const sets = s.build.gearSets;
      const activeIdx = sets.findIndex(g => g.name === s.build.activeGearSet);
      if (activeIdx < 0) return s;
      const cur = sets[activeIdx]!;
      const cap = target === 'weapon' ? MAX_FILIGREE : MAX_ARTIFACT_FILIGREE;
      if (slotIdx < 0 || slotIdx >= cap) return s;
      const key = target === 'weapon' ? 'filigrees' : 'artifactFiligrees';
      const list = [...(cur[key] ?? [])];
      while (list.length <= slotIdx) list.push({});
      list[slotIdx] = filigreeName === null
        ? {}                                            // clear name + rare
        : { ...list[slotIdx], name: filigreeName };
      const newSet = { ...cur, [key]: list };
      const newSets = sets.map((g, i) => i === activeIdx ? newSet : g);
      return { build: { ...s.build, gearSets: newSets } };
    }),

  setFiligreeRare: (target, slotIdx, rare) =>
    set(s => {
      const sets = s.build.gearSets;
      const activeIdx = sets.findIndex(g => g.name === s.build.activeGearSet);
      if (activeIdx < 0) return s;
      const cur = sets[activeIdx]!;
      const key = target === 'weapon' ? 'filigrees' : 'artifactFiligrees';
      const list = [...(cur[key] ?? [])];
      if (slotIdx < 0 || slotIdx >= list.length) return s;
      const slot = list[slotIdx]!;
      if (!slot.name) return s;                         // can't rare an empty slot
      list[slotIdx] = { ...slot, rare: rare || undefined };
      const newSet = { ...cur, [key]: list };
      const newSets = sets.map((g, i) => i === activeIdx ? newSet : g);
      return { build: { ...s.build, gearSets: newSets } };
    }),

  trainSpell: (className, spellLevel, spellName) =>
    set(s => {
      const trainedSpells = { ...(s.build.trainedSpells ?? {}) };
      const byLevel = { ...(trainedSpells[className] ?? {}) };
      const key = String(spellLevel);
      const cur = byLevel[key] ?? [];
      if (cur.includes(spellName)) return s;
      byLevel[key] = [...cur, spellName];
      trainedSpells[className] = byLevel;
      return { build: { ...s.build, trainedSpells } };
    }),

  untrainSpell: (className, spellLevel, spellName) =>
    set(s => {
      const cur = s.build.trainedSpells?.[className]?.[String(spellLevel)] ?? [];
      if (!cur.includes(spellName)) return s;
      const trainedSpells = { ...(s.build.trainedSpells ?? {}) };
      const byLevel = { ...(trainedSpells[className] ?? {}) };
      byLevel[String(spellLevel)] = cur.filter(n => n !== spellName);
      trainedSpells[className] = byLevel;
      return { build: { ...s.build, trainedSpells } };
    }),

  toggleMetamagic: (name) =>
    set(s => {
      const cur = s.build.activeMetamagics ?? [];
      const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name];
      return { build: { ...s.build, activeMetamagics: next } };
    }),

  togglePartyBuff: (name) =>
    set(s => {
      const cur = s.build.activePartyBuffs ?? [];
      const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name];
      return { build: { ...s.build, activePartyBuffs: next } };
    }),

  setEnhancementTome: (kind, value) =>
    set(s => {
      const max = kind === 'racial' ? MAX_RACIAL_AP_TOME : MAX_UNIVERSAL_AP_TOME;
      const clamped = Math.max(0, Math.min(max, value));
      const cur = s.build.enhancementTomes ?? {};
      const next: { racial?: number; universal?: number } = { ...cur };
      if (clamped === 0) delete next[kind];
      else next[kind] = clamped;
      return { build: { ...s.build, enhancementTomes: next } };
    }),

  setTotalLevels: (totalLevel) =>
    set(s => {
      const clamped = Math.max(1, Math.min(40, totalLevel));
      const cur = resolveLevelClasses(s.build);
      let next = [...cur];
      if (clamped < cur.length) {
        next = next.slice(0, clamped);
      } else if (clamped > cur.length) {
        // Extend by repeating the last assigned class (or first defined class as fallback).
        const fill = cur[cur.length - 1] ?? s.build.classes[0]?.classId ?? 'fighter';
        while (next.length < clamped) next.push(fill);
      }
      const nextClasses = aggregateClasses(next);
      return { build: { ...s.build, levelClasses: next, classes: nextClasses } };
    }),

  setSelectedTrees: (trees) =>
    set(s => ({ build: { ...s.build, selectedEnhancementTrees: trees.slice(0, MAX_TREES) } })),

  toggleTree: (treeName) => {
    const { build } = get();
    const current = build.selectedEnhancementTrees;
    // User explicitly modified the selection — lock in their choice so the
    // auto-defaults effect stops overwriting it.
    if (current.includes(treeName)) {
      set(s => ({
        build: {
          ...s.build,
          selectedEnhancementTrees: current.filter(t => t !== treeName),
          enhancements: s.build.enhancements.filter(e => e.treeId !== treeName),
          treesManuallyOverridden: true,
        },
      }));
    } else if (current.length < MAX_TREES) {
      set(s => ({
        build: {
          ...s.build,
          selectedEnhancementTrees: [...current, treeName],
          treesManuallyOverridden: true,
        },
      }));
    }
  },

  spendEnhancement: (treeId, enhancementId, maxRanks, selection) => {
    // Per-pool caps (Standard / Racial / Universal) are enforced by the UI
    // — the EnhancementTreeGrid won't fire onSpend when the tree's pool is
    // exhausted. The legacy single-pool MAX_HEROIC_AP gate was wrong once
    // we split into three pools, so it's intentionally absent here.
    set(s => {
      const trees = s.build.enhancements;
      const treeIdx = trees.findIndex(t => t.treeId === treeId);
      const existing = treeIdx >= 0 ? trees[treeIdx] : null;
      const existingEnh = existing?.enhancements.find(e => e.enhancementId === enhancementId);

      if (existingEnh && existingEnh.rank >= maxRanks) return s;

      const newRank = (existingEnh?.rank ?? 0) + 1;
      const newEnh = { enhancementId, selection, tier: 0, rank: newRank };

      let newTrees: EnhancementSelection[];
      if (!existing) {
        newTrees = [...trees, { treeId, enhancements: [newEnh] }];
      } else {
        newTrees = trees.map(t =>
          t.treeId !== treeId ? t : {
            ...t,
            enhancements: existingEnh
              ? t.enhancements.map(e => e.enhancementId === enhancementId ? newEnh : e)
              : [...t.enhancements, newEnh],
          },
        );
      }
      return { build: { ...s.build, enhancements: newTrees } };
    });
  },

  revokeEnhancement: (treeId, enhancementId) => {
    set(s => {
      const newTrees = s.build.enhancements.map(t => {
        if (t.treeId !== treeId) return t;
        const newEnhs = t.enhancements
          .map(e => e.enhancementId === enhancementId ? { ...e, rank: e.rank - 1 } : e)
          .filter(e => e.rank > 0);
        return { ...t, enhancements: newEnhs };
      }).filter(t => t.enhancements.length > 0);
      return { build: { ...s.build, enhancements: newTrees } };
    });
  },

  resetTree: (treeId) => {
    set(s => ({
      build: {
        ...s.build,
        enhancements: s.build.enhancements.filter(t => t.treeId !== treeId),
      },
    }));
  },

  spendDestinyEnhancement: (treeId, enhancementId, maxRanks, selection) => {
    set(s => {
      const trees = s.build.destinyEnhancements;
      const treeIdx = trees.findIndex(t => t.treeId === treeId);
      const existing = treeIdx >= 0 ? trees[treeIdx] : null;
      const existingEnh = existing?.enhancements.find(e => e.enhancementId === enhancementId);
      if (existingEnh && existingEnh.rank >= maxRanks) return s;
      const newRank = (existingEnh?.rank ?? 0) + 1;
      const newEnh = { enhancementId, selection, tier: 0, rank: newRank };
      let newTrees: EnhancementSelection[];
      if (!existing) {
        newTrees = [...trees, { treeId, enhancements: [newEnh] }];
      } else {
        newTrees = trees.map(t =>
          t.treeId !== treeId ? t : {
            ...t,
            enhancements: existingEnh
              ? t.enhancements.map(e => e.enhancementId === enhancementId ? newEnh : e)
              : [...t.enhancements, newEnh],
          },
        );
      }
      return { build: { ...s.build, destinyEnhancements: newTrees } };
    });
  },

  revokeDestinyEnhancement: (treeId, enhancementId) => {
    set(s => {
      const newTrees = s.build.destinyEnhancements.map(t => {
        if (t.treeId !== treeId) return t;
        const newEnhs = t.enhancements
          .map(e => e.enhancementId === enhancementId ? { ...e, rank: e.rank - 1 } : e)
          .filter(e => e.rank > 0);
        return { ...t, enhancements: newEnhs };
      }).filter(t => t.enhancements.length > 0);
      return { build: { ...s.build, destinyEnhancements: newTrees } };
    });
  },

  resetDestinyTree: (treeId) => {
    set(s => ({
      build: {
        ...s.build,
        destinyEnhancements: s.build.destinyEnhancements.filter(t => t.treeId !== treeId),
      },
    }));
  },

  spendReaperEnhancement: (treeId, enhancementId, maxRanks, selection) => {
    set(s => {
      const trees = s.build.reaperEnhancements;
      const treeIdx = trees.findIndex(t => t.treeId === treeId);
      const existing = treeIdx >= 0 ? trees[treeIdx] : null;
      const existingEnh = existing?.enhancements.find(e => e.enhancementId === enhancementId);
      if (existingEnh && existingEnh.rank >= maxRanks) return s;
      const newRank = (existingEnh?.rank ?? 0) + 1;
      const newEnh = { enhancementId, selection, tier: 0, rank: newRank };
      let newTrees: EnhancementSelection[];
      if (!existing) {
        newTrees = [...trees, { treeId, enhancements: [newEnh] }];
      } else {
        newTrees = trees.map(t =>
          t.treeId !== treeId ? t : {
            ...t,
            enhancements: existingEnh
              ? t.enhancements.map(e => e.enhancementId === enhancementId ? newEnh : e)
              : [...t.enhancements, newEnh],
          },
        );
      }
      return { build: { ...s.build, reaperEnhancements: newTrees } };
    });
  },

  revokeReaperEnhancement: (treeId, enhancementId) => {
    set(s => {
      const newTrees = s.build.reaperEnhancements.map(t => {
        if (t.treeId !== treeId) return t;
        const newEnhs = t.enhancements
          .map(e => e.enhancementId === enhancementId ? { ...e, rank: e.rank - 1 } : e)
          .filter(e => e.rank > 0);
        return { ...t, enhancements: newEnhs };
      }).filter(t => t.enhancements.length > 0);
      return { build: { ...s.build, reaperEnhancements: newTrees } };
    });
  },

  resetReaperTree: (treeId) => {
    set(s => ({
      build: {
        ...s.build,
        reaperEnhancements: s.build.reaperEnhancements.filter(t => t.treeId !== treeId),
      },
    }));
  },
}));
