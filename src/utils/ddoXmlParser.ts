import type {
  DDOClassData,
  DDORaceData,
  DDOFeatData,
  DDOFeatRequirements,
  DDOFeatRequirement,
  EnhancementTreeData,
  EnhancementItemData,
  EnhancementSelectionData,
  FeatAcquireType,
  SaveType,
  DDOBonusType,
  DDOStanceData,
  DDOWeaponGroup,
  DDOSetBonusData,
  DDOEffect,
} from '@/types/ddoData';
import {
  parseEffectsIn,
  parseBuffsIn,
  parseRequirements,
} from './effectParser';

const parser = new DOMParser();

function parseXml(xml: string): Document {
  // Strip UTF-8 BOM (U+FEFF) that DDOBuilderV2 prepends to all its XML files.
  // DOMParser requires <?xml...> to be the very first character; a BOM causes
  // the entire document to be returned as a parsererror.
  const clean = xml.charCodeAt(0) === 0xFEFF ? xml.slice(1) : xml;
  return parser.parseFromString(clean, 'application/xml');
}

function text(parent: Element | Document, selector: string): string {
  return parent.querySelector(selector)?.textContent?.trim() ?? '';
}

function num(parent: Element | Document, selector: string): number {
  return parseInt(text(parent, selector), 10) || 0;
}

function spaceSeparatedNumbers(raw: string): number[] {
  return raw.trim().split(/\s+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
}

function elements(parent: Element | Document, selector: string): Element[] {
  return Array.from(parent.querySelectorAll(selector));
}

// ── Feat icon extraction ───────────────────────────────────────────────────────
// Scans ANY DDO XML file for <Feat> elements and returns a lowercased
// feat-name → icon-name map.  Works on Feats.xml, class XML, and race XML.
export function parseFeatIcons(xml: string): Record<string, string> {
  const doc = parseXml(xml);
  if (doc.querySelector('parsererror')) return {};
  const result: Record<string, string> = {};
  for (const feat of Array.from(doc.querySelectorAll('Feat'))) {
    // Use :scope > to get direct children only, avoiding SubItem icons
    const name = feat.querySelector(':scope > Name')?.textContent?.trim() ?? '';
    const icon = feat.querySelector(':scope > Icon')?.textContent?.trim() ?? '';
    if (name && icon) result[name.toLowerCase()] = icon;
  }
  return result;
}

// ── Image URL helpers ──────────────────────────────────────────────────────────

export type IconCategory =
  | 'Class'
  | 'Feat'
  | 'Enhancement'
  | 'Spell'
  | 'Augment'
  | 'SetBonus'
  | 'Item'
  | 'Filigree'
  | 'SentientGem'
  | 'UI';

export function iconUrl(iconName: string, category: IconCategory): string {
  if (!iconName) return '';
  return `/assets/images/${category}Images/${iconName}.png`;
}

export function classIconUrl(iconName: string, small = false): string {
  const name = small && !iconName.endsWith('_Small') ? `${iconName}_Small` : iconName;
  return `/assets/images/ClassImages/${name}.png`;
}

// ── Class parser ───────────────────────────────────────────────────────────────

function parseSaveType(value: string): SaveType {
  return value === 'Type2' ? 'high' : 'low';
}

export function parseClassXml(xml: string): DDOClassData | null {
  const doc = parseXml(xml);
  const cls = doc.querySelector('Class');
  if (!cls) return null;

  const babRaw = text(cls, 'BAB');
  const spRaw = text(cls, 'SpellPointsPerLevel');

  const automaticFeats: DDOClassData['automaticFeats'] = elements(cls, 'AutomaticFeats').map(af => ({
    level: num(af, 'Level'),
    feats: elements(af, 'Feats').map(f => f.textContent?.trim() ?? '').filter(Boolean),
  }));

  const featSlots: DDOClassData['featSlots'] = elements(cls, 'FeatSlot').map(fs => ({
    level: num(fs, 'Level'),
    featType: text(fs, 'FeatType'),
    options: elements(fs, 'FeatUpdateList').map(f => f.textContent?.trim() ?? '').filter(Boolean),
  }));

  return {
    name: text(cls, 'Name'),
    baseClass: text(cls, 'BaseClass') || null,
    description: text(cls, 'Description'),
    smallIcon: text(cls, 'SmallIcon'),
    largeIcon: text(cls, 'LargeIcon'),
    hitDie: num(cls, 'HitPoints'),
    skillPointsPerLevel: num(cls, 'SkillPoints'),
    classSkills: elements(cls, 'ClassSkill').map(el => el.textContent?.trim() ?? '').filter(Boolean),
    babPerLevel: spaceSeparatedNumbers(babRaw),
    fortSave: parseSaveType(text(cls, 'Fortitude')),
    refSave: parseSaveType(text(cls, 'Reflex')),
    willSave: parseSaveType(text(cls, 'Will')),
    spellPointsPerLevel: spaceSeparatedNumbers(spRaw),
    castingStat: text(cls, 'CastingStat') || null,
    automaticFeats,
    featSlots,
    classSpecificFeatType: text(cls, 'ClassSpecificFeatType') || null,
  };
}

// ── Race parser ────────────────────────────────────────────────────────────────

export function parseRaceXml(xml: string): DDORaceData | null {
  const doc = parseXml(xml);
  const race = doc.querySelector('Race');
  if (!race) return null;

  const buildPointsRaw = text(race, 'BuildPoints');
  const featSlots: DDORaceData['featSlots'] = elements(race, 'FeatSlot').map(fs => ({
    level: num(fs, 'Level'),
    featType: text(fs, 'FeatType'),
    options: elements(fs, 'FeatUpdateList').map(f => f.textContent?.trim() ?? '').filter(Boolean),
  }));

  const pastLifeEl = race.querySelector('Feat');
  const pastLife: DDORaceData['pastLifeFeat'] = pastLifeEl ? {
    name: text(pastLifeEl, 'Name'),
    description: text(pastLifeEl, 'Description'),
    icon: text(pastLifeEl, 'Icon'),
    maxTimesAcquire: num(pastLifeEl, 'MaxTimesAcquire') || 3,
  } : null;

  return {
    name: text(race, 'Name'),
    shortName: text(race, 'ShortName'),
    description: text(race, 'Description'),
    startingWorld: text(race, 'StartingWorld'),
    buildPoints: spaceSeparatedNumbers(buildPointsRaw),
    bonusSkillPoints: num(race, 'SkillPoints'),
    featSlots,
    pastLifeFeat: pastLife,
  };
}

// ── Feat parser ────────────────────────────────────────────────────────────────

function parseFeatRequirements(featEl: Element): DDOFeatRequirements {
  const reqBlock = featEl.querySelector(':scope > Requirements');
  if (!reqBlock) return { allOf: [], oneOf: [], noneOf: [] };

  const parseReq = (el: Element): DDOFeatRequirement => ({
    type: text(el, 'Type'),
    item: text(el, 'Item') || undefined,
    value: el.querySelector('Value') ? num(el, 'Value') : undefined,
  });

  const allOf: DDOFeatRequirement[] = elements(reqBlock, ':scope > Requirement').map(parseReq);

  const oneOf: DDOFeatRequirement[][] = elements(reqBlock, ':scope > RequiresOneOf').map(group =>
    elements(group, 'Requirement').map(parseReq),
  );

  const noneOf: DDOFeatRequirement[][] = elements(reqBlock, ':scope > RequiresNoneOf').map(group =>
    elements(group, 'Requirement').map(parseReq),
  );

  return { allOf, oneOf, noneOf };
}

function parseSingleFeat(feat: Element, hasSubItems: boolean): DDOFeatData {
  return {
    name: text(feat, 'Name'),
    description: text(feat, 'Description'),
    icon: text(feat, 'Icon'),
    groups: elements(feat, ':scope > Group').map(g => g.textContent?.trim() ?? '').filter(Boolean),
    acquire: (text(feat, 'Acquire') || 'Train') as FeatAcquireType,
    maxTimesAcquire: num(feat, 'MaxTimesAcquire') || 1,
    requirements: parseFeatRequirements(feat),
    hasSubItems,
    // Effects are direct children of the feat OR sub-item element. We
    // intentionally don't recurse — sub-items are parsed as separate feat
    // entries below, so we'd double-count their effects otherwise.
    effects: directChildren(feat, 'Effect').map(parseEffectInline),
  };
}

// Local copies to avoid the import cycle between this module and effectParser
// (which imports ddoData types we re-export). Both functions match the
// universal Effect parser's behaviour.
function directChildren(parent: Element, tag: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n && n.nodeType === 1 && (n as Element).tagName === tag) out.push(n as Element);
  }
  return out;
}

// Use the canonical parseEffect from effectParser via a thin alias.
// (Import-level alias avoids a circular dep that the legacy
// `parseEffectsIn` import on line 22 already established.)
function parseEffectInline(el: Element) {
  // Reuse the parseEffectsIn helper by calling it on a minimal wrapper
  // that exposes the single Effect element as the only direct child.
  return parseEffectsIn({
    childNodes: [el],
  } as unknown as Element)[0]!;
}

export function parseFeatsXml(xml: string): DDOFeatData[] {
  const doc = parseXml(xml);
  const out: DDOFeatData[] = [];

  for (const feat of elements(doc, 'Feat')) {
    const subItems = directChildren(feat, 'SubItem');
    out.push(parseSingleFeat(feat, subItems.length > 0));

    // Promote each <SubItem> to a top-level feat entry. Sub-items represent
    // mutually-exclusive feat options (e.g. "Adept of Forms" → "Master of
    // Rock"/"Master of Wind"/etc.) and the build can hold any one of them
    // by name. They carry their own Name/Effect/Requirements just like
    // parent feats.
    for (const sub of subItems) {
      out.push(parseSingleFeat(sub, false));
    }
  }
  return out;
}

// ── BonusTypes ─────────────────────────────────────────────────────────────────

export function parseBonusTypesXml(xml: string): DDOBonusType[] {
  const doc = parseXml(xml);
  return elements(doc, 'Bonus').map(b => ({
    name: text(b, 'Name'),
    stacking: text(b, 'Stacking') || 'Always',
  })).filter(b => b.name);
}

// ── Stances ────────────────────────────────────────────────────────────────────

export function parseStancesXml(xml: string): DDOStanceData[] {
  const doc = parseXml(xml);
  return elements(doc, 'Stance').map(s => ({
    name: text(s, 'Name'),
    icon: text(s, 'Icon'),
    description: text(s, 'Description'),
    group: text(s, 'Group'),
    autoControlled: s.querySelector(':scope > AutoControlled') !== null,
    requirements: parseRequirements(s.querySelector(':scope > Requirements')),
  })).filter(s => s.name);
}

// ── Weapon Groupings ───────────────────────────────────────────────────────────

export function parseWeaponGroupsXml(xml: string): DDOWeaponGroup[] {
  const doc = parseXml(xml);
  return elements(doc, 'WeaponGroup').map(g => ({
    name: text(g, 'Name'),
    weapons: elements(g, ':scope > Weapon').map(w => w.textContent?.trim() ?? '').filter(Boolean),
  })).filter(g => g.name);
}

// ── Set Bonuses ────────────────────────────────────────────────────────────────

export function parseSetBonusesXml(xml: string): DDOSetBonusData[] {
  const doc = parseXml(xml);
  return elements(doc, 'SetBonus').map(sb => ({
    type: text(sb, 'Type'),
    icon: text(sb, 'Icon'),
    buffs: parseBuffsIn(sb),
  })).filter(s => s.type);
}

// Re-export for convenience so callers don't need to import effectParser separately
export type { DDOEffect };
export { parseEffectsIn, parseBuffsIn };

// ── Enhancement tree parser ────────────────────────────────────────────────────

function parseEnhancementItem(el: Element, isCore: boolean): EnhancementItemData {
  const costRaw = text(el, 'CostPerRank');
  const selector: EnhancementSelectionData[] | null = (() => {
    const sel = el.querySelector(':scope > Selector');
    if (!sel) return null;
    return elements(sel, ':scope > EnhancementSelection').map(s => ({
      name: text(s, 'Name'),
      description: text(s, 'Description'),
      icon: text(s, 'Icon'),
      effects: parseEffectsIn(s),
    }));
  })();

  // Arrow flags are DL_FLAG elements — present = true, absent = false
  const hasFlag = (tag: string) => el.querySelector(tag) !== null;
  // Effects are direct children of the EnhancementTreeItem; the per-Selection
  // effects are captured separately above and don't double-up here.
  const effects = parseEffectsIn(el);
  const requirements = parseRequirements(el.querySelector(':scope > Requirements'));

  return {
    internalName: text(el, 'InternalName'),
    name: text(el, 'Name'),
    description: text(el, 'Description'),
    icon: text(el, 'Icon'),
    xPosition: num(el, 'XPosition'),
    yPosition: num(el, 'YPosition'),
    costPerRank: spaceSeparatedNumbers(costRaw),
    ranks: num(el, 'Ranks') || 1,
    minSpent: num(el, 'MinSpent'),
    isCore,
    selector,
    effects,
    requirements,
    arrowUp:         hasFlag('ArrowUp'),
    arrowLeft:       hasFlag('ArrowLeft'),
    arrowRight:      hasFlag('ArrowRight'),
    longArrowUp:     hasFlag('LongArrowUp'),
    extraLongArrowUp: hasFlag('ExtraLongArrowUp'),
  };
}

export function parseEnhancementTreeXml(xml: string): EnhancementTreeData | null {
  const doc = parseXml(xml);
  const tree = doc.querySelector('EnhancementTree');
  if (!tree) return null;

  // ── Parse top-level requirements ──────────────────────────────────
  // Collect all Requirement elements directly inside the root <Requirements>
  // block (including those inside <RequiresOneOf>).
  const reqBlock = tree.querySelector(':scope > Requirements');
  const classReqs: EnhancementTreeData['classReqs'] = [];
  let raceReq: string | null = null;
  let isUniversal = false;
  const isRacialTree = tree.querySelector(':scope > IsRacialTree') !== null;

  if (reqBlock) {
    // Direct requirements
    for (const req of Array.from(reqBlock.querySelectorAll('Requirement'))) {
      const type = req.querySelector('Type')?.textContent?.trim() ?? '';
      const item = req.querySelector('Item')?.textContent?.trim() ?? '';
      if (type === 'Class' || type === 'BaseClass') {
        classReqs.push({ matchType: type as 'Class' | 'BaseClass', className: item });
      } else if (type === 'Race') {
        raceReq = item;
      } else if (type === 'Feat') {
        // Feat requirement = universal tree unlocked by favor/feat
        isUniversal = true;
      }
    }
  }

  // All items use <EnhancementTreeItem> — core items are identified by YPosition=0
  const coreItems: EnhancementItemData[] = [];
  const treeItems: EnhancementItemData[] = [];
  for (const el of elements(tree, 'EnhancementTreeItem')) {
    const item = parseEnhancementItem(el, false);
    if (item.yPosition === 0) {
      coreItems.push({ ...item, isCore: true });
    } else {
      treeItems.push(item);
    }
  }

  const background = text(tree, 'Background');
  return {
    name: text(tree, 'Name'),
    version: num(tree, 'Version'),
    icon: text(tree, 'Icon'),
    background,
    classReqs,
    raceReq,
    isUniversal,
    isRacialTree,
    isDestinyTree: background.startsWith('Destiny'),
    items: [...coreItems, ...treeItems],
  };
}
