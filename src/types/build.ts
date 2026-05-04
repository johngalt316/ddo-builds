export type Stat = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';

export type Alignment =
  | 'LG' | 'LN' | 'LE'
  | 'NG' | 'TN' | 'NE'
  | 'CG' | 'CN' | 'CE';

export interface AbilityScores {
  STR: number;
  DEX: number;
  CON: number;
  INT: number;
  WIS: number;
  CHA: number;
}

export interface ClassLevel {
  classId: string;
  levels: number;
}

export interface SkillRanks {
  [skillId: string]: number;
}

export interface SelectedFeat {
  slotIndex: number;
  featId: string;
}

export interface EnhancementSelection {
  treeId: string;
  enhancements: { enhancementId: string; selection?: string; tier: number; rank: number }[];
}

// ── Gear ────────────────────────────────────────────────────────────

export type GearSlot =
  | 'Helmet' | 'Necklace' | 'Trinket' | 'Cloak' | 'Belt' | 'Goggles'
  | 'Gloves' | 'Boots'    | 'Bracers' | 'Armor' | 'MainHand' | 'OffHand'
  | 'Quiver' | 'Arrow'    | 'Ring1'   | 'Ring2';

export interface GearBuff {
  type: string;
  value1?: number;
  value2?: number;
  bonusType?: string;
  item?: string;
  description1?: string;
}

/** A single augment slot on a gear item. `slotType` is the colour/category
 *  ("Green", "Yellow", "Colorless", "Mythic", etc.); `selectedAugment` is the
 *  name of the augment currently equipped (or undefined). `selectedLevelIndex`
 *  picks a tier for scaling augments (e.g. Doublestrike at index 19 = ML34). */
export interface ItemAugmentSlot {
  slotType: string;
  selectedAugment?: string;
  selectedLevelIndex?: number;
}

export interface GearItem {
  slot: GearSlot;
  name: string;
  icon: string;
  description?: string;
  dropLocation?: string;
  minLevel?: number;
  material?: string;
  setBonus?: string;
  buffs: GearBuff[];
  augmentSlots?: ItemAugmentSlot[];
}

/** A single filigree slot. `name` is the filigree's name (empty/undefined =
 *  empty slot). `rare` is the unlocked rare-effect flag — when true, the
 *  filigree's `<Rare/>`-gated effects fire in addition to the base ones. */
export interface FiligreeSlot {
  name?: string;
  rare?: boolean;
}

export interface GearSet {
  name: string;
  items: GearItem[];
  /** Sentient-weapon filigree slots, up to MAX_FILIGREE (10). Sparse: empty slots have no `name`. */
  filigrees?: FiligreeSlot[];
  /** Artifact filigree slots, up to MAX_ARTIFACT_FILIGREE (5). */
  artifactFiligrees?: FiligreeSlot[];
}

export interface Build {
  version: number;
  name: string;
  raceId: string;
  alignment: Alignment;
  classes: ClassLevel[];
  abilityScores: AbilityScores;
  skillRanks: SkillRanks;
  feats: SelectedFeat[];
  enhancements: EnhancementSelection[];
  destinyEnhancements: EnhancementSelection[];
  /** Reaper tree spends. Same shape as enhancements; max MAX_REAPER_TREES (3) trees. */
  reaperEnhancements: EnhancementSelection[];
  /** Names of the up-to-6 heroic enhancement trees the player has selected */
  selectedEnhancementTrees: string[];
  /**
   * True once the user has explicitly toggled a tree (via `toggleTree`) or
   * imported a build with selected trees. While false, the EnhancementsTab
   * auto-derives the selection from race + top class on every change.
   * Once flipped to true, the selection is locked in and only changes via
   * explicit user action.
   */
  treesManuallyOverridden?: boolean;
  /** Equipped gear sets (typically named "Standard", "Leveling", etc.) */
  gearSets: GearSet[];
  /** Name of the currently active gear set */
  activeGearSet: string;
  /** Currently-active stance names. Stance-gated effects fire only when their stance is in this list. */
  activeStances: string[];
  /**
   * Per-level class assignment: `levelClasses[i]` is the classId taken at
   * character level (i+1). Optional — if absent, derived from `classes`
   * by interleaving (classes[0] fills first, then classes[1], …) when needed.
   * The engine still reads `classes` for stat math; this field exists so the
   * UI can show & edit which class each level is.
   */
  levelClasses?: string[];
  /**
   * Per-stat ability tomes. Value = bonus the tome grants (max +8 in DDO).
   * Folded into `effectiveScores` after racial bonuses.
   */
  abilityTomes?: Partial<Record<Stat, number>>;
  /**
   * Per-skill skill tomes. Value = +N to the skill's max-rank cap (max +5 in DDO).
   * Read by `calculateSkillBonuses` to extend `maxRanks`.
   */
  skillTomes?: Record<string, number>;
  /**
   * Level-up ability assignments. Maps tier-level (4, 8, 12, 16, 20, 24, …, 40)
   * to the chosen Stat. Each grants a permanent +1 to that ability.
   * Sparse: missing keys = no choice made yet for that tier.
   */
  levelUps?: Partial<Record<number, Stat>>;
  /**
   * Past life feats and other character-wide special feats. Each entry's
   * `rank` is how many stacks the character has (max usually 3). The
   * `type` matches DDOBuilderV2's FeatAcquireType: HeroicPastLife,
   * RacialPastLife, IconicPastLife, EpicPastLife, UniversalTree,
   * EpicDestinyTree, or any other special feat type. The engine treats
   * each rank as a separate Effect application.
   */
  specialFeats?: { featId: string; type: string; rank: number }[];
  /**
   * Trained spells per casting class, per spell level. The user picks N
   * names per spell-level row up to the slot count from the class XML's
   * <LevelK> table. Spell-level keys are stringified ("1".."9") for stable
   * JSON shape. Sparse: missing class/level = no spells trained there yet.
   */
  trainedSpells?: Record<string, Record<string, string[]>>;
  /**
   * Globally-active metamagic toggles ("Empower", "Maximize", "Quicken",
   * "Heighten", "Empower Healing", "Intensify", "Embolden", "Enlarge",
   * "Extend", "Accelerate"). When enabled, the engine applies the
   * metamagic's cost/effect to compatible spells.
   */
  activeMetamagics?: string[];
  /**
   * Currently-active self/party buffs (Haste, Bless, Recitation, Prayer, …).
   * Names match `DDOOptionalBuff.name`. Each enabled buff fires its effects
   * through the engine.
   */
  activePartyBuffs?: string[];
  /**
   * Action point tomes per pool. Standard AP has no in-game tome and isn't
   * tracked. Racial / Universal each accept up to +3 from tomes (caps in
   * buildStore: MAX_*_AP_TOME).
   */
  enhancementTomes?: { racial?: number; universal?: number };
  /**
   * Epic / Legendary character levels (DDO post-heroic levels 21+). Stored
   * separately from `classes` because Epic and Legendary are pseudo-classes
   * that don't grant class features — only HP, BAB, and ability progression.
   * Engine adds (epicLevels × 10) HP and CON-mod-per-epic-level to the HP seed.
   */
  epicLevels?: number;
  /**
   * Character's guild level (1–200). Each guild buff in GuildBuffs.xml has a
   * `<Level>N</Level>` threshold; the engine fires buffs whose threshold ≤
   * guildLevel when `applyGuildBuffs` is on.
   */
  guildLevel?: number;
  /**
   * If true, guild buffs are applied (the player's guild has them ON).
   * If false, no guild buffs apply regardless of guildLevel.
   */
  applyGuildBuffs?: boolean;
}

export const DEFAULT_ABILITY_SCORES: AbilityScores = {
  STR: 8,
  DEX: 8,
  CON: 8,
  INT: 8,
  WIS: 8,
  CHA: 8,
};

export const DEFAULT_BUILD: Build = {
  version: 1,
  name: 'New Build',
  raceId: 'human',
  alignment: 'TN',
  classes: [{ classId: 'fighter', levels: 1 }],
  abilityScores: { ...DEFAULT_ABILITY_SCORES },
  skillRanks: {},
  feats: [],
  enhancements: [],
  destinyEnhancements: [],
  reaperEnhancements: [],
  selectedEnhancementTrees: [],
  gearSets: [],
  activeGearSet: '',
  activeStances: [],
  levelClasses: [],
  abilityTomes: {},
  skillTomes: {},
  levelUps: {},
  specialFeats: [],
};
