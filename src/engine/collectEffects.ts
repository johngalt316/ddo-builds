// Build → Effect[] aggregator.
//
// Walks a build state and collects every Effect that should fire, paired
// with a human-readable source label for the breakdown UI.
//
// MVP scope (Phase 2 first slice): selected feats + class automatic-feats only.
// Deferred (later slices, in priority order):
//   - Enhancement effects (per spent rank, per selection)
//   - Destiny effects (same shape as enhancements)
//   - Item buffs (resolve through itemBuffs.json catalog → Effect[])
//   - Set bonuses (count equipped pieces per set, fire matching tiers)
//   - Stances (when build state tracks active stances)

import type { Build, EnhancementSelection, GearItem } from '@/types/build';
import type {
  DDOClassData, DDOFeatData, DDORaceData, DDOEffect,
  EnhancementTreeData, EnhancementItemData, ItemBuffCatalog,
  DDOSetBonusData,
} from '@/types/ddoData';
import { instantiateItemBuff, lookupItemBuff } from './itemBuffResolver';

export interface SourcedEffect {
  effect: DDOEffect;
  /** Human-readable origin: "Toughness feat", "Fighter level 1 grants Cleave", etc. */
  source: string;
  /** Number of ranks/copies of this source. Used by enhancements; 1 for feats. */
  rankCount: number;
}

interface CollectInputs {
  build: Build;
  feats: DDOFeatData[];
  classes: DDOClassData[];
  races: DDORaceData[];
  enhancementTrees: EnhancementTreeData[];
  itemBuffs: ItemBuffCatalog;
  setBonuses: DDOSetBonusData[];
  /** Item name → set name fallback (for .DDOBuild files missing SetBonus). */
  itemSetIndex: Record<string, string>;
}

/** Pick the active gear set out of build.gearSets. Falls back to first set. */
function pickActiveGearSet(build: Build): GearItem[] {
  if (build.gearSets.length === 0) return [];
  const named = build.gearSets.find(s => s.name === build.activeGearSet);
  return (named ?? build.gearSets[0]!).items;
}

/** Walk the active gear set, resolving each item buff through the catalog. */
function walkActiveGear(
  build: Build,
  catalog: ItemBuffCatalog,
  unmatchedItemBuffs: Set<string>,
): SourcedEffect[] {
  const out: SourcedEffect[] = [];
  const items = pickActiveGearSet(build);

  for (const item of items) {
    for (const buff of item.buffs) {
      if (!buff.type) continue;
      const entry = lookupItemBuff(catalog, buff.type);
      if (!entry) {
        unmatchedItemBuffs.add(buff.type);
        continue;
      }
      const effects = instantiateItemBuff(entry, buff);
      for (const eff of effects) {
        out.push({
          effect: eff,
          source: `[G] ${item.slot}: ${item.name}${buff.item ? ` (${buff.type}: ${buff.item})` : ` (${buff.type})`}`,
          rankCount: 1,
        });
      }
    }
  }

  return out;
}

/**
 * Count equipped pieces per set across the active gear set, then fire each
 * SetBonus's <Buff> tiers whose equippedCount threshold is met. Uses
 * `item.setBonus` first (parsed from the .DDOBuild) and falls back to the
 * item-name → set lookup index (the .DDOBuild often omits SetBonus even for
 * items that belong to a named set).
 */
function walkSetBonuses(
  build: Build,
  setBonuses: DDOSetBonusData[],
  itemSetIndex: Record<string, string>,
  unmatchedSets: Set<string>,
): SourcedEffect[] {
  const items = pickActiveGearSet(build);

  // Count pieces per set name.
  const counts = new Map<string, number>();
  for (const item of items) {
    const setName = item.setBonus ?? itemSetIndex[item.name];
    if (!setName) continue;
    counts.set(setName, (counts.get(setName) ?? 0) + 1);
  }

  // Index set bonuses by name for lookup.
  const setIdx = new Map<string, DDOSetBonusData>();
  for (const sb of setBonuses) setIdx.set(sb.type, sb);

  const out: SourcedEffect[] = [];
  for (const [setName, count] of counts) {
    const sb = setIdx.get(setName);
    if (!sb) {
      unmatchedSets.add(setName);
      continue;
    }
    for (const buff of sb.buffs) {
      if (buff.equippedCount > count) continue;   // tier not yet active
      const tierLabel = `${setName} (${count}-piece tier ≥ ${buff.equippedCount})`;
      for (const eff of buff.effects) {
        out.push({
          effect: eff,
          source: `[S] ${tierLabel}`,
          rankCount: 1,
        });
      }
    }
  }
  return out;
}

/** Build a map: lowercased name → DDOFeatData for fast lookup. */
function indexFeats(feats: DDOFeatData[]): Map<string, DDOFeatData> {
  const m = new Map<string, DDOFeatData>();
  for (const f of feats) m.set(f.name.toLowerCase(), f);
  return m;
}

/** classId (normalized lowercase + underscores) → DDOClassData. */
function indexClasses(classes: DDOClassData[]): Map<string, DDOClassData> {
  const m = new Map<string, DDOClassData>();
  for (const c of classes) {
    m.set(c.name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_'), c);
  }
  return m;
}

/** Index trees by tree name (case-insensitive) for fast lookup. */
function indexTrees(trees: EnhancementTreeData[]): Map<string, EnhancementTreeData> {
  const m = new Map<string, EnhancementTreeData>();
  for (const t of trees) m.set(t.name.toLowerCase(), t);
  return m;
}

/** Find an enhancement item within a tree by internalName (preferred) or display name. */
function findItem(tree: EnhancementTreeData, id: string): EnhancementItemData | undefined {
  return tree.items.find(i => i.internalName === id)
      ?? tree.items.find(i => i.name === id);
}

/**
 * Walk a tree-spend block (heroic enhancements OR destiny enhancements).
 * Emits effects per (item, rank) — selection effects when the user picked
 * a selector option, item effects otherwise.
 */
function walkTreeSpend(
  treeSpend: EnhancementSelection[],
  trees: Map<string, EnhancementTreeData>,
  sourceLabelPrefix: string,
  unmatchedTrees: Set<string>,
  unmatchedEnhancements: Set<string>,
): SourcedEffect[] {
  const out: SourcedEffect[] = [];

  for (const tspend of treeSpend) {
    const tree = trees.get(tspend.treeId.toLowerCase());
    if (!tree) {
      unmatchedTrees.add(tspend.treeId);
      continue;
    }
    for (const enh of tspend.enhancements) {
      if (enh.rank <= 0) continue;
      const item = findItem(tree, enh.enhancementId);
      if (!item) {
        unmatchedEnhancements.add(`${tspend.treeId}/${enh.enhancementId}`);
        continue;
      }

      const sourceBase = `${sourceLabelPrefix} ${tree.name}: ${item.name}`;

      // Selection effects fire instead of item effects when a Selector is present.
      if (item.selector && enh.selection) {
        const sel = item.selector.find(s => s.name === enh.selection);
        if (!sel) {
          unmatchedEnhancements.add(`${tspend.treeId}/${enh.enhancementId}/${enh.selection}`);
          continue;
        }
        for (const eff of sel.effects) {
          out.push({
            effect: eff,
            source: `${sourceBase} → ${sel.name}`,
            rankCount: enh.rank,
          });
        }
        continue;
      }

      // Plain enhancement: emit each item effect once with rankCount=rank.
      for (const eff of item.effects) {
        out.push({
          effect: eff,
          source: sourceBase,
          rankCount: enh.rank,
        });
      }
    }
  }

  return out;
}

/** Phase-2-MVP collector. Returns the effects + a parallel "unmodeled" tally. */
export function collectEffects(input: CollectInputs): {
  effects: SourcedEffect[];
  /** Selected feats whose name didn't match anything in Feats.xml — silent gaps. */
  unmatchedFeats: string[];
  /** Tree names from the build that we couldn't find in the loaded enhancement-tree data. */
  unmatchedTrees: string[];
  /** "treeName/internalName" pairs that the build references but aren't in the tree definition. */
  unmatchedEnhancements: string[];
  /** Item buff types that didn't resolve against itemBuffs.json. */
  unmatchedItemBuffs: string[];
  /** Set names referenced by gear that didn't match SetBonuses.xml. */
  unmatchedSets: string[];
} {
  const { build, feats, classes, enhancementTrees, itemBuffs, setBonuses, itemSetIndex } = input;
  const featIdx  = indexFeats(feats);
  const classIdx = indexClasses(classes);
  const treeIdx  = indexTrees(enhancementTrees);

  const out: SourcedEffect[] = [];
  const unmatched: string[] = [];
  const unmatchedTrees = new Set<string>();
  const unmatchedEnhancements = new Set<string>();
  const unmatchedItemBuffs = new Set<string>();
  const unmatchedSets = new Set<string>();

  // ── 1. Selected feats ──────────────────────────────────────────────
  // build.feats is a list of { slotIndex, featId } — featId is the feat
  // *name* as it came from the .DDOBuild parser.
  for (const sel of build.feats) {
    const data = featIdx.get(sel.featId.toLowerCase());
    if (!data) {
      unmatched.push(sel.featId);
      continue;
    }
    for (const eff of data.effects) {
      out.push({ effect: eff, source: data.name, rankCount: 1 });
    }
  }

  // ── 2. Class automatic feats ───────────────────────────────────────
  // Each class XML lists per-level grants. For each (class, levelsTaken)
  // pair we replay the grants up to that level.
  for (const cls of build.classes) {
    const cdata = classIdx.get(cls.classId);
    if (!cdata) continue;
    for (const grant of cdata.automaticFeats) {
      if (grant.level > cls.levels) continue;
      for (const featName of grant.feats) {
        const data = featIdx.get(featName.toLowerCase());
        if (!data) {
          unmatched.push(featName);
          continue;
        }
        for (const eff of data.effects) {
          out.push({
            effect: eff,
            source: `${cdata.name} ${grant.level}: ${data.name}`,
            rankCount: 1,
          });
        }
      }
    }
  }

  // ── 3. Heroic enhancements ─────────────────────────────────────────
  out.push(...walkTreeSpend(
    build.enhancements, treeIdx, '[E]',
    unmatchedTrees, unmatchedEnhancements,
  ));

  // ── 4. Epic destinies ──────────────────────────────────────────────
  out.push(...walkTreeSpend(
    build.destinyEnhancements, treeIdx, '[D]',
    unmatchedTrees, unmatchedEnhancements,
  ));

  // ── 5. Active gear set (item buffs resolved through catalog) ──────
  out.push(...walkActiveGear(build, itemBuffs, unmatchedItemBuffs));

  // ── 6. Set bonuses (count pieces, fire matching tiers) ────────────
  out.push(...walkSetBonuses(build, setBonuses, itemSetIndex, unmatchedSets));

  // ── 7. Special feats (past lives, racial PL, iconic PL, etc.) ─────
  // Each rank fires the feat's effects with rankCount=rank, so per-rank
  // effects (Stacks AmountType) scale, and per-instance effects multiply.
  for (const sf of build.specialFeats ?? []) {
    if (sf.rank <= 0) continue;
    const data = featIdx.get(sf.featId.toLowerCase());
    if (!data) {
      unmatched.push(sf.featId);
      continue;
    }
    for (const eff of data.effects) {
      out.push({
        effect: eff,
        source: `[PL] ${sf.featId}${sf.rank > 1 ? ` ×${sf.rank}` : ''}`,
        rankCount: sf.rank,
      });
    }
  }

  return {
    effects: out,
    unmatchedFeats: unmatched,
    unmatchedTrees: [...unmatchedTrees],
    unmatchedEnhancements: [...unmatchedEnhancements],
    unmatchedItemBuffs: [...unmatchedItemBuffs].sort(),
    unmatchedSets: [...unmatchedSets].sort(),
  };
}

/**
 * Build a `BuildContext` from raw build state + game data. This is the
 * input every per-stat breakdown consumes.
 */
export function buildBuildContext(input: {
  build: Build;
  classes: DDOClassData[];
  effectiveScores: Record<string, number>;
  bab: number;
}): import('./evaluateEffect').BuildContext {
  const { build, classes, effectiveScores, bab } = input;
  const classIdx = indexClasses(classes);

  const totalLevel = build.classes.reduce((s, c) => s + c.levels, 0);

  const classLevels = new Map<string, number>();
  const baseClassLevels = new Map<string, number>();
  for (const cl of build.classes) {
    classLevels.set(cl.classId, cl.levels);
    const data = classIdx.get(cl.classId);
    if (data?.baseClass) {
      const baseId = data.baseClass.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
      baseClassLevels.set(baseId, Math.max(baseClassLevels.get(baseId) ?? 0, cl.levels));
    }
    // Class also counts as its own base
    baseClassLevels.set(cl.classId, Math.max(baseClassLevels.get(cl.classId) ?? 0, cl.levels));
  }

  const apSpentInTree = new Map<string, number>();
  for (const tree of build.enhancements) {
    const ap = tree.enhancements.reduce((s, e) => s + e.rank, 0);
    apSpentInTree.set(tree.treeId.toLowerCase(), ap);
  }

  return {
    totalLevel,
    classLevels,
    baseClassLevels,
    raceId: build.raceId,
    raceName: build.raceId.replace(/_/g, ' '),
    feats: new Set(build.feats.map(f => f.featId)),
    abilityScores: effectiveScores,
    bab,
    apSpentInTree,
    activeStances: new Set(build.activeStances ?? []),
  };
}
