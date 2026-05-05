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
  DDOAugmentData,
  DDOFiligreeData,
  DDOFiligreeSetBonus,
  DDOClassSpell,
  DDOSpellData,
  DDOSpellDamage,
  DDOSpellDC,
  DDOSpellMetamagic,
  DDOOptionalBuff,
  DDOGuildBuff,
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
  let clean = xml.charCodeAt(0) === 0xFEFF ? xml.slice(1) : xml;
  // Normalize line endings to LF so parsed text content is platform-
  // independent. Windows checkouts have CRLF in the source XML; CI on Linux
  // has LF; without this, description fields drift into snapshots and CI
  // can't match what was committed locally.
  clean = clean.replace(/\r\n?/g, '\n');
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

/**
 * Known case/spelling fixes for icon names referenced in the upstream data
 * but stored on disk under a slightly different casing. Case-sensitive web
 * servers (Linux, default) will 404 the data-side spelling; this map keeps
 * Windows (case-insensitive) and Linux runtimes consistent.
 */
const ICON_NAME_FIXES: Record<string, string> = {
  EpicPastLifeSkillMAstery:    'EpicPastLifeSkillMastery',
  EpicPastLifeColorsOftheQueen: 'EpicPastLifeColorsOfTheQueen',
};

export function iconUrl(iconName: string, category: IconCategory): string {
  if (!iconName) return '';
  const corrected = ICON_NAME_FIXES[iconName] ?? iconName;
  return `/assets/images/${category}Images/${corrected}.png`;
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

  // Spell slot table: <Level1>..<Level20>, each carrying a space-separated
  // count of slots per spell-level. Inner length is fixed per-class via the
  // size attribute (4/6/9 depending on max spell level reachable).
  const spellSlotsByLevel: number[][] = [];
  for (let lvl = 1; lvl <= 20; lvl++) {
    const el = cls.querySelector(`:scope > Level${lvl}`);
    spellSlotsByLevel.push(el ? spaceSeparatedNumbers(el.textContent ?? '') : []);
  }

  const spells: DDOClassData['spells'] = elements(cls, 'ClassSpell').map(cs => {
    const out: DDOClassSpell = {
      name: text(cs, 'Name'),
      level: num(cs, 'Level'),
    };
    if (cs.querySelector(':scope > Cost'))           out.cost           = num(cs, 'Cost');
    if (cs.querySelector(':scope > MaxCasterLevel')) out.maxCasterLevel = num(cs, 'MaxCasterLevel');
    if (cs.querySelector(':scope > Cooldown'))       out.cooldown       = parseFloat(text(cs, 'Cooldown'));
    return out;
  }).filter(s => s.name);

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
    spells,
    spellSlotsByLevel,
    ...(cls.querySelector(':scope > NotHeroic') !== null && { notHeroic: true }),
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

  // Racial ability score mods come from per-stat <Strength>+2</Strength>,
  // <Dexterity>-2</Dexterity> tags as direct children of <Race>.
  const STAT_TAG: Record<string, keyof DDORaceData['abilityMods']> = {
    Strength: 'STR', Dexterity: 'DEX', Constitution: 'CON',
    Intelligence: 'INT', Wisdom: 'WIS', Charisma: 'CHA',
  };
  const abilityMods: DDORaceData['abilityMods'] = {};
  for (const [tag, key] of Object.entries(STAT_TAG)) {
    const el = race.querySelector(`:scope > ${tag}`);
    if (!el) continue;
    const raw = el.textContent?.trim() ?? '';
    if (!raw) continue;
    const v = parseInt(raw.replace(/^\+/, ''), 10);
    if (!Number.isNaN(v) && v !== 0) abilityMods[key] = v;
  }

  return {
    name: text(race, 'Name'),
    shortName: text(race, 'ShortName'),
    description: text(race, 'Description'),
    startingWorld: text(race, 'StartingWorld'),
    buildPoints: spaceSeparatedNumbers(buildPointsRaw),
    bonusSkillPoints: num(race, 'SkillPoints'),
    abilityMods,
    featSlots,
    pastLifeFeat: pastLife,
    ...(race.querySelector(':scope > IconicClass') !== null && { iconic: true }),
    ...(race.querySelector(':scope > NoPastLife') !== null && { noPastLife: true }),
  };
}

// ── Feat parser ────────────────────────────────────────────────────────────────

function parseFeatRequirements(featEl: Element): DDOFeatRequirements {
  const reqBlock = featEl.querySelector(':scope > Requirements');
  return parseRequirementsBlock(reqBlock);
}

function parseRequirementsBlock(reqBlock: Element | null): DDOFeatRequirements {
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
  // <AutomaticAcquisition> uses the same shape as a Requirements block
  // (list of <Requirement> children). Most "Automatic" feats gate on
  // SpecificLevel; some (like Improved Heroic Durability) have no AA block
  // at all and apply unconditionally.
  const aaEl = feat.querySelector(':scope > AutomaticAcquisition');
  const automaticAcquisition = aaEl ? parseRequirementsBlock(aaEl) : undefined;
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
    stances: parseStancesIn(feat),
    ...(automaticAcquisition && { automaticAcquisition }),
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

function parseStanceElement(s: Element): DDOStanceData {
  const incompatibleStances = elements(s, ':scope > IncompatibleStance')
    .map(el => el.textContent?.trim() ?? '')
    .filter(Boolean);
  return {
    name: text(s, 'Name'),
    icon: text(s, 'Icon'),
    description: text(s, 'Description'),
    group: text(s, 'Group'),
    autoControlled: s.querySelector(':scope > AutoControlled') !== null,
    incompatibleStances,
    requirements: parseRequirements(s.querySelector(':scope > Requirements')),
  };
}

export function parseStancesXml(xml: string): DDOStanceData[] {
  const doc = parseXml(xml);
  return elements(doc, 'Stance').map(parseStanceElement).filter(s => s.name);
}

/** Parse `<Stance>` direct children of a parent element (feat, enhancement
 *  item, selection). Used for stances that nest inside other XML structures
 *  (Mountain Stance lives inside the Mountain Stance feat, not in Stances.xml). */
export function parseStancesIn(parent: Element): DDOStanceData[] {
  return elements(parent, ':scope > Stance').map(parseStanceElement).filter(s => s.name);
}

// ── Self / Party buffs ─────────────────────────────────────────────────────
// SelfAndPartyBuffs.xml — togglable buffs from self/party (Haste, Bless,
// Recitation, …). Each <OptionalBuff> carries Name / Icon / Description and
// any number of <Effect> blocks.

export function parseSelfPartyBuffsXml(xml: string): DDOOptionalBuff[] {
  const doc = parseXml(xml);
  return elements(doc, 'OptionalBuff').map(b => ({
    name: text(b, 'Name'),
    icon: text(b, 'Icon'),
    description: text(b, 'Description'),
    effects: parseEffectsIn(b),
  })).filter(b => b.name);
}

// ── Guild Buffs ────────────────────────────────────────────────────────────

export function parseGuildBuffsXml(xml: string): DDOGuildBuff[] {
  const doc = parseXml(xml);
  return elements(doc, 'GuildBuff').map(b => ({
    name: text(b, 'Name').trim(),
    description: text(b, 'Description'),
    level: num(b, 'Level'),
    effects: parseEffectsIn(b),
  })).filter(b => b.name);
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

// ── Augments ───────────────────────────────────────────────────────────────

export function parseAugmentsXml(xml: string): DDOAugmentData[] {
  const doc = parseXml(xml);
  return elements(doc, 'Augment').map(aug => {
    const slotTypes = elements(aug, ':scope > Type').map(t => t.textContent?.trim() ?? '').filter(Boolean);
    const levels = spaceSeparatedNumbers(text(aug, 'Levels'));
    const levelValues = spaceSeparatedNumbers(text(aug, 'LevelValue'));
    return {
      name: text(aug, 'Name'),
      description: text(aug, 'Description'),
      slotTypes,
      icon: text(aug, 'Icon'),
      scalesWithLevel: aug.querySelector(':scope > ChooseLevel') !== null,
      levels,
      levelValues,
      effects: parseEffectsIn(aug),
    };
  }).filter(a => a.name);
}

// ── Filigrees ──────────────────────────────────────────────────────────────
// Each FiligreeSets/*.xml file declares <SetBonus> entries (set-tier buffs)
// AND multiple <Filigree> entries (the filigrees the user picks).

export function parseFiligreesXml(xml: string): {
  filigrees: DDOFiligreeData[];
  setBonuses: DDOFiligreeSetBonus[];
} {
  const doc = parseXml(xml);
  const setBonuses: DDOFiligreeSetBonus[] = elements(doc, 'SetBonus').map(sb => ({
    name: text(sb, 'Type'),
    icon: text(sb, 'Icon'),
    buffs: parseBuffsIn(sb),
  })).filter(s => s.name);

  const filigrees: DDOFiligreeData[] = elements(doc, 'Filigree').map(fg => {
    // Effects on filigrees may carry a <Rare/> flag — capture it so the
    // engine walker can gate per-slot.
    const parsedEffects = elements(fg, ':scope > Effect').map(el => {
      const rare = el.querySelector(':scope > Rare') !== null;
      // Re-use parseEffectsIn by wrapping the single Effect in a minimal
      // pseudo-element that exposes it as the only direct child.
      const wrapper = { childNodes: [el] } as unknown as Element;
      const e = parseEffectsIn(wrapper)[0];
      return e ? { ...e, rare } : null;
    }).filter((e): e is NonNullable<typeof e> => e !== null);

    return {
      name: text(fg, 'Name'),
      description: text(fg, 'Description'),
      icon: text(fg, 'Icon'),
      setBonus: text(fg, 'SetBonus'),
      effects: parsedEffects,
    };
  }).filter(f => f.name);

  return { filigrees, setBonuses };
}

// ── Spells parser ──────────────────────────────────────────────────────────
// Spells.xml is a flat list of <Spell> entries. Class linkage lives on each
// class's <ClassSpell> entries (parsed by parseClassXml). Schema notes:
//   - Metamagic flags are self-closing tags: <Empower/>, <Maximize/>, etc.
//   - <SpellDamage> nests <SpellDice> with PerCasterLevels, BonusDice, and Cap
//   - <SpellDC> describes the save-DC profile (DCType / DCVersus / Schools / ModAbility)

const METAMAGIC_TAGS = [
  ['Accelerate',     'accelerate'],
  ['Embolden',       'embolden'],
  ['Empower',        'empower'],
  ['EmpowerHealing', 'empowerHealing'],
  ['Enlarge',        'enlarge'],
  ['Extend',         'extend'],
  ['Heighten',       'heighten'],
  ['Intensify',      'intensify'],
  ['Maximize',       'maximize'],
  ['Quicken',        'quicken'],
] as const;

function parseSpellMetamagic(spell: Element): DDOSpellMetamagic {
  const out: DDOSpellMetamagic = {};
  for (const [tag, key] of METAMAGIC_TAGS) {
    if (spell.querySelector(`:scope > ${tag}`)) out[key] = true;
  }
  return out;
}

function parseSpellDamage(sd: Element): DDOSpellDamage {
  const dice = sd.querySelector(':scope > SpellDice');
  // DDOBuilderV2 spells use either <BaseDice> or <BonusDice> to describe
  // the dice that scale per caster level (e.g. Force Missiles uses BaseDice,
  // Magic Missile uses BonusDice). Same shape; either tag is the source.
  const dieEl = dice?.querySelector(':scope > BaseDice')
            ?? dice?.querySelector(':scope > BonusDice');
  return {
    damageType: text(sd, 'Damage'),
    spellPower: text(sd, 'SpellPower'),
    dice: {
      number: dieEl ? num(dieEl, 'Number') || 1 : 1,
      sides:  dieEl ? num(dieEl, 'Sides')  || 0 : 0,
      bonus:  dieEl ? num(dieEl, 'Bonus')  || 0 : 0,
      perCasterLevels: dice?.querySelector(':scope > PerCasterLevels')
        ? num(dice, 'PerCasterLevels')
        : undefined,
      cap: dice?.querySelector(':scope > Cap')
        ? num(dice, 'Cap')
        : undefined,
    },
  };
}

function parseSpellDC(dc: Element): DDOSpellDC {
  const schools = elements(dc, ':scope > School')
    .map(s => s.textContent?.trim() ?? '')
    .filter(Boolean);
  const modAbility = elements(dc, ':scope > ModAbility')
    .map(s => s.textContent?.trim() ?? '')
    .filter(Boolean);
  const out: DDOSpellDC = {
    dcType: text(dc, 'DCType'),
    dcVersus: text(dc, 'DCVersus'),
    schools,
    castingStatMod: dc.querySelector(':scope > CastingStatMod') !== null,
  };
  if (modAbility.length) out.modAbility = modAbility;
  return out;
}

export function parseSpellsXml(xml: string): DDOSpellData[] {
  const doc = parseXml(xml);
  const spells: DDOSpellData[] = [];

  for (const spell of elements(doc, 'Spell')) {
    const name = text(spell, 'Name');
    if (!name || name === 'No spell trained') continue; // sentinel placeholder

    const damages = elements(spell, ':scope > SpellDamage').map(parseSpellDamage);
    const dcs     = elements(spell, ':scope > SpellDC').map(parseSpellDC);
    const effects = parseEffectsIn(spell);

    const out: DDOSpellData = {
      name,
      description: text(spell, 'Description'),
      icon:        text(spell, 'Icon'),
      school:      text(spell, 'School'),
      metamagic:   parseSpellMetamagic(spell),
      damages,
      dcs,
      effects,
    };
    if (spell.querySelector(':scope > Cost'))            out.cost           = num(spell, 'Cost');
    if (spell.querySelector(':scope > MaxCasterLevel'))  out.maxCasterLevel = num(spell, 'MaxCasterLevel');
    if (spell.querySelector(':scope > Cooldown'))        out.cooldown       = parseFloat(text(spell, 'Cooldown'));
    spells.push(out);
  }
  return spells;
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
    return elements(sel, ':scope > EnhancementSelection').map(s => {
      const out: EnhancementSelectionData = {
        name: text(s, 'Name'),
        description: text(s, 'Description'),
        icon: text(s, 'Icon'),
        effects: parseEffectsIn(s),
        stances: parseStancesIn(s),
      };
      // Per-selection CostPerRank overrides the parent enhancement's cost
      // when the user picks this option (e.g. Shadowdancer's Nightmare
      // Lance sets <CostPerRank>2</CostPerRank> on the selection itself).
      const selCost = text(s, 'CostPerRank');
      if (selCost) out.costPerRank = spaceSeparatedNumbers(selCost);
      return out;
    });
  })();

  // Arrow flags are DL_FLAG elements — present = true, absent = false
  const hasFlag = (tag: string) => el.querySelector(tag) !== null;
  // Effects are direct children of the EnhancementTreeItem; the per-Selection
  // effects are captured separately above and don't double-up here.
  const effects = parseEffectsIn(el);
  const stances = parseStancesIn(el);
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
    stances,
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
  const isReaperTree = tree.querySelector(':scope > IsReaperTree') !== null;

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
  const treeName = text(tree, 'Name');
  const items = [...coreItems, ...treeItems];
  return {
    name: treeName,
    version: num(tree, 'Version'),
    icon: text(tree, 'Icon'),
    background,
    classReqs,
    raceReq,
    isUniversal,
    isRacialTree,
    isDestinyTree: background.startsWith('Destiny'),
    isReaperTree,
    items,
  };
}
