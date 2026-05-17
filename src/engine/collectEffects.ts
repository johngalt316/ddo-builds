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

import type { Build, EnhancementSelection, FiligreeSlot, GearItem } from '@/types/build';
import { getActiveEnhancementSet } from '@/types/build';
import type {
  DDOClassData, DDOFeatData, DDORaceData, DDOEffect, DDOStanceData,
  EnhancementTreeData, EnhancementItemData, ItemBuffCatalog,
  DDOSetBonusData, DDOAugmentData, DDOFiligreeData, DDOFiligreeSetBonus,
  DDOOptionalBuff, DDORequirements, DDOGuildBuff,
} from '@/types/ddoData';
import { instantiateItemBuff, lookupItemBuff } from './itemBuffResolver';

/**
 * True when the build has at least one heroic past life from each base class
 * group (incl. archetypes). Mirrors DDOBuilderV2's dynamic Completionist
 * requirement (DDOBuilder.cpp::Completionist activation).
 */
function qualifiesForCompletionist(build: Build, classes: DDOClassData[]): boolean {
  // Build map: baseClassName → set of valid PL feat names (base + archetypes)
  // We only need ONE of those PL feats present at rank ≥ 1.
  const groups = new Map<string, Set<string>>();
  for (const c of classes) {
    if (c.notHeroic) continue;
    if (c.name === 'Unknown') continue;   // catalog has an 'Unknown' placeholder class
    const base = c.baseClass || c.name;
    const featNames = groups.get(base) ?? new Set<string>();
    if (c.baseClass) {
      featNames.add(`Past Life: ${c.baseClass} - ${c.name}`);
    } else {
      featNames.add(`Past Life: ${c.name}`);
    }
    groups.set(base, featNames);
  }
  if (groups.size === 0) return false;
  const have = new Map((build.specialFeats ?? [])
    .filter(sf => sf.type === 'HeroicPastLife' && sf.rank >= 1)
    .map(sf => [sf.featId, sf.rank] as const));
  for (const [, featNames] of groups) {
    let any = false;
    for (const fn of featNames) if (have.has(fn)) { any = true; break; }
    if (!any) return false;
  }
  return true;
}

/**
 * True when the build has 3 ranks of every non-iconic racial past life.
 * Mirrors DDOBuilderV2's dynamic Racial Completionist requirement.
 */
function qualifiesForRacialCompletionist(build: Build, races: DDORaceData[]): boolean {
  const required: string[] = [];
  for (const r of races) {
    if (r.iconic) continue;
    if (r.noPastLife) continue;
    required.push(`Past Life: ${r.name}`);
  }
  if (required.length === 0) return false;
  const have = new Map((build.specialFeats ?? [])
    .filter(sf => sf.type === 'RacialPastLife')
    .map(sf => [sf.featId, sf.rank] as const));
  for (const fn of required) {
    if ((have.get(fn) ?? 0) < 3) return false;
  }
  return true;
}

/**
 * Merge a feat's `<AutomaticAcquisition>` block into an effect's own
 * `<Requirements>` so the gate fires through evaluateEffect's existing
 * requirement plumbing. AND-semantics: all AA requirements must pass on
 * top of any per-effect ones.
 */
function mergeAARequirements(
  effReqs: DDORequirements,
  aa: DDORequirements | undefined,
): DDORequirements {
  if (!aa) return effReqs;
  return {
    allOf: [...effReqs.allOf, ...aa.allOf],
    oneOf: [...effReqs.oneOf, ...aa.oneOf],
    noneOf: [...effReqs.noneOf, ...aa.noneOf],
  };
}

/** AND-merge two requirement blocks. Used to inherit a GrantFeat effect's own
 *  gates onto the granted feat's effects, so race/class/level gating on the
 *  grant flows through to the inherited bonuses. */
function mergeRequirements(
  a: DDORequirements,
  b: DDORequirements,
): DDORequirements {
  return {
    allOf:  [...a.allOf,  ...b.allOf],
    oneOf:  [...a.oneOf,  ...b.oneOf],
    noneOf: [...a.noneOf, ...b.noneOf],
  };
}

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
  augments: DDOAugmentData[];
  filigrees: DDOFiligreeData[];
  filigreeSetBonuses: DDOFiligreeSetBonus[];
  selfPartyBuffs: DDOOptionalBuff[];
  /** Guild buffs from GuildBuffs.xml. Engine fires those whose `level` ≤
   *  `build.guildLevel` when `build.applyGuildBuffs` is true. */
  guildBuffs?: DDOGuildBuff[];
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
          // All gear-derived effects compete via Highest-Only stacking, even
          // if their underlying ItemBuffs.xml template doesn't carry
          // <ApplyAsItemEffect/>.
          effect: { ...eff, isApplyAsItemEffect: true },
          source: `[G] ${item.slot}: ${item.name}${buff.item ? ` (${buff.type}: ${buff.item})` : ` (${buff.type})`}`,
          rankCount: 1,
        });
      }
    }
  }

  return out;
}

/**
 * Walk all augments equipped on items in the active gear set and emit
 * their effects. Each item's augment slot may hold a `selectedAugment`;
 * we look it up in the augment catalog and fire its `effects[]`.
 *
 * Scaling augments use `selectedLevelIndex` to pick a tier from the
 * augment's `levelValues[]` array. The effect's amount is overridden
 * with that tier value if the index is within range.
 */
function walkAugments(
  build: Build,
  augments: DDOAugmentData[],
  unmatchedAugments: Set<string>,
): SourcedEffect[] {
  const items = pickActiveGearSet(build);
  if (items.length === 0) return [];
  const augIdx = new Map<string, DDOAugmentData>();
  for (const a of augments) augIdx.set(a.name, a);

  const out: SourcedEffect[] = [];
  for (const item of items) {
    for (const slot of item.augmentSlots ?? []) {
      const sel = slot.selectedAugment;
      if (!sel) continue;
      const aug = augIdx.get(sel);
      if (!aug) {
        unmatchedAugments.add(sel);
        continue;
      }
      // Resolve the scaling tier value if the augment is variable-power.
      let tierValue: number | undefined;
      if (aug.scalesWithLevel && slot.selectedLevelIndex !== undefined) {
        tierValue = aug.levelValues[slot.selectedLevelIndex];
      }
      for (const eff of aug.effects) {
        const base = tierValue !== undefined
          // Override the amount table with the tier value.
          ? { ...eff, amount: [tierValue], amountType: 'Simple' as const }
          : eff;
        // Augments are slotted INTO items and follow the same Highest-Only
        // stacking rules as their host item's natural buffs. Three sources
        // of Insightful Con (one helm augment, one bracer augment, one
        // glove natural buff) should resolve to just the highest, not sum.
        out.push({
          effect: { ...base, isApplyAsItemEffect: true },
          source: `[A] ${item.slot}: ${item.name} → ${sel}`,
          rankCount: 1,
        });
      }
    }
  }
  return out;
}

/**
 * Walk equipped filigrees on the active gear set's weapon and artifact
 * sockets. Each filled slot fires its filigree's effects (rare-tagged
 * effects gate on the slot's `rare` flag). Slots are also counted per
 * filigree-set name to fire matching set-tier buffs.
 */
function walkFiligrees(
  build: Build,
  filigrees: DDOFiligreeData[],
  setBonuses: DDOFiligreeSetBonus[],
  unmatchedFiligrees: Set<string>,
  unmatchedFiligreeSets: Set<string>,
): SourcedEffect[] {
  const active = build.gearSets.find(g => g.name === build.activeGearSet);
  if (!active) return [];

  const filIdx = new Map<string, DDOFiligreeData>();
  for (const f of filigrees) filIdx.set(f.name, f);

  const out: SourcedEffect[] = [];
  const setCounts = new Map<string, number>();

  function walkSlots(slots: FiligreeSlot[], label: string) {
    for (const slot of slots) {
      if (!slot.name) continue;
      const f = filIdx.get(slot.name);
      if (!f) {
        unmatchedFiligrees.add(slot.name);
        continue;
      }
      if (f.setBonus) setCounts.set(f.setBonus, (setCounts.get(f.setBonus) ?? 0) + 1);
      for (const eff of f.effects) {
        if (eff.rare && !slot.rare) continue;
        out.push({
          effect: { ...eff, isApplyAsItemEffect: true },
          source: `[F${label}] ${f.name}${eff.rare ? ' (rare)' : ''}`,
          rankCount: 1,
        });
      }
    }
  }
  walkSlots(active.filigrees ?? [], '');
  walkSlots(active.artifactFiligrees ?? [], 'A');

  // Filigree set-bonus tiers (mirror item set-bonus walker).
  const sbIdx = new Map<string, DDOFiligreeSetBonus>();
  for (const sb of setBonuses) sbIdx.set(sb.name, sb);
  for (const [setName, count] of setCounts) {
    const sb = sbIdx.get(setName);
    if (!sb) {
      unmatchedFiligreeSets.add(setName);
      continue;
    }
    for (const buff of sb.buffs) {
      if (buff.equippedCount > count) continue;
      for (const eff of buff.effects) {
        out.push({
          effect: { ...eff, isApplyAsItemEffect: true },
          source: `[FS] ${setName} (${count}-piece tier ≥ ${buff.equippedCount})`,
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
  augments: DDOAugmentData[],
  unmatchedSets: Set<string>,
): SourcedEffect[] {
  const items = pickActiveGearSet(build);

  // Some augments grant a set-bonus tag to their host item (Lost Purpose's
  // Devil's Infernal Dance, Armaments of the Archons, etc.). Build a quick
  // lookup so we can read each augment's setBonus by name.
  const augSetByName = new Map<string, string>();
  for (const a of augments) {
    if (a.setBonus) augSetByName.set(a.name, a.setBonus);
  }

  // Count pieces per set name. Each equipped item contributes at most ONE
  // tick per distinct set (matches the in-game rule — slotting two of the
  // same set augment on one item doesn't double-count).
  const counts = new Map<string, number>();
  for (const item of items) {
    const setsOnItem = new Set<string>();
    const direct = item.setBonus ?? itemSetIndex[item.name];
    if (direct) setsOnItem.add(direct);
    for (const slot of item.augmentSlots ?? []) {
      if (!slot.selectedAugment) continue;
      const sb = augSetByName.get(slot.selectedAugment);
      if (sb) setsOnItem.add(sb);
    }
    for (const setName of setsOnItem) {
      counts.set(setName, (counts.get(setName) ?? 0) + 1);
    }
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
          // Set bonuses are gear-derived: subject to Highest-Only stacking.
          effect: { ...eff, isApplyAsItemEffect: true },
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

      // Outer item-level effects always fire (e.g. AT "Not Half Bad..." has
      // a +5 UniversalSpellLore at the EnhancementTreeItem level that applies
      // regardless of which selection the user picked).
      for (const eff of item.effects) {
        out.push({
          effect: eff,
          source: sourceBase,
          rankCount: enh.rank,
        });
      }

      // Selection effects layer on top of the item-level effects when a
      // Selector is present and the user picked one.
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
      }
    }
  }

  return out;
}

/** Phase-2-MVP collector. Returns the effects + a parallel "unmodeled" tally. */
export function collectEffects(input: CollectInputs): {
  effects: SourcedEffect[];
  /** Feat names granted via <Type>GrantFeat</Type> from enhancements / classes
   *  / races. Caller (runEngine) merges these into ctx.feats so downstream
   *  <Type>Feat</Type> requirements on the granted feats pass. */
  grantedFeats: string[];
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
  /** Augment names equipped on items but not found in the augment catalog. */
  unmatchedAugments: string[];
  /** Filigree names found on slots but not in the catalog. */
  unmatchedFiligrees: string[];
  /** Filigree set names referenced by equipped filigrees but not in the catalog. */
  unmatchedFiligreeSets: string[];
} {
  const {
    build, feats, classes, races, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex, augments,
    filigrees, filigreeSetBonuses,
    guildBuffs,
  } = input;
  const featIdx  = indexFeats(feats);
  const classIdx = indexClasses(classes);
  const treeIdx  = indexTrees(enhancementTrees);

  const out: SourcedEffect[] = [];
  const unmatched: string[] = [];
  const unmatchedTrees = new Set<string>();
  const unmatchedEnhancements = new Set<string>();
  const unmatchedItemBuffs = new Set<string>();
  const unmatchedSets = new Set<string>();
  const unmatchedAugments = new Set<string>();
  const unmatchedFiligrees = new Set<string>();
  const unmatchedFiligreeSets = new Set<string>();

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
      out.push({ effect: eff, source: `[F] ${data.name}`, rankCount: 1 });
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
            source: `[F] ${cdata.name} ${grant.level}: ${data.name}`,
            rankCount: 1,
          });
        }
      }
    }
  }

  // ── 2.5. Epic / Legendary class auto-feats ────────────────────────
  // Epic and Legendary are pseudo-classes (not in build.classes); their
  // levels live on build.epicLevels. DDO assigns char levels 21-30 to Epic
  // and 31-40 to Legendary. Walk each pseudo-class for the corresponding
  // level count so feats like Epic Power (granted every Epic level) fire.
  if ((build.epicLevels ?? 0) > 0) {
    const totalPostHeroic = build.epicLevels!;
    const epicCount = Math.min(10, totalPostHeroic);
    const legendaryCount = Math.max(0, totalPostHeroic - 10);
    const pseudo: { id: string; count: number }[] = [
      { id: 'epic', count: epicCount },
      { id: 'legendary', count: legendaryCount },
    ];
    for (const p of pseudo) {
      if (p.count <= 0) continue;
      const cdata = classIdx.get(p.id);
      if (!cdata) continue;
      for (const grant of cdata.automaticFeats) {
        if (grant.level > p.count) continue;
        for (const featName of grant.feats) {
          const data = featIdx.get(featName.toLowerCase());
          if (!data) {
            unmatched.push(featName);
            continue;
          }
          for (const eff of data.effects) {
            out.push({
              effect: eff,
              source: `[F] ${cdata.name} ${grant.level}: ${data.name}`,
              rankCount: 1,
            });
          }
        }
      }
    }
  }

  // ── 2.6. Improved Heroic Durability per heroic class (DDOBuilderV2's
  // dynamic ImprovedHeroicDurabilityFeats template). Each heroic class at
  // levels 5/10/15 grants the +5 HP bonus. Iconic past lives count too
  // because they're heroic classes; pseudo-classes (epic/legendary) don't.
  {
    const ihd = featIdx.get('improved heroic durability');
    if (ihd) {
      for (const cls of build.classes) {
        const cdata = classIdx.get(cls.classId);
        if (!cdata) continue;
        for (const milestone of [5, 10, 15]) {
          if (cls.levels < milestone) continue;
          for (const eff of ihd.effects) {
            out.push({
              effect: eff,
              source: `[F] Improved Heroic Durability (${cdata.name} ${milestone})`,
              rankCount: 1,
            });
          }
        }
      }
    }
  }

  // ── 2b. Global Automatic feats with AutomaticAcquisition gates ────
  // Feats.xml entries with <Acquire>Automatic</Acquire> + <AutomaticAcquisition>
  // apply to every character whose AA gate passes (e.g. Heroic Durability
  // at SpecificLevel=1).
  //
  // Feats with `Automatic` acquire but NO AA gate are class-grant templates
  // (Epic Power, Improved Heroic Durability, Greater Rage, etc.) — they fire
  // through step 2's class auto-feat grants, not here. Per-effect
  // <Requirements> on the AA-gated effects still gate via evaluateEffect.
  //
  // Completionist & Racial Completionist have dynamic-runtime requirements
  // (DDOBuilderV2 builds them in C++). We replicate the eligibility check
  // here so we don't fire them for builds that don't qualify.
  const heroicComplete = qualifiesForCompletionist(build, classes);
  const racialComplete = qualifiesForRacialCompletionist(build, races);
  const seenAutomatic = new Set<string>();
  for (const f of feats) {
    if (f.acquire !== 'Automatic') continue;
    if (!f.automaticAcquisition || f.automaticAcquisition.allOf.length === 0) continue;
    if (seenAutomatic.has(f.name)) continue;
    seenAutomatic.add(f.name);
    if (f.effects.length === 0) continue;
    if (f.name === 'Completionist' && !heroicComplete) continue;
    if (f.name === 'Racial Completionist' && !racialComplete) continue;
    for (const eff of f.effects) {
      out.push({
        effect: { ...eff, requirements: mergeAARequirements(eff.requirements, f.automaticAcquisition) },
        source: `[F] ${f.name}`,
        rankCount: 1,
      });
    }
  }

  const activeSet = getActiveEnhancementSet(build);
  // ── 3. Heroic enhancements ─────────────────────────────────────────
  out.push(...walkTreeSpend(
    activeSet.enhancements, treeIdx, '[E]',
    unmatchedTrees, unmatchedEnhancements,
  ));

  // ── 4. Epic destinies ──────────────────────────────────────────────
  out.push(...walkTreeSpend(
    activeSet.destinyEnhancements, treeIdx, '[D]',
    unmatchedTrees, unmatchedEnhancements,
  ));

  // ── 4b. Reaper enhancements ────────────────────────────────────────
  out.push(...walkTreeSpend(
    activeSet.reaperEnhancements, treeIdx, '[R]',
    unmatchedTrees, unmatchedEnhancements,
  ));

  // ── 5. Active gear set (item buffs resolved through catalog) ──────
  out.push(...walkActiveGear(build, itemBuffs, unmatchedItemBuffs));

  // ── 6. Set bonuses (count pieces, fire matching tiers) ────────────
  out.push(...walkSetBonuses(build, setBonuses, itemSetIndex, augments, unmatchedSets));

  // ── 6b. Augments equipped in item augment slots ───────────────────
  out.push(...walkAugments(build, augments, unmatchedAugments));

  // ── 6c. Filigrees on weapon + artifact + filigree set tiers ───────
  out.push(...walkFiligrees(
    build, filigrees, filigreeSetBonuses,
    unmatchedFiligrees, unmatchedFiligreeSets,
  ));

  // ── 6d. Active self/party buffs (Bless, Haste, Recitation, …) ─────
  // Build state lists active buff names; we look them up in the catalog
  // and fire their effects.
  if ((build.activePartyBuffs?.length ?? 0) > 0) {
    const buffIdx = new Map<string, DDOOptionalBuff>();
    for (const b of input.selfPartyBuffs) buffIdx.set(b.name, b);
    for (const buffName of build.activePartyBuffs ?? []) {
      const b = buffIdx.get(buffName);
      if (!b) continue;
      for (const eff of b.effects) {
        out.push({ effect: eff, source: `[B] ${b.name}`, rankCount: 1 });
      }
    }
  }

  // ── 6e. Guild buffs (level-gated) ───────────────────────────────────
  // GuildBuffs.xml entries activate when the player's guild reaches their
  // <Level> threshold. The build can opt out via build.applyGuildBuffs.
  if (build.applyGuildBuffs && (build.guildLevel ?? 0) > 0 && guildBuffs) {
    const lvl = build.guildLevel!;
    for (const gb of guildBuffs) {
      if (gb.level > lvl) continue;
      for (const eff of gb.effects) {
        out.push({ effect: eff, source: `[Guild] ${gb.name}`, rankCount: 1 });
      }
    }
  }

  // ── 7. Special feats (past lives, racial PL, iconic PL, etc.) ─────
  // Each rank fires the feat's effects with rankCount=rank, so per-rank
  // effects (Stacks AmountType) scale, and per-instance effects multiply.
  //
  // The parser groups by (featId, type), so a single feat trained 3 times
  // with mixed `<Type>` tags (e.g. Enchant Weapon ×3 stored as one
  // "Critical Befouling 2", one empty, one "EpicPastLife") shows up as
  // multiple specialFeats[] entries. Past-life feats granted via different
  // sources are still the same feat in DDO terms, so we merge by featId
  // here before firing — otherwise EPL FatePoint stacks index by partial
  // ranks and miss fate points that DDOBuilderV2 credits.
  const mergedByFeatId = new Map<string, number>();
  for (const sf of build.specialFeats ?? []) {
    if (sf.rank <= 0) continue;
    mergedByFeatId.set(sf.featId, (mergedByFeatId.get(sf.featId) ?? 0) + sf.rank);
  }
  for (const [featId, rank] of mergedByFeatId) {
    const data = featIdx.get(featId.toLowerCase());
    if (!data) {
      unmatched.push(featId);
      continue;
    }
    for (const eff of data.effects) {
      // Past-life bonuses (ability scores, PRR/MRR, skills, saves, …) all
      // stack with each other across different past lives in DDO. The
      // upstream data tags them as bonusType="Feat" (normally "highest
      // only"), but conceptually each past life is an independent grant.
      // Retag every Feat-typed past-life effect to "Stacking" so multiple
      // past lives contributing to the same stat all sum.
      const cloned = eff.bonus === 'Feat' ? { ...eff, bonus: 'Stacking' } : eff;
      // Cap rank at the feat's MaxTimesAcquire — Stacks tables index in
      // [0..MaxTimesAcquire-1], so an over-counted rank (e.g. an EPL trained
      // with stray non-EpicPastLife type rows) would silently fall off the
      // table edge.
      const capped = Math.min(rank, Math.max(1, data.maxTimesAcquire));
      out.push({
        effect: cloned,
        source: `[PL] ${featId}${capped > 1 ? ` ×${capped}` : ''}`,
        rankCount: capped,
      });
    }
  }

  // ── 9. Expand GrantFeat references ─────────────────────────────────
  // ~170 enhancement/race/class effects use <Type>GrantFeat</Type> to grant
  // a feat (e.g. Magical Training, Diehard, Favored Enemy: X). The granting
  // effect itself emits no Bonus — its purpose is to add the named feat to
  // the build's repertoire. We expand the grant by appending the granted
  // feat's effects with the grant's own <Requirements> AND-merged onto each
  // inherited effect, so race/class/level gating on the grant flows through.
  //
  // Granted feat names are also returned to the caller so they can land in
  // ctx.feats — making any downstream <Type>Feat</Type> requirement that
  // checks for the granted feat pass. Iterates a snapshot of `out` so we
  // don't re-process the appended granted effects (no chained GrantFeat
  // expansion — none observed in current data).
  const grantedFeatNames = new Set<string>();
  const grantedEffects: SourcedEffect[] = [];
  const snapshot = out.slice();
  for (const se of snapshot) {
    if (!se.effect.types.includes('GrantFeat')) continue;
    const featName = se.effect.items?.[0];
    if (!featName) continue;
    const data = featIdx.get(featName.toLowerCase());
    if (!data) {
      unmatched.push(featName);
      continue;
    }
    grantedFeatNames.add(data.name);
    for (const eff of data.effects) {
      grantedEffects.push({
        effect: { ...eff, requirements: mergeRequirements(eff.requirements, se.effect.requirements) },
        source: `${se.source} → ${data.name}`,
        rankCount: 1,
      });
    }
  }
  out.push(...grantedEffects);

  return {
    effects: out,
    grantedFeats: [...grantedFeatNames],
    unmatchedFeats: unmatched,
    unmatchedTrees: [...unmatchedTrees],
    unmatchedEnhancements: [...unmatchedEnhancements],
    unmatchedItemBuffs: [...unmatchedItemBuffs].sort(),
    unmatchedSets: [...unmatchedSets].sort(),
    unmatchedAugments: [...unmatchedAugments].sort(),
    unmatchedFiligrees: [...unmatchedFiligrees].sort(),
    unmatchedFiligreeSets: [...unmatchedFiligreeSets].sort(),
  };
}

/** A togglable stance currently available to the build (granted by some
 *  feat / class autofeat / enhancement / destiny / past-life). */
export interface AvailableStance {
  /** Stance metadata (Name, Group, IncompatibleStance, Description, Icon). */
  data: DDOStanceData;
  /** Human-readable origin (e.g. "Mountain Stance feat", "[E] Stalwart
   *  Defender: Stalwart Defense", "[D] Shiradi Champion: Mantle"). */
  source: string;
  /** Number of times the granting source was taken — for past-life feats
   *  this is the past-life rank (1–3 typically). For other sources it's 1.
   *  Used by the UI to show a "×N" badge and pick the right tier in the
   *  stance description's `+[a/b/c]` value tables. */
  rank: number;
}

/**
 * Walk the build's sources for granted stances. Stances live nested inside
 * feat / class autofeat / enhancement-item / selection XML blocks, so we
 * iterate the same containers as `collectEffects` but emit `AvailableStance`
 * records instead of `SourcedEffect`s. Stances are not numeric — they're a
 * UI concept (toggleable buttons that flip `build.activeStances`).
 *
 * Dedupes by name keeping the first source seen, since the same stance can
 * be granted from multiple sources (e.g. Power Attack from a feat AND from
 * a fighter level autofeat).
 */
export function collectAvailableStances(input: {
  build: Build;
  feats: DDOFeatData[];
  classes: DDOClassData[];
  enhancementTrees: EnhancementTreeData[];
}): AvailableStance[] {
  const { build, feats, classes, enhancementTrees } = input;
  const featIdx  = indexFeats(feats);
  const classIdx = indexClasses(classes);
  const treeIdx  = indexTrees(enhancementTrees);

  const out: AvailableStance[] = [];
  const seen = new Set<string>();
  function push(data: DDOStanceData, source: string, rank = 1) {
    if (!data?.name || seen.has(data.name)) return;
    seen.add(data.name);
    out.push({ data, source, rank });
  }

  // 1. Selected feats
  for (const sel of build.feats) {
    const data = featIdx.get(sel.featId.toLowerCase());
    if (!data) continue;
    for (const st of data.stances) push(st, `${data.name} (feat)`);
  }
  // 2. Class automatic feats
  for (const cls of build.classes) {
    const cdata = classIdx.get(cls.classId);
    if (!cdata) continue;
    for (const grant of cdata.automaticFeats) {
      if (grant.level > cls.levels) continue;
      for (const featName of grant.feats) {
        const data = featIdx.get(featName.toLowerCase());
        if (!data) continue;
        for (const st of data.stances) push(st, `${cdata.name} L${grant.level}: ${data.name}`);
      }
    }
  }
  // 3. Past-life / special feats — pass through `rank` so the UI shows
  // stack count and picks the right tier in the description's value table.
  for (const sf of build.specialFeats ?? []) {
    if (sf.rank <= 0) continue;
    const data = featIdx.get(sf.featId.toLowerCase());
    if (!data) continue;
    const sourceLabel = `[PL] ${data.name}${sf.rank > 1 ? ` ×${sf.rank}` : ''}`;
    for (const st of data.stances) push(st, sourceLabel, sf.rank);
  }
  // 4. Heroic enhancements
  const stanceActiveSet = getActiveEnhancementSet(build);
  for (const tspend of stanceActiveSet.enhancements) {
    const tree = treeIdx.get(tspend.treeId.toLowerCase());
    if (!tree) continue;
    for (const enh of tspend.enhancements) {
      if (enh.rank <= 0) continue;
      const item = tree.items.find(i => i.internalName === enh.enhancementId)
                ?? tree.items.find(i => i.name === enh.enhancementId);
      if (!item) continue;
      // If the user picked a selection, only that selection's stances apply.
      if (item.selector && enh.selection) {
        const sel = item.selector.find(s => s.name === enh.selection);
        for (const st of sel?.stances ?? []) push(st, `[E] ${tree.name}: ${sel?.name}`);
      } else {
        for (const st of item.stances) push(st, `[E] ${tree.name}: ${item.name}`);
      }
    }
  }
  // 5. Destiny enhancements (mantles live here)
  for (const tspend of stanceActiveSet.destinyEnhancements) {
    const tree = treeIdx.get(tspend.treeId.toLowerCase());
    if (!tree) continue;
    for (const enh of tspend.enhancements) {
      if (enh.rank <= 0) continue;
      const item = tree.items.find(i => i.internalName === enh.enhancementId)
                ?? tree.items.find(i => i.name === enh.enhancementId);
      if (!item) continue;
      if (item.selector && enh.selection) {
        const sel = item.selector.find(s => s.name === enh.selection);
        for (const st of sel?.stances ?? []) push(st, `[D] ${tree.name}: ${sel?.name}`);
      } else {
        for (const st of item.stances) push(st, `[D] ${tree.name}: ${item.name}`);
      }
    }
  }
  // 6. Reaper enhancements (rare for stances but possible)
  for (const tspend of stanceActiveSet.reaperEnhancements) {
    const tree = treeIdx.get(tspend.treeId.toLowerCase());
    if (!tree) continue;
    for (const enh of tspend.enhancements) {
      if (enh.rank <= 0) continue;
      const item = tree.items.find(i => i.internalName === enh.enhancementId);
      if (!item) continue;
      for (const st of item.stances) push(st, `[R] ${tree.name}: ${item.name}`);
    }
  }
  return out;
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
  /** Feats granted by enhancements / classes / races via <Type>GrantFeat</Type>.
   *  Unioned into ctx.feats alongside the player-selected feats so requirements
   *  that gate on a granted feat name pass. */
  grantedFeats?: ReadonlyArray<string>;
  /** Wielded weapon type in main hand from the active gear set. Defaults to
   *  '' if omitted — GroupMember gates against it will always fail. */
  mainHandWeapon?: string;
  /** Wielded weapon type in off hand. Defaults to ''. */
  offHandWeapon?: string;
  /** Dynamic weapon groups from AddGroupWeapon effects (Kensei Focus Weapon
   *  etc.). Defaults to empty map. */
  dynamicWeaponGroups?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Stances that activate automatically from build context (currently:
   *  weapon-derived — wielding a favored weapon activates "FavoredWeapon",
   *  wielding a ranged weapon activates "Ranged Combat"). Merged into
   *  the final active-stance set alongside the user's manually-toggled
   *  stances. */
  autoStances?: ReadonlySet<string>;
}): import('./evaluateEffect').BuildContext {
  const { build, classes, effectiveScores, bab, grantedFeats } = input;
  const classIdx = indexClasses(classes);

  const totalLevel = build.classes.reduce((s, c) => s + c.levels, 0)
                   + (build.epicLevels ?? 0);

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
  for (const tree of getActiveEnhancementSet(build).enhancements) {
    const ap = tree.enhancements.reduce((s, e) => s + e.rank, 0);
    apSpentInTree.set(tree.treeId.toLowerCase(), ap);
  }

  const skillRanks = new Map<string, number>();
  for (const [skillId, ranks] of Object.entries(build.skillRanks ?? {})) {
    if (ranks > 0) skillRanks.set(skillId, ranks);
  }

  const allFeats = new Set<string>(build.feats.map(f => f.featId));
  for (const g of grantedFeats ?? []) allFeats.add(g);

  return {
    totalLevel,
    classLevels,
    baseClassLevels,
    raceId: build.raceId,
    raceName: build.raceId.replace(/_/g, ' '),
    feats: allFeats,
    abilityScores: effectiveScores,
    bab,
    apSpentInTree,
    activeStances: new Set([
      ...(build.activeStances ?? []),
      ...(input.autoStances ?? []),
    ]),
    skillRanks,
    mainHandWeapon: input.mainHandWeapon ?? '',
    offHandWeapon:  input.offHandWeapon  ?? '',
    dynamicWeaponGroups: input.dynamicWeaponGroups ?? new Map(),
  };
}
