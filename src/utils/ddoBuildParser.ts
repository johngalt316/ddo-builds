import type {
  Build, ClassLevel, SelectedFeat, EnhancementSelection, Alignment, Stat,
  GearSet, GearItem, GearBuff, GearSlot,
} from '@/types/build';
import { skillNameToId } from './classAdapter';

const xmlParser = new DOMParser();

// XSpend values are the NUMBER OF TIMES each stat was incremented from base 8.
// Score = 8 + spend.  (The escalating build-point cost is tracked separately by
// AvailableSpend; XSpend itself is just a 0-10 increment count.)
function spendToScore(spend: number): number {
  return 8 + Math.max(0, Math.min(10, spend));
}

const ALIGNMENT_MAP: Record<string, Alignment> = {
  'Lawful Good':    'LG',
  'Lawful Neutral': 'LN',
  'Lawful Evil':    'LE',
  'Neutral Good':   'NG',
  'True Neutral':   'TN',
  'Neutral Evil':   'NE',
  'Chaotic Good':   'CG',
  'Chaotic Neutral':'CN',
  'Chaotic Evil':   'CE',
};

// Feat types from LevelTraining that are automatic grants, NOT user selections.
// `Special` covers items like "Inherent Racial Action Point" / "Inherent
// Universal Action Point" (the in-game RAP/UAP tomes from Chrism of Racial
// Knowledge etc.).
const AUTO_FEAT_TYPES = new Set([
  'Automatic',
  'HeroicPastLife',
  'RacialPastLife',
  'IconicPastLife',
  'EpicPastLife',
  'UniversalTree',
  'EpicDestinyTree',
  'SpecialFeat',
  'Special',
]);

// ── Robust XML helpers ─────────────────────────────────────────────────────────
// Using childNodes + nodeType === 1 (ELEMENT_NODE) instead of .children
// because .children on XML-mode DOMParser documents is inconsistent
// across browsers.

function elemChildren(el: Element, tag: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node && node.nodeType === 1 && (node as Element).tagName === tag) {
      result.push(node as Element);
    }
  }
  return result;
}

function firstElemChild(el: Element, tag: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node && node.nodeType === 1 && (node as Element).tagName === tag) {
      return node as Element;
    }
  }
  return null;
}

function textOf(el: Element, tag: string): string {
  const child = firstElemChild(el, tag);
  return child?.textContent?.trim() ?? '';
}

function numOf(el: Element, tag: string): number {
  return parseInt(textOf(el, tag), 10) || 0;
}

function toId(name: string): string {
  return name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
}

/**
 * Manual data patches for items whose buff values in the `.DDOBuild` (and
 * upstream wiki/XML data) don't match in-game behavior. Each entry is keyed
 * by the item name and mutates the parsed `GearBuff[]` in place.
 *
 * Tracked in `docs/DATA_PATCHES.md` so we can eventually file upstream bugs.
 */
const ITEM_BUFF_PATCHES: Record<string, (buffs: GearBuff[]) => void> = {
  // Driftwood (offhand Rune Arm): the upstream data lists the Quality Impulse
  // bonus at +36, but in-game it's actually +31.
  'Driftwood': buffs => {
    for (const b of buffs) {
      if (b.type === 'Impulse' && b.bonusType === 'Quality' && b.value1 === 36) {
        b.value1 = 31;
      }
    }
  },
};

function applyItemBuffPatches(itemName: string, buffs: GearBuff[]): void {
  const patch = ITEM_BUFF_PATCHES[itemName];
  if (patch) patch(buffs);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface DDOBuildImport {
  build: Build;
  notes: string;
  warnings: string[];
}

/**
 * Optional context passed by callers that have access to game data. Used to
 * convert raw skill-point spend (each `<TrainedSkill>` entry = 1 SP) into
 * actual ranks: class skills cost 1 SP/rank, cross-class skills cost 2 SP/rank.
 * When omitted, every entry is counted as 1 rank (legacy behavior — overcounts
 * cross-class skills by 2×, but harmless for builds that only train class skills).
 */
export interface ParseOptions {
  /** Map of classId → list of class skill IDs. Caller derives this from the
   *  loaded class catalog. */
  classSkillsByClassId?: Record<string, string[]>;
}

export function parseDDOBuildFile(xmlText: string, options?: ParseOptions): DDOBuildImport | null {
  // Strip UTF-8 BOM and normalize line endings to LF so parsed text is
  // platform-independent (Windows checkouts use CRLF, CI uses LF).
  const stripped = xmlText.charCodeAt(0) === 0xFEFF ? xmlText.slice(1) : xmlText;
  const normalized = stripped.replace(/\r\n?/g, '\n');
  const doc = xmlParser.parseFromString(normalized, 'application/xml');
  if (doc.querySelector('parsererror')) return null;

  const character = doc.querySelector('Character');
  if (!character) return null;

  // Active life & build indices sit on Character
  const activeLifeIdx  = numOf(character, 'ActiveLifeIndex');
  const activeBuildIdx = numOf(character, 'ActiveBuildIndex');

  const lives = elemChildren(character, 'Life');
  const life  = lives[activeLifeIdx] ?? lives[0];
  if (!life) return null;

  const builds = elemChildren(life, 'Build');
  const build  = builds[activeBuildIdx] ?? builds[0];
  if (!build) return null;

  const warnings: string[] = [];
  const buildName = textOf(life, 'Name') || 'Imported Build';

  // ── Race & Alignment ────────────────────────────────────────────────────────
  const raceName      = textOf(life, 'Race') || 'Human';
  const alignmentText = textOf(life, 'Alignment') || 'True Neutral';
  const raceId        = toId(raceName);
  const alignment     = ALIGNMENT_MAP[alignmentText] ?? 'TN';
  if (!ALIGNMENT_MAP[alignmentText]) {
    warnings.push(`Unknown alignment "${alignmentText}", defaulting to True Neutral.`);
  }

  // ── Ability Scores ──────────────────────────────────────────────────────────
  // XSpend = number of times the stat was incremented from base 8.
  // Score = 8 + XSpend (0-10).
  const spendEl = firstElemChild(build, 'AbilitySpend');
  const abilityScores = {
    STR: spendToScore(spendEl ? numOf(spendEl, 'StrSpend') : 0),
    DEX: spendToScore(spendEl ? numOf(spendEl, 'DexSpend') : 0),
    CON: spendToScore(spendEl ? numOf(spendEl, 'ConSpend') : 0),
    INT: spendToScore(spendEl ? numOf(spendEl, 'IntSpend') : 0),
    WIS: spendToScore(spendEl ? numOf(spendEl, 'WisSpend') : 0),
    CHA: spendToScore(spendEl ? numOf(spendEl, 'ChaSpend') : 0),
  };

  // ── Ability Tomes ───────────────────────────────────────────────────────────
  // Tomes live at <Character> scope (apply across all lives), not <Build>.
  // <StrTome>N</StrTome> stores the +N tome bonus (0 = no tome, max +8 = Supreme).
  const abilityTomes: Partial<Record<Stat, number>> = {};
  const tomeFields: [Stat, string][] = [
    ['STR', 'StrTome'], ['DEX', 'DexTome'], ['CON', 'ConTome'],
    ['INT', 'IntTome'], ['WIS', 'WisTome'], ['CHA', 'ChaTome'],
  ];
  for (const [stat, tag] of tomeFields) {
    const v = numOf(character, tag);
    if (v > 0) abilityTomes[stat] = v;
  }

  // ── Skill Tomes ─────────────────────────────────────────────────────────────
  // Also <Character>-scoped. <SkillTomes><Tome><Name>X</Name><Value>N</Value></Tome>…</SkillTomes>
  const skillTomes: Record<string, number> = {};
  const skillTomesEl = firstElemChild(character, 'SkillTomes');
  if (skillTomesEl) {
    // The XML stores tomes as direct child tags named after the skill, e.g.
    // `<SkillTomes><DisableDevice>5</DisableDevice><UMD>3</UMD>…</SkillTomes>`.
    // Iterate every element child and let `skillNameToId` map the tag name
    // (DisableDevice, MoveSilently, UMD, …) to our canonical skill ids.
    for (let i = 0; i < skillTomesEl.childNodes.length; i++) {
      const node = skillTomesEl.childNodes[i];
      if (!node || node.nodeType !== 1) continue;
      const el = node as Element;
      const value = parseInt(el.textContent?.trim() ?? '0', 10) || 0;
      if (value > 0) skillTomes[skillNameToId(el.tagName)] = value;
    }
  }

  // ── Level-up ability assignments ───────────────────────────────────────────
  // <Level4>Stat</Level4>, <Level8>…</Level8>, … through <Level40>.
  const STAT_NAME_TO_CODE: Record<string, Stat> = {
    Strength: 'STR', Dexterity: 'DEX', Constitution: 'CON',
    Intelligence: 'INT', Wisdom: 'WIS', Charisma: 'CHA',
  };
  const levelUps: Partial<Record<number, Stat>> = {};
  for (const lvl of [4, 8, 12, 16, 20, 24, 28, 32, 36, 40]) {
    const v = textOf(build, `Level${lvl}`);
    const stat = STAT_NAME_TO_CODE[v];
    if (stat) levelUps[lvl] = stat;
  }

  // ── Classes ─────────────────────────────────────────────────────────────────
  // Count class per level from LevelTraining entries (one element per level).
  // 'Epic' and 'Legendary' are DDO post-heroic pseudo-classes stored in the
  // same list; we separate them so they don't crowd out the 3-class heroic slots.
  const PSEUDO_CLASSES = new Set(['Epic', 'Legendary']);
  const levelTrainings = elemChildren(build, 'LevelTraining');
  const classCount: Record<string, number> = {};
  // Per-level class assignment (1-indexed level → classId at array[level-1]).
  // Skip pseudo-classes (Epic/Legendary) since they're not real classes.
  const levelClasses: string[] = [];
  let epicLevels = 0;
  for (const lt of levelTrainings) {
    const cls = textOf(lt, 'Class');
    if (!cls || cls === 'Unknown') continue;
    if (PSEUDO_CLASSES.has(cls)) {
      epicLevels++;
    } else {
      classCount[cls] = (classCount[cls] ?? 0) + 1;
      levelClasses.push(toId(cls));
    }
  }
  if (epicLevels > 0) {
    warnings.push(`${epicLevels} Epic/Legendary levels detected — heroic classes shown explicitly; epic levels stored as build.epicLevels for HP/CON purposes.`);
  }

  let classes: ClassLevel[];
  if (Object.keys(classCount).length > 0) {
    classes = Object.entries(classCount).map(([name, levels]) => ({
      classId: toId(name),
      levels,
    }));
  } else {
    // Fallback when level-by-level data is absent
    const c1 = textOf(build, 'Class1');
    const c2 = textOf(build, 'Class2');
    const c3 = textOf(build, 'Class3');
    const totalLevel = numOf(build, 'Level') || 20;
    classes = [c1, c2, c3]
      .filter(c => c && c !== 'Unknown')
      .map((c, i) => ({ classId: toId(c), levels: i === 0 ? totalLevel : 0 }));
    warnings.push('Level-by-level data missing; class levels may be approximate.');
  }

  if (classes.length === 0) {
    classes = [{ classId: 'fighter', levels: 20 }];
    warnings.push('No class data found, defaulting to Fighter 20.');
  }

  // ── Feats ───────────────────────────────────────────────────────────────────
  // Collect user-chosen feats from each LevelTraining block.
  const feats: SelectedFeat[] = [];
  let slotIdx = 0;
  for (const lt of levelTrainings) {
    for (const tf of elemChildren(lt, 'TrainedFeat')) {
      const featName = textOf(tf, 'FeatName');
      const featType = textOf(tf, 'Type');
      if (!featName || featName.trim() === 'No Selection') continue;
      if (AUTO_FEAT_TYPES.has(featType)) continue;
      feats.push({ slotIndex: slotIdx++, featId: featName });
    }
  }

  // ── Special Feats (past lives, racial PL, iconic PL, epic PL, etc.) ────────
  // Stored as <SpecialFeats><TrainedFeat>...</TrainedFeat>...</SpecialFeats>.
  // Same feat name appearing N times = N ranks of that feat. We group by
  // (featName, type) so e.g. multiple "Past Life: Aasimar" entries become a
  // single specialFeats[] entry with rank: 3.
  const specialFeatRanks = new Map<string, { featId: string; type: string; rank: number }>();
  // <Character>-scope (applies across all lives), not per-build.
  const specialFeatsEl = firstElemChild(character, 'SpecialFeats');
  if (specialFeatsEl) {
    for (const tf of elemChildren(specialFeatsEl, 'TrainedFeat')) {
      const featName = textOf(tf, 'FeatName');
      const featType = textOf(tf, 'Type');
      if (!featName) continue;
      // Each TrainedFeat counts as one rank — DDOBuilderV2 itself ignores the
      // <Type> field for stack counting and looks up the feat catalog's
      // <Acquire> instead. Past-life feats commonly appear with mixed Types
      // (one "EpicPastLife", one empty, one stray like "Critical Befouling 2"),
      // and they all contribute to the same past-life stack count. Merge by
      // featId, using the first non-empty type encountered as the canonical
      // type so downstream code can still inspect the past-life kind.
      const key = featName;
      const existing = specialFeatRanks.get(key);
      if (existing) {
        existing.rank++;
        if (!existing.type && featType) existing.type = featType;
      } else {
        specialFeatRanks.set(key, { featId: featName, type: featType, rank: 1 });
      }
    }
  }
  const specialFeats = [...specialFeatRanks.values()];

  // ── Skill Ranks ─────────────────────────────────────────────────────────────
  // Each `<TrainedSkill>` entry inside LevelTraining represents 1 SKILL POINT
  // spent in that skill. To convert SP → ranks: class skills are 1 SP/rank,
  // cross-class skills are 2 SP/rank (so spending 22 SP on a cross-class skill
  // gives 11 ranks). We need the build's classes' class-skill lists to know
  // which is which — passed in via `options.classSkillsByClassId`. When the
  // option isn't provided we fall back to "1 SP = 1 rank" (overcounts cross-
  // class but preserves legacy behavior).
  const skillSp: Record<string, number> = {};
  for (const lt of levelTrainings) {
    for (const ts of elemChildren(lt, 'TrainedSkill')) {
      const skill = textOf(ts, 'Skill');
      if (!skill) continue;
      const id = skillNameToId(skill);
      skillSp[id] = (skillSp[id] ?? 0) + 1;
    }
  }
  const skillRanks: Record<string, number> = {};
  if (options?.classSkillsByClassId) {
    // Union of class skills across every class the build has any levels in.
    const accessibleClassSkills = new Set<string>();
    for (const c of classes) {
      for (const s of options.classSkillsByClassId[c.classId] ?? []) {
        accessibleClassSkills.add(s);
      }
    }
    for (const [id, sp] of Object.entries(skillSp)) {
      skillRanks[id] = accessibleClassSkills.has(id) ? sp : sp / 2;
    }
  } else {
    for (const [id, sp] of Object.entries(skillSp)) skillRanks[id] = sp;
  }

  // ── Trained Spells ─────────────────────────────────────────────────────────
  // <TrainedSpell> blocks are siblings of <LevelTraining>, one per trained
  // spell slot (class + spell level + spell name). Group into the
  // Record<className, Record<spellLevel, string[]>> shape `Build.trainedSpells`
  // expects. Empty when nothing is trained.
  const trainedSpells: Record<string, Record<string, string[]>> = {};
  for (const ts of elemChildren(build, 'TrainedSpell')) {
    const className = textOf(ts, 'Class');
    const level     = textOf(ts, 'Level');
    const spellName = textOf(ts, 'SpellName');
    if (!className || !level || !spellName) continue;
    const byLevel = trainedSpells[className] ??= {};
    const list    = byLevel[level] ??= [];
    list.push(spellName);
  }

  // ── Enhancements ────────────────────────────────────────────────────────────
  // Capture the narrowed build element so TypeScript sees it as Element
  // (not Element | undefined) inside the nested function.
  const buildEl = build;
  function parseSpendInTree(tag: string): EnhancementSelection[] {
    return elemChildren(buildEl, tag)
      .map(treeEl => ({
        treeId: textOf(treeEl, 'TreeName'),
        enhancements: elemChildren(treeEl, 'TrainedEnhancement').map(enh => ({
          enhancementId: textOf(enh, 'EnhancementName'),
          selection:     textOf(enh, 'Selection') || undefined,
          tier:          0,
          rank:          numOf(enh, 'Ranks'),
        })),
      }))
      .filter(t => t.treeId && t.treeId !== 'No selection');
  }

  const enhancements        = parseSpendInTree('EnhancementSpendInTree');
  const destinyEnhancements = parseSpendInTree('DestinySpendInTree');
  const reaperEnhancements  = parseSpendInTree('ReaperSpendInTree');

  // ── Gear ────────────────────────────────────────────────────────
  const GEAR_SLOTS: GearSlot[] = [
    'Helmet','Necklace','Trinket','Cloak','Belt','Goggles',
    'Gloves','Boots','Bracers','Armor','MainHand','OffHand',
    'Quiver','Arrow','Ring1','Ring2',
  ];

  function parseBuff(buffEl: Element): GearBuff {
    const v1 = buffEl.querySelector(':scope > Value1')?.textContent?.trim();
    const v2 = buffEl.querySelector(':scope > Value2')?.textContent?.trim();
    return {
      type:         buffEl.querySelector(':scope > Type')?.textContent?.trim() ?? '',
      value1:       v1 ? parseFloat(v1) : undefined,
      value2:       v2 ? parseFloat(v2) : undefined,
      bonusType:    buffEl.querySelector(':scope > BonusType')?.textContent?.trim(),
      item:         buffEl.querySelector(':scope > Item')?.textContent?.trim(),
      description1: buffEl.querySelector(':scope > Description1')?.textContent?.trim(),
    };
  }

  function parseGearItem(slotEl: Element, slot: GearSlot): GearItem | null {
    const itemName = textOf(slotEl, 'Name');
    if (!itemName) return null;
    const buffs: GearBuff[] = elemChildren(slotEl, 'Buff').map(parseBuff);
    applyItemBuffPatches(itemName, buffs);
    const augmentSlots = elemChildren(slotEl, 'ItemAugment').map(aug => {
      const sel = textOf(aug, 'SelectedAugment');
      const lvl = numOf(aug, 'SelectedLevelIndex');
      return {
        slotType: textOf(aug, 'Type'),
        selectedAugment: sel || undefined,
        selectedLevelIndex: lvl > 0 ? lvl : undefined,
      };
    }).filter(a => a.slotType);
    return {
      slot,
      name:         itemName,
      icon:         textOf(slotEl, 'Icon'),
      description:  textOf(slotEl, 'Description') || undefined,
      dropLocation: textOf(slotEl, 'DropLocation') || undefined,
      minLevel:     numOf(slotEl, 'MinLevel') || undefined,
      material:     textOf(slotEl, 'Material') || undefined,
      setBonus:     textOf(slotEl, 'SetBonus') || undefined,
      buffs,
      augmentSlots: augmentSlots.length > 0 ? augmentSlots : undefined,
    };
  }

  function parseFiligreeSlots(parent: Element, tag: string) {
    return elemChildren(parent, tag).map(fg => ({
      name: textOf(fg, 'Name') || undefined,
      rare: fg.querySelector(':scope > Rare') !== null ? true : undefined,
    }));
  }

  const gearSets: GearSet[] = elemChildren(buildEl, 'EquippedGear').map(eg => {
    const setName = textOf(eg, 'Name') || 'Unnamed';
    const items: GearItem[] = [];
    for (const slot of GEAR_SLOTS) {
      const slotEl = firstElemChild(eg, slot);
      if (slotEl) {
        const item = parseGearItem(slotEl, slot);
        if (item) items.push(item);
      }
    }
    const filigrees         = parseFiligreeSlots(eg, 'Filigree');
    const artifactFiligrees = parseFiligreeSlots(eg, 'ArtifactFiligree');
    return {
      name: setName,
      items,
      ...(filigrees.length         > 0 ? { filigrees } : {}),
      ...(artifactFiligrees.length > 0 ? { artifactFiligrees } : {}),
    };
  });

  const activeGearSet = textOf(buildEl, 'ActiveGear');

  // Active stance names from <ActiveStances><Stances>NAME</Stances>...</ActiveStances>.
  // Stance-gated effects (e.g. Past Life: Energy Criticals' +3 SpellLore for
  // Acid/Cold/Electric/Fire/Sonic) only fire when their stance is in this list.
  const activeStances: string[] = [];
  const stancesEl = firstElemChild(buildEl, 'ActiveStances');
  if (stancesEl) {
    for (const s of elemChildren(stancesEl, 'Stances')) {
      const name = (s.textContent ?? '').trim();
      if (name) activeStances.push(name);
    }
  }

  // Extract the selected enhancement tree names. The .DDOBuild file lists
  // them in three separate blocks — heroic / destiny / reaper — but our
  // build state stores all in one shared list (downstream tabs filter by
  // tree.isDestinyTree / tree.isReaperTree to render them in the right
  // place). Always pull all three so the corresponding tabs show their
  // selections after import.
  const selectedEnhancementTrees: string[] = [];
  const collectSelTrees = (containerTag: string) => {
    const el = firstElemChild(buildEl, containerTag);
    if (!el) return;
    for (const tn of elemChildren(el, 'TreeName')) {
      const name = tn.textContent?.trim() ?? '';
      if (name && name !== 'No selection' && !selectedEnhancementTrees.includes(name)) {
        selectedEnhancementTrees.push(name);
      }
    }
  };
  collectSelTrees('Enhancement_SelectedTrees');
  collectSelTrees('Destiny_SelectedTrees');
  collectSelTrees('Reaper_SelectedTrees');
  // Fall back to any tree that has actual spend data — covers files that
  // omit the explicit selected-trees blocks.
  if (selectedEnhancementTrees.length === 0) {
    for (const e of enhancements)         if (!selectedEnhancementTrees.includes(e.treeId)) selectedEnhancementTrees.push(e.treeId);
    for (const e of destinyEnhancements)  if (!selectedEnhancementTrees.includes(e.treeId)) selectedEnhancementTrees.push(e.treeId);
    for (const e of reaperEnhancements)   if (!selectedEnhancementTrees.includes(e.treeId)) selectedEnhancementTrees.push(e.treeId);
  } else {
    // Even when explicit lists exist, ensure every tree the user actually
    // spent in is selected — otherwise spent points become orphaned.
    for (const e of destinyEnhancements)  if (!selectedEnhancementTrees.includes(e.treeId)) selectedEnhancementTrees.push(e.treeId);
    for (const e of reaperEnhancements)   if (!selectedEnhancementTrees.includes(e.treeId)) selectedEnhancementTrees.push(e.treeId);
  }

  return {
    notes:    textOf(build, 'Notes'),
    warnings,
    build: {
      version: 1,
      name:    buildName,
      raceId,
      alignment,
      classes,
      abilityScores,
      skillRanks,
      feats,
      enhancements,
      destinyEnhancements,
      reaperEnhancements,
      selectedEnhancementTrees,
      // If the import had trees specified, treat as manual; otherwise let
      // the auto-defaults effect populate them based on race + top class.
      treesManuallyOverridden: selectedEnhancementTrees.length > 0,
      gearSets,
      activeGearSet,
      activeStances,
      levelClasses,
      abilityTomes,
      skillTomes,
      levelUps,
      specialFeats,
      ...(Object.keys(trainedSpells).length > 0 && { trainedSpells }),
      ...(epicLevels > 0 && { epicLevels }),
      ...((() => {
        const gl = numOf(character, 'GuildLevel');
        const apply = numOf(character, 'ApplyGuildBuffs');
        const out: { guildLevel?: number; applyGuildBuffs?: boolean } = {};
        if (gl > 0) out.guildLevel = gl;
        if (apply > 0) out.applyGuildBuffs = true;
        return out;
      })()),
    },
  };
}
