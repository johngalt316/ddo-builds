// Rich types matching the actual DDO XML data format from DDOBuilderV2

export type SaveType = 'high' | 'low';

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

// ── BonusType (stacking rules) ────────────────────────────────────────────
export type BonusStacking = 'Highest Only' | 'Always' | string;

export interface DDOBonusType {
  name: string;
  stacking: BonusStacking;
}

// ── Stance ────────────────────────────────────────────────────────────────
export interface DDOStanceData {
  name: string;
  icon: string;
  description: string;
  group: string;
  /** Has <AutoControlled/> flag — game manages this stance automatically */
  autoControlled: boolean;
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
}

export interface DDORaceData {
  name: string;
  shortName: string;
  description: string;
  startingWorld: string;
  buildPoints: number[];            // [28, 32, 34, 36] for different build-point tiers
  bonusSkillPoints: number;         // extra skill points per level
  featSlots: { level: number; featType: string; options: string[] }[];
  pastLifeFeat: {
    name: string;
    description: string;
    icon: string;
    maxTimesAcquire: number;
  } | null;
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
}

export interface EnhancementSelectionData {
  name: string;
  description: string;
  icon: string;
  /** Effects this selection grants when chosen */
  effects: DDOEffect[];
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
  /** Requirements for taking this enhancement (class min level, AP spent, etc.) */
  requirements: DDORequirements;
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
  items: EnhancementItemData[];
}

export interface GameData {
  classes: DDOClassData[];
  races: DDORaceData[];
  feats: DDOFeatData[];
  enhancementTrees: EnhancementTreeData[];
}
