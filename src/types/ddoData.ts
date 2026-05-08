// Rich types matching the actual DDO XML data format from DDOBuilderV2

export type SaveType = 'high' | 'low';

// ── Metamagic catalog (project-extended; not in upstream DDOBuilderV2) ───
// One entry per metamagic, sourced from public/data/Metamagics.xml. Used
// by the DPS calculator to turn active-metamagic toggles + per-spell
// eligibility flags into a per-cast SP surcharge.

export interface DDOMetamagicData {
  /** In-game stance name (matches `build.activeMetamagics`). */
  name: string;
  /** Short label for tooltip / breakdown rows. */
  shortName: string;
  /** Per-cast surcharge before reductions. For per-level metamagics
   *  (Heighten) this is the cost per level raised. */
  baseSPCost: number;
  /** Cost shape. Defaults to 'flat' (BaseSPCost added once per cast).
   *  'per-level' = BaseSPCost × (highest castable level − spell.level). */
  costFormula: 'flat' | 'per-level';
  /** Which boolean field on `DDOSpellMetamagic` gates eligibility for
   *  this metamagic. The string `'any'` means "always applicable when
   *  the metamagic is active" (Eschew Materials). */
  spellEligibilityFlag: string;
  /** EffectType name whose collected `Amount` is subtracted from this
   *  metamagic's per-cast surcharge (per-stack reductions from feats,
   *  enhancements, past lives — e.g. `MetamagicCostEmpower`). */
  costReductionEffect: string;
}

// ── Universal Effect / Buff schema ────────────────────────────────────────
// <Effect> blocks appear inside Feats, Items, SetBonuses, Stances, Spells,
// Augments, Filigrees, etc. The schema is the same in all of them.
//
// Mirrors DDOBuilderV2's Effect class. We deliberately keep this as raw
// parsed data — Phase 2's engine consumes these to produce typed Bonuses.

/** AmountType strings from DDOBuilderV2 Effect.h amountTypeMap. */
export type EffectAmountType =
  | 'Unknown'
  | 'NotNeeded'
  | 'Simple'
  | 'Stacks'
  | 'TotalLevel'
  | 'BaseClassLevel'
  | 'ClassLevel'
  | 'ClassCasterLevel'
  | 'APCount'
  | 'AbilityValue'
  | 'AbilityTotal'
  | 'AbilityTotalIndex'
  | 'AbilityMod'
  | 'HalfAbilityMod'
  | 'ThirdAbilityMod'
  | 'Slider'
  | 'SliderValue'
  | 'SliderValueLookup'
  | 'FeatCount'
  | 'SetBonusCount'
  | 'SLA'
  | 'SpellInfo'
  | 'Dice'
  | 'CriticalDice'
  | 'BAB';

export interface DDORequirement {
  type: string;
  item?: string;
  value?: number;
}

export interface DDORequirements {
  /** All required (AND) */
  allOf: DDORequirement[];
  /** Each group is OR-of-requirements; outer is AND */
  oneOf: DDORequirement[][];
  /** Each group is "none of these may be true" */
  noneOf: DDORequirement[][];
}

export interface DDOEffect {
  /** Optional human-readable name distinct from the parent feat/item */
  displayName?: string;
  /** One or more EffectType strings (the same effect can target multiple stat types) */
  types: string[];
  /** Bonus type used for stacking (e.g. 'Feat', 'Equipment', 'Stacking', 'Insight') */
  bonus?: string;
  /** How to interpret `amount`. 'Simple' = scalar; others index `amount[]` by some game value */
  amountType?: EffectAmountType;
  /** Numeric values from <Amount size="N">…</Amount>. Length matches the size attribute. */
  amount: number[];
  /** Sub-targets: e.g. for AbilityBonus, the ability name; for SkillBonus, list of skills */
  items: string[];
  /** Optional gating — most often <Stance> requirements */
  requirements: DDORequirements;
  /** Optional Value1..Value4 fields used by some XML files */
  values: number[];
  /** Optional in-place description (for set bonus / item buff readability) */
  description?: string;
  /**
   * `<Percent/>` flag — value is a percentage of the breakdown's running
   * total instead of a flat bonus. Used for Legendary Conditioning ("15%
   * bonus to Maximum Hit Points"), some MeleePower / RangedPower modifiers.
   * Stacking still applies; same-bonus-type percentages don't stack.
   */
  isPercent?: boolean;
  /**
   * `<ApplyAsItemEffect/>` flag — DDOBuilderV2 treats this effect as if it
   * came from gear, which means it competes via Highest-Only stacking. Effects
   * WITHOUT this flag (most feats, enhancements, destinies) bypass Highest-Only
   * and stack freely (mirrors DDOBuilderV2's m_effects vs m_itemEffects split:
   * see BreakdownItem.cpp::AddFeatEffect / AddEnhancementEffect).
   */
  isApplyAsItemEffect?: boolean;
  /**
   * `<Rank>N</Rank>` — minimum enhancement rank required for this effect to
   * fire. Multi-rank enhancements often define rank-specific perks (e.g.
   * Storm Core grants its spell-power rider only at rank 3); ranks below the
   * threshold skip the effect entirely. Undefined = always fires.
   */
  minRank?: number;
  /**
   * `<StackSource>X</StackSource>` — class name driving level-indexed
   * scaling for ClassLevel / BaseClassLevel / ClassCasterLevel effects
   * that don't carry an `<Item>` tag. Upstream uses this for effects
   * like Arcane Trickster's "Applied Force" (+1 Imbue / 3 AT levels)
   * where the source's class identity is the scaling key rather than
   * an Item targeting subject.
   */
  stackSource?: string;
}

export interface DDOBuffBlock {
  /** Number of equipped set pieces (set bonuses), or 0 for non-set buffs */
  equippedCount: number;
  /** Description shown in the UI */
  description: string;
  /** All effects this buff applies */
  effects: DDOEffect[];
}

// ── ItemBuff catalog (canonical buff template registry) ─────────────────
// Items reference these by buff `type` and provide value1/bonusType/item
// parameters that override the placeholder values in the template effects.
// Resolved at runtime by the engine's item-buff source walker.

export interface ItemBuffCatalogEntry {
  type: string;
  displayText: string;
  effects: DDOEffect[];
  applyToWeaponOnly?: boolean;
  ignore?: string[];
}

export type ItemBuffCatalog = Record<string, ItemBuffCatalogEntry>;

// ── Filigree ───────────────────────────────────────────────────────────────
// Filigrees go in sentient-weapon and artifact slots (up to 10 each).
// Each filigree XML file (`public/data/FiligreeSets/*.xml`) defines BOTH:
//   - `<SetBonus>` blocks (set-bonus tiers for groups of filigrees)
//   - `<Filigree>` blocks (the individual filigree options the user picks)
//
// `<Rare/>`-tagged effects only fire when the filigree slot itself has the
// rare flag set in the build (i.e. user unlocked that filigree's rare bonus).

export interface DDOFiligreeData {
  name: string;
  description: string;
  icon: string;
  /** The filigree set this belongs to (e.g. "Angelic Wings"). */
  setBonus: string;
  /** All effect blocks; ones with `Rare: true` only fire when the slot has rare unlocked. */
  effects: (DDOEffect & { rare?: boolean })[];
}

export interface DDOFiligreeSetBonus {
  name: string;
  icon: string;
  /** Tiered buffs ordered by `equippedCount`. */
  buffs: DDOBuffBlock[];
}

// ── Augment ────────────────────────────────────────────────────────────────
// Each <Augment> in public/data/Augments/*.xml. The `slotTypes` list is what
// item augment-slot types this augment can fit into (e.g. "Red", "Purple").
// Scaling augments use `levels[]` and `levelValues[]` to pick a tier based
// on the item's minimum level.
export interface DDOAugmentData {
  name: string;
  description: string;
  /** Item augment-slot types this augment can be inserted into. */
  slotTypes: string[];
  icon: string;
  /** True if the augment scales with item level (`<ChooseLevel/>` flag). */
  scalesWithLevel: boolean;
  /** Item-level breakpoints; `levels[i]` corresponds to `levelValues[i]`. */
  levels: number[];
  levelValues: number[];
  effects: DDOEffect[];
}

// ── BonusType (stacking rules) ────────────────────────────────────────────
export type BonusStacking = 'Highest Only' | 'Always' | string;

export interface DDOBonusType {
  name: string;
  stacking: BonusStacking;
}

// ── Self / Party buff ─────────────────────────────────────────────────────
// SelfAndPartyBuffs.xml: 138 togglable buffs cast by self or party members
// (Haste, Bless, Recitation, Prayer, Stoneskin, etc.). The build's
// activePartyBuffs list controls which fire their effects through the engine.

export interface DDOOptionalBuff {
  name: string;
  icon: string;
  description: string;
  effects: DDOEffect[];
}

// ── Stance ────────────────────────────────────────────────────────────────
export interface DDOStanceData {
  name: string;
  icon: string;
  description: string;
  group: string;
  /** Has <AutoControlled/> flag — game manages this stance automatically */
  autoControlled: boolean;
  /** Other stance names that turn off when this stance turns on. Same-group
   *  stances are also implicitly mutually exclusive. */
  incompatibleStances: string[];
  requirements: DDORequirements;
}

// ── Weapon Grouping ───────────────────────────────────────────────────────
export interface DDOWeaponGroup {
  name: string;
  weapons: string[];
}

// ── Set Bonus ─────────────────────────────────────────────────────────────
export interface DDOSetBonusData {
  /** The set name, e.g. "Inevitable Balance" */
  type: string;
  icon: string;
  buffs: DDOBuffBlock[];   // one entry per <EquippedCount> tier
}

// ── Item ──────────────────────────────────────────────────────────────────
export type ItemEquipmentSlot =
  | 'Helmet' | 'Necklace' | 'Trinket' | 'Cloak' | 'Belt' | 'Goggles'
  | 'Gloves' | 'Boots'    | 'Bracers' | 'Armor' | 'Weapon1' | 'Weapon2'
  | 'Quiver' | 'Arrow'    | 'Ring1'   | 'Ring2'
  | 'Docent';

export interface DDOItemData {
  name: string;
  icon: string;
  description?: string;
  dropLocation?: string;
  minLevel?: number;
  maxLevel?: number;
  /** Slots this item can be equipped in (some items go in multiple, e.g. Ring1+Ring2) */
  slots: ItemEquipmentSlot[];
  /** Weapon-only fields */
  weapon?: string;
  weaponDamage?: number;
  baseDice?: { number: number; sides: number };
  criticalMultiplier?: number;
  criticalThreatRange?: number;
  attackModifier?: string;
  damageModifier?: string;
  drBypass?: string[];
  material?: string;
  armor?: { ac: number; mdb?: number; acp?: number };
  setBonus?: string;
  /** Per-item buffs (parsed from <Buff> blocks; one effect each here) */
  buffs: DDOBuffBlock[];
  /** Per-item augment slots */
  augmentSlots?: { type: string; description?: string }[];
}

export interface DDOClassData {
  name: string;
  /** For prestige classes (e.g. 'Arcane Trickster'), this is 'Rogue'; null for base classes */
  baseClass: string | null;
  description: string;
  smallIcon: string;
  largeIcon: string;
  hitDie: number;
  skillPointsPerLevel: number;
  classSkills: string[];
  babPerLevel: number[];            // index 0 = level 0 (unused), 1–20 = BAB at that level
  fortSave: SaveType;
  refSave: SaveType;
  willSave: SaveType;
  spellPointsPerLevel: number[];
  /** "Intelligence", "Wisdom", "Charisma" or null for non-casters */
  castingStat: string | null;
  automaticFeats: { level: number; feats: string[] }[];
  featSlots: { level: number; featType: string; options: string[] }[];
  classSpecificFeatType: string | null;
  /** Spells this class learns: name + spell level (1–9), with optional per-class
   *  overrides for SP cost / max caster level / cooldown. Joins by name with
   *  the global DDOSpellData catalog. Empty for non-casters. */
  spells: DDOClassSpell[];
  /** Per-class-level spell slot table.
   *  - Outer index = classLevel - 1 (0..19 for levels 1..20)
   *  - Inner array length = max spell level for the class (4 for Pal/Ran,
   *    6 for Bard/Warlock/Artificer/Alchemist, 9 for Cler/Drd/Wiz/Sor/FvS)
   *  - Inner index = spellLevel - 1; value = number of slots at that spell level
   *  Empty array for non-casters. */
  spellSlotsByLevel: number[][];
  /** `<NotHeroic/>` flag — Epic / Legendary pseudo-classes. They don't grant
   *  past-life feats and are excluded from Completionist requirements. */
  notHeroic?: boolean;
}

// ── Spells ────────────────────────────────────────────────────────────────
// Each <Spell> in Spells.xml. The catalog is global (no class info); class
// linkage lives on `DDOClassData.spells` via `<ClassSpell>` entries in each
// class XML, joined by spell name.

export interface DDOSpellDice {
  /** Base count of dice (e.g. 1 in "1d6+1"). */
  number: number;
  /** Dice size (e.g. 6 in "1d6"). */
  sides: number;
  /** Flat bonus added to each dice roll (e.g. 1 in "1d6+1"). */
  bonus: number;
  /** Set of dice scales: 1 set per N caster levels. Undefined = fixed. */
  perCasterLevels?: number;
  /** Maximum cap on dice count (e.g. "5d6+5" capped at 5 dice). */
  cap?: number;
}

export interface DDOSpellDamage {
  /** Damage element ("Fire", "Cold", "Force", "Electric", "Positive", …). */
  damageType: string;
  /** Spell power school used to scale damage ("Fire", "Force", …). */
  spellPower: string;
  dice: DDOSpellDice;
}

export interface DDOSpellDC {
  /** Effect when save fails ("Negates", "Daze", "Slow", …). */
  dcType: string;
  /** Save type rolled by target ("Will", "Reflex", "Fortitude"). */
  dcVersus: string;
  /** Schools whose focus bonuses add to the DC. */
  schools: string[];
  /** When true, adds the class casting stat modifier to the DC. */
  castingStatMod: boolean;
  /** Optional override ability mods — DC uses the highest of these. */
  modAbility?: string[];
}

export interface DDOSpellMetamagic {
  accelerate?:     true;
  embolden?:       true;
  empower?:        true;
  empowerHealing?: true;
  enlarge?:        true;
  extend?:         true;
  heighten?:       true;
  intensify?:      true;
  maximize?:       true;
  quicken?:        true;
}

export interface DDOSpellData {
  name: string;
  description: string;
  icon: string;
  school: string;
  /** Default global cost; per-class override lives on DDOClassSpell. */
  cost?: number;
  /** Default global cap on caster level; per-class override possible. */
  maxCasterLevel?: number;
  /** Maximum number of distinct enemy targets a single cast can damage.
   *  • 1     — single-target spells (Magic Missile, Niac's Cold Ray, …);
   *            multi-missile spells like MM still cap at 1 target since
   *            all missiles converge on it.
   *  • 100   — uncapped AoE (Fireball, Wall of Fire, Cone of Cold, …);
   *            sentinel for "hits everything in the area." The simulation
   *            won't realistically have more than a handful of targets,
   *            so 100 is plenty of headroom.
   *  • N     — bounded multi-target / chain spells (Chain Missiles,
   *            Chain Lightning) that hit a specific number of distinct
   *            targets per cast.
   *  Undefined = treat as 1 (single-target). */
  maxTargetCap?: number;
  cooldown?: number;
  metamagic: DDOSpellMetamagic;
  damages: DDOSpellDamage[];
  dcs: DDOSpellDC[];
  /** Effects on cast (buffs/auras). Reuses the universal DDOEffect schema. */
  effects: DDOEffect[];
  /** True when this spell deals real in-game damage but lacks modeled
   *  dice rolls in our catalog (e.g. melee SLA strikes from Fury of the
   *  Wild that are entered as `<PlaceholderDamage/>` in Spells.xml). */
  placeholderDamage?: boolean;
  /**
   * Melee weapon-attack abilities: the activation delivers `mhHits`
   * main-hand weapon hits, each scaled by `scalar` (e.g. Quick Cutter:
   * 2 hits at ×1.30 for rank-3 "+30% weapon damage"). Damage is computed
   * from the live melee calc (avgPerHit × scalar × effectiveHits including
   * off-hand and doublestrike), NOT from the spell-dice pipeline.
   */
  weaponAttack?: {
    mhHits: number;
    scalar: number;
    critRangeBonus?: number;
    critMultBonus?: number;
    /** Temporary Doublestrike bonus granted on activation (e.g. Quick Strike +25%). */
    dsBuffPct?: number;
    /** Duration of the DS buff in seconds. */
    dsBuffDuration?: number;
  };
}

export interface DDOClassSpell {
  /** Joins to DDOSpellData by exact (case-sensitive) name match. */
  name: string;
  /** Spell level 1–9 within this class (e.g. Magic Missile is Wizard 1). */
  level: number;
  /** Per-class SP cost override (overrides DDOSpellData.cost when set). */
  cost?: number;
  maxCasterLevel?: number;
  cooldown?: number;
}

export interface DDORaceData {
  name: string;
  shortName: string;
  description: string;
  startingWorld: string;
  buildPoints: number[];            // [28, 32, 34, 36] for different build-point tiers
  bonusSkillPoints: number;         // extra skill points per level
  /** Racial ability mods parsed from <Strength>+2</Strength>, <Dexterity>-2</Dexterity>, etc.
   *  Empty when the race XML omits the tag. */
  abilityMods: { STR?: number; DEX?: number; CON?: number; INT?: number; WIS?: number; CHA?: number };
  featSlots: { level: number; featType: string; options: string[] }[];
  pastLifeFeat: {
    name: string;
    description: string;
    icon: string;
    maxTimesAcquire: number;
  } | null;
  /** `<Iconic/>` flag — Bladeforged, Aasimar Scourge, Deep Gnome, etc.
   *  Iconic races contribute to IconicPastLife, NOT RacialPastLife, so they're
   *  excluded from Racial Completionist requirements. */
  iconic?: boolean;
  /** `<NoPastLife/>` flag — race doesn't grant a past-life feat (e.g. WoodElf).
   *  Excluded from Racial Completionist requirements. */
  noPastLife?: boolean;
}

/**
 * Guild buff: each entry in GuildBuffs.xml grants a set of effects when the
 * player's guild reaches `level`. Engine fires buffs whose `level` ≤
 * `build.guildLevel` while `build.applyGuildBuffs` is true.
 */
export interface DDOGuildBuff {
  name: string;
  description: string;
  level: number;
  effects: DDOEffect[];
}

export type FeatAcquireType = 'Train' | 'Automatic' | 'HeroicPastLife' | 'RacialPastLife' | 'Special';

// Legacy aliases — DDOFeatRequirement / DDOFeatRequirements were the original
// names before the universal Requirements parser was introduced. Kept as
// type aliases so the existing feat parsing code doesn't have to be rewritten.
export type DDOFeatRequirement = DDORequirement;
export type DDOFeatRequirements = DDORequirements;

export interface DDOFeatData {
  name: string;
  description: string;
  icon: string;
  groups: string[];
  acquire: FeatAcquireType;
  maxTimesAcquire: number;
  requirements: DDOFeatRequirements;
  hasSubItems: boolean;
  /** All <Effect> blocks declared on this feat. Empty until Phase 2 parses them. */
  effects: DDOEffect[];
  /** Toggle-able stances this feat grants (e.g. Power Attack, Mountain Stance). */
  stances: DDOStanceData[];
  /**
   * Gate for `acquire === 'Automatic'` feats — DDO grants the feat (and its
   * effects) when these requirements pass. Most are `<SpecificLevel>` checks
   * (e.g. Heroic Durability requires SpecificLevel=1, Improved Heroic
   * Durability has none → always-on). Empty/null = always-on.
   */
  automaticAcquisition?: DDOFeatRequirements;
}

export interface EnhancementSelectionData {
  name: string;
  description: string;
  icon: string;
  /** Effects this selection grants when chosen */
  effects: DDOEffect[];
  /** Stances this selection grants when chosen (e.g. mantle picks). */
  stances: DDOStanceData[];
  /** Per-rank AP cost when this selection is the chosen option. Undefined
   *  → fall back to the parent enhancement's costPerRank table. */
  costPerRank?: number[];
  /** Weapon-attack data for this selector option when it is a melee/ranged
   *  strike (e.g. Legendary Rally Melee, Hand of Harm). */
  weaponAttack?: {
    mhHits: number;
    scalar: number;
    critRangeBonus?: number;
    critMultBonus?: number;
    /** Temporary Doublestrike bonus granted on activation (e.g. Quick Strike +25%). */
    dsBuffPct?: number;
    /** Duration of the DS buff in seconds. */
    dsBuffDuration?: number;
  };
}

export interface EnhancementItemData {
  internalName: string;
  name: string;
  description: string;
  icon: string;
  xPosition: number;
  yPosition: number;
  costPerRank: number[];
  ranks: number;
  minSpent: number;
  isCore: boolean;
  selector: EnhancementSelectionData[] | null;
  /** Effects this enhancement grants per rank. Empty if it has a selector instead. */
  effects: DDOEffect[];
  /** Stances this enhancement grants when taken (e.g. Stalwart Stance). */
  stances: DDOStanceData[];
  /** Requirements for taking this enhancement (class min level, AP spent, etc.) */
  requirements: DDORequirements;
  /** Source XML carries `<Clickie/>` — the enhancement is an activatable
   *  ability (action boost, reaper boost, racial clicky, etc.). The DPS
   *  calculator surfaces these as utility SLAs so the user can drop them
   *  into a rotation. */
  clickie: boolean;
  /** Cooldown in seconds when the clickie is activated. When unset, the
   *  DPS engine falls back to scraping the description text. Encode as
   *  `<Cooldown>30</Cooldown>` in the XML (single value; per-rank
   *  variants use `<Cooldown size="3">15 10 5</Cooldown>`). */
  cooldownSeconds?: number;
  cooldownSecondsByRank?: number[];
  /** Manual UI bucket for the Manage / palette tabs — overrides the
   *  description-text classifier when present. Encode as
   *  `<Category>boost</Category>` (one of damage / heal / boost / cc /
   *  debuff / utility). */
  category?: 'damage' | 'heal' | 'boost' | 'cc' | 'debuff' | 'utility';
  /** Set when the clickie deals damage in-game but our catalog doesn't
   *  have rolls modeled yet — the UI shows a "no rolls" badge. Encode
   *  as `<PlaceholderDamage/>` (empty flag). */
  placeholderDamage?: boolean;
  /** When true, this clickie consumes one charge from the shared
   *  action-boost pool. Encode as `<UsesActionBoostCharge/>`. */
  usesActionBoostCharge?: boolean;
  /** When true, this clickie consumes one charge from the shared
   *  reaper-charge pool. Encode as `<UsesReaperCharge/>` (typically
   *  redundant with the item being in a reaper tree, but explicit). */
  usesReaperCharge?: boolean;
  /** Weapon-attack data for this clickie when it is a melee/ranged strike.
   *  For selector-based items the data lives on the selection, not here. */
  weaponAttack?: {
    mhHits: number;
    scalar: number;
    critRangeBonus?: number;
    critMultBonus?: number;
    /** Temporary Doublestrike bonus granted on activation (e.g. Quick Strike +25%). */
    dsBuffPct?: number;
    /** Duration of the DS buff in seconds. */
    dsBuffDuration?: number;
  };
  // Dependency arrows (stored on the source/prerequisite item)
  arrowUp: boolean;
  arrowLeft: boolean;
  arrowRight: boolean;
  longArrowUp: boolean;
  extraLongArrowUp: boolean;
}

export interface TreeClassReq {
  /** 'Class' = exact prestige match; 'BaseClass' = any class whose base matches */
  matchType: 'Class' | 'BaseClass';
  className: string;
}

export interface EnhancementTreeData {
  name: string;
  version: number;
  icon: string;
  background: string;
  /** Parsed from <Requirements> — all class/race entries that make this tree available */
  classReqs: TreeClassReq[];   // non-empty → class-gated
  raceReq: string | null;      // non-null → race-gated
  isUniversal: boolean;        // feat/favor requirement = available to everyone
  isRacialTree: boolean;       // has <IsRacialTree/>
  isDestinyTree: boolean;      // background starts with "Destiny"
  isReaperTree: boolean;       // has <IsReaperTree/>
  items: EnhancementItemData[];
}

export interface GameData {
  classes: DDOClassData[];
  races: DDORaceData[];
  feats: DDOFeatData[];
  enhancementTrees: EnhancementTreeData[];
}
