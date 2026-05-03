import { create } from 'zustand';
import type { AbilityScores, Alignment, Build, ClassLevel, EnhancementSelection, SelectedFeat, Stat } from '@/types/build';
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
}

function apSpent(enhancements: EnhancementSelection[]): number {
  return enhancements.reduce(
    (sum, t) => sum + t.enhancements.reduce((s, e) => s + e.rank, 0),
    0,
  );
}

function apSpentInTree(treeId: string, enhancements: EnhancementSelection[]): number {
  return enhancements.find(t => t.treeId === treeId)
    ?.enhancements.reduce((s, e) => s + e.rank, 0) ?? 0;
}

export { apSpent, apSpentInTree, MAX_HEROIC_AP };
export const MAX_DESTINY_AP = 336;
export const MAX_DESTINY_TREES = 3; // MAX_DESTINY_TREES in DDOBuilderV2 stdafx.h

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
    if (current.includes(treeName)) {
      set(s => ({
        build: {
          ...s.build,
          selectedEnhancementTrees: current.filter(t => t !== treeName),
          enhancements: s.build.enhancements.filter(e => e.treeId !== treeName),
        },
      }));
    } else if (current.length < MAX_TREES) {
      set(s => ({ build: { ...s.build, selectedEnhancementTrees: [...current, treeName] } }));
    }
  },

  spendEnhancement: (treeId, enhancementId, maxRanks, selection) => {
    const { build } = get();
    const totalAP = apSpent(build.enhancements);
    if (totalAP >= MAX_HEROIC_AP) return;

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
}));
