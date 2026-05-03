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
}

export interface GearSet {
  name: string;
  items: GearItem[];
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
  /** Names of the up-to-6 heroic enhancement trees the player has selected */
  selectedEnhancementTrees: string[];
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
