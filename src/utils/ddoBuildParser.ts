import type {
  Build, ClassLevel, SelectedFeat, EnhancementSelection, Alignment, Stat,
  GearSet, GearItem, GearBuff, GearSlot,
} from '@/types/build';

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

// Feat types from LevelTraining that are automatic grants, NOT user selections
const AUTO_FEAT_TYPES = new Set([
  'Automatic',
  'HeroicPastLife',
  'RacialPastLife',
  'IconicPastLife',
  'EpicPastLife',
  'UniversalTree',
  'SpecialFeat',
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

// ── Public API ─────────────────────────────────────────────────────────────────

export interface DDOBuildImport {
  build: Build;
  notes: string;
  warnings: string[];
}

export function parseDDOBuildFile(xmlText: string): DDOBuildImport | null {
  const stripped = xmlText.charCodeAt(0) === 0xFEFF ? xmlText.slice(1) : xmlText;
  const doc = xmlParser.parseFromString(stripped, 'application/xml');
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
    for (const t of elemChildren(skillTomesEl, 'Tome')) {
      const name = textOf(t, 'Name');
      const value = numOf(t, 'Value');
      if (name && value > 0) skillTomes[toId(name)] = value;
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
    warnings.push(`${epicLevels} Epic/Legendary levels detected (level ${Object.values(classCount).reduce((a, b) => a + b, 0) + 1}+) — only heroic classes are shown.`);
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
  const specialFeatsKey = (n: string, t: string) => `${n}${t}`;
  const specialFeatRanks = new Map<string, { featId: string; type: string; rank: number }>();
  // <Character>-scope (applies across all lives), not per-build.
  const specialFeatsEl = firstElemChild(character, 'SpecialFeats');
  if (specialFeatsEl) {
    for (const tf of elemChildren(specialFeatsEl, 'TrainedFeat')) {
      const featName = textOf(tf, 'FeatName');
      const featType = textOf(tf, 'Type');
      if (!featName) continue;
      const key = specialFeatsKey(featName, featType);
      const existing = specialFeatRanks.get(key);
      if (existing) existing.rank++;
      else specialFeatRanks.set(key, { featId: featName, type: featType, rank: 1 });
    }
  }
  const specialFeats = [...specialFeatRanks.values()];

  // ── Skill Ranks ─────────────────────────────────────────────────────────────
  // Each TrainedSkill entry inside LevelTraining represents 1 rank spent in that skill.
  const skillRanks: Record<string, number> = {};
  for (const lt of levelTrainings) {
    for (const ts of elemChildren(lt, 'TrainedSkill')) {
      const skill = textOf(ts, 'Skill');
      if (!skill) continue;
      const id = toId(skill);
      skillRanks[id] = (skillRanks[id] ?? 0) + 1;
    }
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
    };
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
    return { name: setName, items };
  });

  const activeGearSet = textOf(buildEl, 'ActiveGear');

  // Extract the 6 selected enhancement tree names
  const selectedEnhancementTrees: string[] = [];
  const selTreesEl = firstElemChild(buildEl, 'Enhancement_SelectedTrees');
  if (selTreesEl) {
    for (const tn of elemChildren(selTreesEl, 'TreeName')) {
      const name = tn.textContent?.trim() ?? '';
      if (name && name !== 'No selection') selectedEnhancementTrees.push(name);
    }
  }
  // Fall back to the trees that have actual spend data
  if (selectedEnhancementTrees.length === 0) {
    for (const e of enhancements) {
      if (!selectedEnhancementTrees.includes(e.treeId)) selectedEnhancementTrees.push(e.treeId);
    }
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
      selectedEnhancementTrees,
      gearSets,
      activeGearSet,
      activeStances: [],
      levelClasses,
      abilityTomes,
      skillTomes,
      levelUps,
      specialFeats,
    },
  };
}
