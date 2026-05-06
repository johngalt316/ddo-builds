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

/**
 * A named bundle of enhancement / destiny / reaper allocations. Mirrors
 * GearSet — multiple sets per Build, one is active at a time, the engine
 * runs against the active set's data. Lets a player save several "what
 * if I respec into …" configurations side by side and compare DPS.
 *
 * Stances/metamagics/active party buffs deliberately stay outside the
 * set — they're toggleable inputs, not allocations, and the user
 * usually wants them constant across sets being compared.
 */
export interface EnhancementSet {
  name: string;
  enhancements: EnhancementSelection[];
  destinyEnhancements: EnhancementSelection[];
  /** Reaper tree spends. Same shape as enhancements; max MAX_REAPER_TREES (3) trees. */
  reaperEnhancements: EnhancementSelection[];
  /** Names of the up-to-6 heroic enhancement trees the player has selected. */
  selectedEnhancementTrees: string[];
  /** Tracks whether the user has explicitly overridden the auto-derived
   *  tree selection. While false, EnhancementsTab keeps regenerating it
   *  from race + top class. */
  treesManuallyOverridden?: boolean;
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
  /** Named bundles of enhancement / destiny / reaper allocations. The
   *  active set is the source of truth for the engine; switching active
   *  is how the player flips between configurations. There is always at
   *  least one set ("Default") after migration. */
  enhancementSets: EnhancementSet[];
  /** Name of the currently active enhancement set. */
  activeEnhancementSet: string;
  /** @deprecated Replaced by `enhancementSets[active].enhancements`.
   *  Kept on the type for migration: legacy builds carry the flat array,
   *  `migrateEnhancementSets` wraps it into the Default set on load. */
  enhancements?: EnhancementSelection[];
  /** @deprecated See `enhancementSets`. */
  destinyEnhancements?: EnhancementSelection[];
  /** @deprecated See `enhancementSets`. */
  reaperEnhancements?: EnhancementSelection[];
  /** @deprecated See `enhancementSets`. */
  selectedEnhancementTrees?: string[];
  /** @deprecated See `enhancementSets`. */
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
  /**
   * Saved DPS-calculator rotation state. Persisted on the Build so it
   * round-trips through share-URL encoding (the receiver opens the
   * link and sees the same rotation the sender had configured).
   * Sparse — missing keys mean "no rotation configured yet".
   */
  dpsRotation?: DpsRotationState;
}

/**
 * Persisted state for the DPS calculator's magic rotation editor.
 * Shape mirrors `RotationStep` from engine/dps/rotation.ts but is
 * declared inline here to keep types/ free of engine imports.
 */
export interface DpsRotationStep {
  /** Stable React key for drag/drop ordering. */
  key: string;
  /** Joins to MagicAbility.id. */
  abilityId: string;
}

export interface DpsRotationState {
  /** Magic-rotation steps in order (drag-to-reorder list). */
  magicSteps?: DpsRotationStep[];
  /** Ordered subset of trained damaging spells the user marked active.
   *  `undefined` means "first-time use, default to catalog order". */
  activeAbilityIds?: string[];
  /** When true, the optimizer is the authority on rotation order
   *  (drag/reorder disabled in the timeline). */
  auto?: boolean;
}

export const DEFAULT_ABILITY_SCORES: AbilityScores = {
  STR: 8,
  DEX: 8,
  CON: 8,
  INT: 8,
  WIS: 8,
  CHA: 8,
};

export const DEFAULT_ENHANCEMENT_SET_NAME = 'Default';

export function emptyEnhancementSet(name = DEFAULT_ENHANCEMENT_SET_NAME): EnhancementSet {
  return {
    name,
    enhancements: [],
    destinyEnhancements: [],
    reaperEnhancements: [],
    selectedEnhancementTrees: [],
  };
}

export const DEFAULT_BUILD: Build = {
  version: 1,
  name: 'New Build',
  raceId: 'human',
  alignment: 'TN',
  classes: [{ classId: 'fighter', levels: 1 }],
  abilityScores: { ...DEFAULT_ABILITY_SCORES },
  skillRanks: {},
  feats: [],
  enhancementSets: [emptyEnhancementSet()],
  activeEnhancementSet: DEFAULT_ENHANCEMENT_SET_NAME,
  gearSets: [],
  activeGearSet: '',
  activeStances: [],
  levelClasses: [],
  abilityTomes: {},
  skillTomes: {},
  levelUps: {},
  specialFeats: [],
};

/** Stable empty-set ref so callers reading from a malformed build don't
 *  see a fresh ref each render (which would invalidate every useMemo /
 *  useEffect depending on the active set). */
const EMPTY_ENHANCEMENT_SET: EnhancementSet = Object.freeze({
  name: DEFAULT_ENHANCEMENT_SET_NAME,
  enhancements:             [],
  destinyEnhancements:      [],
  reaperEnhancements:       [],
  selectedEnhancementTrees: [],
}) as EnhancementSet;

/**
 * Read the currently-active EnhancementSet from a Build. After
 * migration there's always at least one set, so this never returns
 * undefined for a well-formed Build. Falls back to the first set when
 * `activeEnhancementSet` doesn't match a known name (defensive).
 */
export function getActiveEnhancementSet(build: Build): EnhancementSet {
  const sets = build.enhancementSets;
  if (sets && sets.length > 0) {
    const found = sets.find(s => s.name === build.activeEnhancementSet);
    return found ?? sets[0]!;
  }
  // Defensive: a malformed build with no sets — return a frozen
  // module-level empty set so the reference is stable across calls.
  // (A fresh `emptyEnhancementSet()` per call would change ref every
  // render and trigger infinite re-render loops in any consumer that
  // depends on the active set.)
  return EMPTY_ENHANCEMENT_SET;
}

/**
 * Return a new Build with the active EnhancementSet replaced by
 * `mutator(activeSet)`. Used by store actions that update enhancement /
 * destiny / reaper / selectedEnhancementTrees on the active set without
 * touching the other sets.
 */
export function withActiveEnhancementSet(
  build: Build,
  mutator: (set: EnhancementSet) => EnhancementSet,
): Build {
  const active = getActiveEnhancementSet(build);
  const next   = mutator(active);
  const sets   = build.enhancementSets ?? [];
  // Ensure both fields are always populated after this — a malformed
  // input build (sets present but activeEnhancementSet undefined, or
  // vice versa) is healed here so downstream consumers never see a
  // partial state that would break getActiveEnhancementSet.
  const nextSets = sets.length === 0
    ? [next]
    : sets.map(s => (s.name === active.name ? next : s));
  const nextActive = next.name === active.name
    ? (build.activeEnhancementSet || next.name)
    : next.name;
  return {
    ...build,
    enhancementSets:      nextSets,
    activeEnhancementSet: nextActive,
  };
}

/**
 * Older builds — and any share URL minted before 2026-05 — stored
 * metamagics by their short label ("Empower", "Maximize"). The Stances
 * panel and DPS-calculator now address them by their in-game stance
 * name ("Empower Spell", "Maximize Spell"). Rewrite any legacy short
 * names so the existing toggles keep working after load.
 *
 * Idempotent — already-renamed names pass through unchanged.
 */
const METAMAGIC_NAME_LEGACY: Record<string, string> = {
  'Empower':         'Empower Spell',
  'Empower Healing': 'Empower Healing Spell',
  'Maximize':        'Maximize Spell',
  'Quicken':         'Quicken Spell',
  'Heighten':        'Heighten Spell',
  'Intensify':       'Intensify Spell',
  'Embolden':        'Embolden Spell',
  'Enlarge':         'Enlarge Spell',
  'Extend':          'Extend Spell',
  'Accelerate':      'Accelerate Spell',
};

export function migrateMetamagicNames(raw: Build): Build {
  const cur = raw.activeMetamagics;
  if (!cur || cur.length === 0) return raw;
  let changed = false;
  const next = cur.map(n => {
    const mapped = METAMAGIC_NAME_LEGACY[n];
    if (mapped) { changed = true; return mapped; }
    return n;
  });
  if (!changed) return raw;
  return { ...raw, activeMetamagics: next };
}

/**
 * Bring a possibly-legacy Build (flat enhancement fields, no
 * enhancementSets) into the new shape. Idempotent: no-op when the
 * build already has at least one set.
 *
 * Strips the deprecated flat fields after wrapping them so we don't
 * have two sources of truth lying around.
 */
export function migrateEnhancementSets(raw: Build): Build {
  // Always run the metamagic-name rewrite — both the wrapped and
  // already-migrated branches below benefit, and it's a no-op for new
  // builds that never carried the legacy short names.
  raw = migrateMetamagicNames(raw);
  if (raw.enhancementSets && raw.enhancementSets.length > 0) {
    // Strip deprecated flat fields if any straggler is set.
    const {
      enhancements: _e, destinyEnhancements: _d, reaperEnhancements: _r,
      selectedEnhancementTrees: _s, treesManuallyOverridden: _t,
      ...rest
    } = raw;
    void _e; void _d; void _r; void _s; void _t;
    return rest as Build;
  }
  const set: EnhancementSet = {
    name: DEFAULT_ENHANCEMENT_SET_NAME,
    enhancements:             raw.enhancements             ?? [],
    destinyEnhancements:      raw.destinyEnhancements      ?? [],
    reaperEnhancements:       raw.reaperEnhancements       ?? [],
    selectedEnhancementTrees: raw.selectedEnhancementTrees ?? [],
    treesManuallyOverridden:  raw.treesManuallyOverridden,
  };
  const {
    enhancements: _e, destinyEnhancements: _d, reaperEnhancements: _r,
    selectedEnhancementTrees: _s, treesManuallyOverridden: _t,
    ...rest
  } = raw;
  void _e; void _d; void _r; void _s; void _t;
  return {
    ...rest,
    enhancementSets:      [set],
    activeEnhancementSet: DEFAULT_ENHANCEMENT_SET_NAME,
  };
}
