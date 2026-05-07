// Phase 6.4.3 — Proc catalog.
//
// A `Proc` is a damage source that decorates one or more spells (or every
// cast). Procs come from class feats, item buffs, augments, set bonuses,
// or capstone enhancements; each one expands into a `DamageComponent` the
// calculator can sum just like a spell base hit.
//
// Two flavors live in this file:
//
//   1. STATIC_PROC_CATALOG — data-driven entries for procs whose damage,
//      damage type, and scale profile are fixed. Add a row → catalog grows.
//      Used for the long tail of on-spellcast procs from the wiki list.
//
//   2. Dynamic procs (Magical Ambush, capstone procs) — coded directly
//      because their dice count or qty depends on build-derived inputs
//      (sneak attack dice, projectile count, etc.).
//
// Both flavors land in the same `PROC_CATALOG` array consumed by
// `expandActiveProcs`.

import type { Build, GearItem } from '@/types/build';
import { getActiveEnhancementSet } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import type { DamageComponent, DamageScaleProfile } from './damage';
import type { SpellDamageType } from '@/engine/breakdowns';
import { projectileCount } from './spellRules';

/**
 * Inputs required by procs that aren't (yet) surfaced as breakdowns on the
 * engine result. Caller must supply explicitly.
 */
export interface ProcContext {
  /** Total sneak-attack dice the build accumulates. Drives Magical Ambush. */
  sneakAttackDice: number;
}

/** A spell currently in the user's active rotation. */
export interface ActiveSpell {
  /** Spell name as known by spellRules.ts and the spell catalog. */
  name: string;
  /** Effective caster level for this spell. */
  casterLevel: number;
}

export interface Proc {
  /** Stable id used for breakdown rows and tests. */
  id: string;
  /** Display name in the breakdown UI. */
  label: string;
  /** True if the build qualifies for this proc. */
  isActive: (build: Build, engine: EngineResult) => boolean;
  /** Expand into damage components given the active rotation. */
  toComponents: (
    build: Build,
    engine: EngineResult,
    ctx: ProcContext,
    activeSpells: ActiveSpell[],
  ) => DamageComponent[];
}

// ── Build helpers ────────────────────────────────────────────────────────

function activeGearItems(build: Build): GearItem[] {
  const set =
    build.gearSets.find(g => g.name === build.activeGearSet) ??
    build.gearSets[0];
  return set?.items ?? [];
}

export function hasItemBuff(build: Build, buffType: string): boolean {
  return activeGearItems(build).some(it =>
    it.buffs.some(b => b.type === buffType),
  );
}

export function hasAugmentSlotted(build: Build, augmentName: string): boolean {
  return activeGearItems(build).some(it =>
    it.augmentSlots?.some(s => s.selectedAugment === augmentName),
  );
}

// ── Static-catalog data shape ────────────────────────────────────────────

/**
 * Where a proc comes from. The matching helper decides whether the build
 * has the source equipped/taken.
 *
 *   • item-buff — a named entry on a gear item's `buffs` (e.g. Obsidian
 *                 weapons carry "Dripping with Magma").
 *   • augment   — a named augment slotted on a gear item.
 */
type ProcSource =
  | { kind: 'item-buff'; name: string }
  | { kind: 'augment';   name: string };

/**
 * Definition of a static (data-driven) proc. Adding a new on-spellcast
 * proc is one entry here unless the proc's dice / qty depend on a
 * build-derived input — those still need code.
 */
interface StaticProcEntry {
  id: string;
  label: string;
  source: ProcSource;
  /** Pre-rolled dice average is `count × (sides + 1) / 2`. */
  diceCount: number;
  diceSides: number;
  damageType: SpellDamageType;
  /** Defaults to 'proc' (metamagic-only SP) per the wiki's general rule
   *  that on-spellcast procs do not scale with element spell power. Set
   *  explicitly for any proc that's an exception. */
  scaleProfile?: DamageScaleProfile;
  useGenericVuln?: boolean;
  useSonicVuln?:   boolean;
  useMRR?:         boolean;
  /** When true, the proc shows in the Active Procs list with a TODO
   *  badge but contributes 0 to total damage. Used for procs whose
   *  upstream XML carries no `<Effect>` block and whose dice / rate
   *  haven't been confirmed against the AT DPS reference spreadsheet. */
  placeholderDamage?: boolean;
}

function entryToProc(entry: StaticProcEntry): Proc {
  const avg = entry.placeholderDamage
    ? 0
    : entry.diceCount * (entry.diceSides + 1) / 2;
  const predicate: (build: Build) => boolean =
    entry.source.kind === 'item-buff'
      ? (build) => hasItemBuff(build, entry.source.name)
      : (build) => hasAugmentSlotted(build, entry.source.name);
  return {
    id: entry.id,
    label: entry.label,
    isActive: predicate,
    toComponents: () => [{
      label: entry.label,
      trigger: { kind: 'per-cast' },
      qtyPerTrigger: 1,
      avgDicePerHit: avg,
      damageType: entry.damageType,
      scaleProfile: entry.scaleProfile ?? 'proc',
      useGenericVuln: entry.useGenericVuln,
      useSonicVuln:   entry.useSonicVuln,
      useMRR:         entry.useMRR,
      placeholderDamage: entry.placeholderDamage,
    }],
  };
}

// ── Static catalog (data-driven) ─────────────────────────────────────────

/**
 * On-spellcast procs whose damage shape is fully captured by source +
 * dice + damage type + flags. The wiki's full Category:On-Spellcast_Procs
 * list has ~47 entries; this array is the seed and grows over time.
 *
 * scaleProfile defaults to 'proc' (metamagic-only SP) per the wiki's
 * general rule. Add `scaleProfile: 'spell'` only on the rare proc whose
 * description explicitly says it scales with element spell power.
 */
const STATIC_PROC_CATALOG: StaticProcEntry[] = [
  // ── Mythic item-buff DoT procs (50d20 of the element) ────────────────
  // All of these share the wording "Your attacks and offensive spells
  // have a high chance to deal very strong <element> damage over time"
  // and use the same dice template per the AT DPS reference spreadsheet.
  {
    id: 'dripping-with-magma',
    label: 'Dripping with Magma',
    source: { kind: 'item-buff', name: 'Dripping with Magma' },
    diceCount: 50, diceSides: 20,
    damageType: 'Fire',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'bitter-frostbite',
    label: 'Bitter Frostbite',
    source: { kind: 'item-buff', name: 'Bitter Frostbite' },
    diceCount: 50, diceSides: 20,
    damageType: 'Cold',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'grip-of-venom',
    label: 'Grip of Venom',
    source: { kind: 'item-buff', name: 'Grip of Venom' },
    diceCount: 50, diceSides: 20,
    damageType: 'Poison',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'lightning-lash',
    label: 'Lightning Lash',
    source: { kind: 'item-buff', name: 'Lightning Lash' },
    diceCount: 50, diceSides: 20,
    damageType: 'Electric',
    useGenericVuln: true, useMRR: true,
  },
  {
    // Carried by alchemical Earth Attunement gear (e.g. Bound Elemental
    // Ring of Acid, The Autumn Equinox, The Theurgy of Autumn).
    // In-game description: "Attacks and offensive spells deal stacking
    // acid damage over time." Distinct dice from the Mythic family —
    // 50d10 instead of 50d20 per the spreadsheet.
    id: 'earth-attunement',
    label: 'Alchemical Earth Attunement',
    source: { kind: 'item-buff', name: 'AlchemicalEarthAttunement' },
    diceCount: 50, diceSides: 10,
    damageType: 'Acid',
    useGenericVuln: true, useMRR: true,
  },

  // ── Lamordia "Woeful X" augment family (50d20 of the element) ────────
  // Augment-source variants of the Mythic item-buff DoTs. Same template
  // and dice; the user typically slots one or the other (they don't
  // double up since the in-game effect category is shared).
  {
    id: 'woeful-magma',
    label: 'Woeful Magma',
    source: { kind: 'augment', name: 'Woeful Magma (Legendary)' },
    diceCount: 50, diceSides: 20,
    damageType: 'Fire',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'woeful-frostbite',
    label: 'Woeful Frostbite',
    source: { kind: 'augment', name: 'Woeful Frostbite (Legendary)' },
    diceCount: 50, diceSides: 20,
    damageType: 'Cold',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'woeful-lightning',
    label: 'Woeful Lightning',
    source: { kind: 'augment', name: 'Woeful Lightning (Legendary)' },
    diceCount: 50, diceSides: 20,
    damageType: 'Electric',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'woeful-acidburn',
    label: 'Woeful Acidburn',
    source: { kind: 'augment', name: 'Woeful Acidburn (Legendary)' },
    diceCount: 50, diceSides: 20,
    damageType: 'Acid',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'woeful-venom',
    label: 'Woeful Venom',
    source: { kind: 'augment', name: 'Woeful Venom (Legendary)' },
    diceCount: 50, diceSides: 20,
    damageType: 'Poison',
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'woeful-energy',
    label: 'Woeful Energy',
    source: { kind: 'augment', name: 'Woeful Energy (Legendary)' },
    diceCount: 50, diceSides: 20,
    damageType: 'Force',
    useGenericVuln: true, useMRR: true,
  },
  {
    // Spreadsheet calls this "Rupturing Echoes"; in our data the augment
    // is named "Woeful Echoes (Legendary)".
    id: 'woeful-echoes',
    label: 'Woeful Echoes',
    source: { kind: 'augment', name: 'Woeful Echoes (Legendary)' },
    diceCount: 50, diceSides: 20,
    damageType: 'Sonic',
    useGenericVuln: true, useSonicVuln: true, useMRR: true,
  },

  // ── Other modeled procs ──────────────────────────────────────────────
  {
    // Carried by The Slayer of the Living. Wiki: "On offensive spellcast:
    // 2d6 Force Damage." Affected by Force crit chance + crit damage; no
    // SP scaling beyond metamagic. Ignores generic/sonic vuln + MRR per
    // the reference spreadsheet's debuff flags.
    id: 'revel-in-blood-magic',
    label: 'Revel in Blood',
    source: { kind: 'item-buff', name: 'Revel in Blood (Magic)' },
    diceCount: 2, diceSides: 6,
    damageType: 'Force',
  },
  {
    // "On Harmful Spellcast: Do an additional 2 to 12 Light damage. This
    // effect scales with Light Spell Power. Cooldown: 1 second." The
    // explicit dice + element + scaling are all spelled out in the
    // ItemBuffs.xml display text. Modeled as 2d6 (avg 7, range 2-12) on
    // the 'spell' profile. The 1s ICD is currently ignored — most spell
    // rotations cast slower than 1/sec, so it's effectively never gating
    // (TODO: revisit once the ICD trigger is implemented).
    id: 'radiant-glory',
    label: 'Radiant Glory',
    source: { kind: 'item-buff', name: 'Radiant Glory' },
    diceCount: 2, diceSides: 6,
    damageType: 'Light/Alignment',
    scaleProfile: 'spell',
    useGenericVuln: true, useMRR: true,
  },

  // ── TODO: damage values not yet known ────────────────────────────────
  // These procs are recognized (their source gear/augments are
  // detected and the chip shows up in the Active Procs list with a
  // "TODO" badge) but contribute 0 damage until the dice / proc rate
  // are confirmed against the AT DPS reference spreadsheet. The
  // upstream XML carries only a <DisplayText> — no <Effect> block.
  {
    id: 'alchemical-air-attunement',
    label: 'Alchemical Air Attunement',
    source: { kind: 'item-buff', name: 'AlchemicalAirAttunement' },
    diceCount: 0, diceSides: 0, damageType: 'Electric',
    placeholderDamage: true,
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'alchemical-fire-attunement',
    label: 'Alchemical Fire Attunement',
    source: { kind: 'item-buff', name: 'AlchemicalFireAttunement' },
    diceCount: 0, diceSides: 0, damageType: 'Fire',
    placeholderDamage: true,
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'alchemical-water-attunement',
    label: 'Alchemical Water Attunement',
    source: { kind: 'item-buff', name: 'AlchemicalWaterAttunement' },
    diceCount: 0, diceSides: 0, damageType: 'Cold',
    placeholderDamage: true,
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'legendary-vile-grip',
    label: 'Legendary Vile Grip of the Hidden Hand',
    source: { kind: 'item-buff', name: 'Legendary Vile Grip of the Hidden Hand' },
    diceCount: 0, diceSides: 0, damageType: 'Evil',
    placeholderDamage: true,
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'legendary-steam',
    label: 'Legendary Steam',
    source: { kind: 'item-buff', name: 'Legendary Steam' },
    // Description says "Untyped damage" but our damage-type union
    // doesn't include 'Untyped' (DDO's Untyped doesn't bypass anything
    // material so we'd treat it like force). Park as Force for now.
    diceCount: 0, diceSides: 0, damageType: 'Force',
    placeholderDamage: true,
    useGenericVuln: true, useMRR: true,
  },
  {
    id: 'legendary-radiance',
    label: 'Legendary Radiance',
    source: { kind: 'item-buff', name: 'Legendary Radiance' },
    diceCount: 0, diceSides: 0, damageType: 'Light/Alignment',
    placeholderDamage: true,
    useGenericVuln: true, useMRR: true,
  },
  {
    // Debuff-flavored proc (1d3 negative levels, 30s CD). Won't
    // contribute direct damage even when modeled — the negative
    // levels reduce the target's max HP and to-hit, which is a
    // category we don't model yet. Surface it as TODO so users
    // know the gear's effect is recognized.
    id: 'legendary-negation',
    label: 'Legendary Negation',
    source: { kind: 'item-buff', name: 'Legendary Negation' },
    diceCount: 0, diceSides: 0, damageType: 'Negative',
    placeholderDamage: true,
    useGenericVuln: true, useMRR: true,
  },
];

// ── Dynamic procs (build-derived dice / qty) ─────────────────────────────

/**
 * Magical Ambush — Arcane Trickster level 8 automatic feat.
 *
 *   "Your offensive instantaneous damaging spells deal additional 1d6 force
 *    damage equal to your sneak attack dice. Scales with 50% of force spell
 *    power."
 *
 * The AT capstone "Master of Trickery" (`ArcaneTricksterCore6`) bumps the
 * scaling to 100% of Force Spell Power per the in-game description.
 *
 * Stays in code (not the static catalog) because:
 *   • dice count = sneak attack dice (build-derived)
 *   • qty per trigger = projectileCount(spell, CL) (per-spell)
 *   • scale profile = 'sneak' (50% Force SP) without the capstone, or
 *     'spell' (full Force SP) with it.
 */
function hasMasterOfTrickery(build: Build): boolean {
  const at = getActiveEnhancementSet(build).enhancements.find(t => t.treeId === 'Arcane Trickster');
  if (!at) return false;
  return at.enhancements.some(e => e.enhancementId === 'ArcaneTricksterCore6' && e.rank >= 1);
}

export const MAGICAL_AMBUSH: Proc = {
  id: 'magical-ambush',
  label: 'Magical Ambush',
  isActive: (build) =>
    build.classes.some(c => c.classId === 'arcane_trickster' && c.levels >= 8),
  toComponents: (build, _engine, ctx, activeSpells) => {
    if (ctx.sneakAttackDice <= 0) return [];
    const avg = ctx.sneakAttackDice * 3.5;   // Nd6 average
    const profile = hasMasterOfTrickery(build) ? 'spell' : 'sneak';
    // Magical Ambush fires PER MISSILE in DDO — a 5-missile Magic
    // Missile cast triggers it 5 times, each adding the sneak-attack
    // dice to that one missile. Modeled as `per-hit` with `qty=1`
    // so the engine multiplies by `projectileCount(spell)` at trigger
    // resolution (matches the in-game per-missile attribution and
    // makes the displayed `triggers/min × dmg/trigger = total dmg`
    // match the user's mental model). The previous `per-cast` model
    // bundled all missiles into one trigger of N×damage — same total
    // damage but harder to reconcile with the in-game tooltip.
    return activeSpells.map(s => ({
      label: `Magical Ambush (${s.name})`,
      groupLabel: 'Magical Ambush',
      trigger: { kind: 'per-hit', spell: s.name },
      qtyPerTrigger: 1,
      avgDicePerHit: avg,
      damageType: 'Force',
      scaleProfile: profile,
      useGenericVuln: true,
      useMRR: true,
    }));
  },
};

/**
 * Shiradi Champion Destiny Mantle.
 *
 * Two distinct procs work together:
 *
 *   1. Prism (`U51ShiradiChampionPrism`, Tier 1) — base mantle:
 *      7d77 of a RANDOM damage type at 7% per spell hit (capped 1
 *      fire per cast). Each fire scales with the rolled element's
 *      Spell Power, so long-run avg damage uses mean-element scaling
 *      (the 'random' scale profile).
 *
 *   2. Stay X (`U51ShiradiChampionStay`, Tier 2 selector) — locks
 *      the proc damage to a specific element with rank-scaling dice:
 *        rank 1 → 1d77 of locked element
 *        rank 2 → 3d77
 *        rank 3 → 7d77 + 1d77 per 7 bonus Imbue Dice
 *      Uses standard 'spell' scale profile against the locked element.
 *      Independent 7%-per-missile / cap-1-per-cast roll.
 *
 *   Stay Good   → Light/Alignment
 *   Stay Loud   → Sonic
 *   Stay Strong → Force
 *   Stay Toxic  → Poison
 *
 * Both procs roll per missile but fire at most once per cast, so the
 * effective per-cast probability is 1 - (1 - 7%)^missileCount.
 */
const STAY_TO_ELEMENT: Record<string, SpellDamageType> = {
  'Stay Good':   'Light/Alignment',
  'Stay Loud':   'Sonic',
  'Stay Strong': 'Force',
  'Stay Toxic':  'Poison',
};

/** Per-missile fire chance for Shiradi spells (Prism + Stay X). */
const SHIRADI_SPELL_CHANCE = 0.07;
/** d77 average. */
const D77_AVG = (1 + 77) / 2;

function hasShiradiPrism(build: Build): boolean {
  const sc = getActiveEnhancementSet(build).destinyEnhancements.find(d => d.treeId === 'Shiradi Champion');
  if (!sc) return false;
  return sc.enhancements.some(e => e.enhancementId === 'U51ShiradiChampionPrism' && e.rank >= 1);
}

function shiradiStaySelection(
  build: Build,
): { selection: string; element: SpellDamageType; rank: number } | null {
  const sc = getActiveEnhancementSet(build).destinyEnhancements.find(d => d.treeId === 'Shiradi Champion');
  if (!sc) return null;
  const stay = sc.enhancements.find(e => e.enhancementId === 'U51ShiradiChampionStay');
  if (!stay) return null;
  const sel = stay.selection;
  if (!sel) return null;
  const element = STAY_TO_ELEMENT[sel];
  if (!element) return null;
  return { selection: sel, element, rank: stay.rank };
}

/**
 * Stay X dice-count by rank. Rank 3 adds bonus dice from imbue:
 * +1d77 per 7 bonus imbue dice.
 */
function stayXDiceCount(rank: number, imbueDice: number): number {
  if (rank <= 0) return 0;
  if (rank === 1) return 1;
  if (rank === 2) return 3;
  // rank 3 (or higher, defensive) — base 7d77 + imbue scaling.
  return 7 + Math.floor(Math.max(0, imbueDice) / 7);
}

/**
 * Per-spell components for one Shiradi-flavor proc. `avgFullHit` is
 * the dice-count × 39 (d77 average) for a successful proc.
 *
 * Mechanic: each missile rolls independently at SHIRADI_SPELL_CHANCE
 * (7%); the proc fires at most once per cast → pFire = 1 - (1-p)^N.
 * pFire lives on `trigger.chance` so:
 *   • triggers/min reflects actual proc count (cpm × pFire), not just cpm
 *   • damage/trigger is on-fire damage (full × scaleMult), not chance-
 *     adjusted
 *   • damagePerCast contributes pFire × full × scaleMult per cast
 *     (chance scales the per-cast count via the per-cast view multiplier)
 * Total damage per minute = cpm × pFire × full × scaleMult, identical
 * to the old chance-baked-into-avg model — just attributed to a smaller
 * number of full-strength fires.
 */
function shiradiPerSpell(
  activeSpells: ActiveSpell[],
  avgFullHit: number,
  damageType: SpellDamageType,
  scaleProfile: 'spell' | 'random',
  labelPrefix: string,
): DamageComponent[] {
  return activeSpells.map(s => {
    const missiles = projectileCount(s.name, s.casterLevel);
    const pFire    = 1 - Math.pow(1 - SHIRADI_SPELL_CHANCE, missiles);
    return {
      label: `${labelPrefix} (${s.name})`,
      groupLabel: labelPrefix,
      trigger: { kind: 'per-cast', spell: s.name, chance: pFire },
      qtyPerTrigger: 1,
      avgDicePerHit: avgFullHit,
      damageType,
      scaleProfile,
      useGenericVuln: true,
      useMRR: true,
      // Surface the underlying mechanic for tooltips: full-hit damage
      // and the per-missile roll rate. The per-cast pFire is now
      // expressed via `trigger.chance` rather than via avgDicePerHit.
      fullHitAvg:        avgFullHit,
      perMissileChance:  SHIRADI_SPELL_CHANCE,
    };
  });
}

/**
 * Shiradi Mantle (Prism) — the base mantle's random-element proc.
 * Active whenever the player has taken `U51ShiradiChampionPrism`.
 * Always 7d77 (no rank scaling); imbue-dice scaling is exclusive to
 * Stay X rank 3.
 */
export const SHIRADI_MANTLE_PRISM: Proc = {
  id: 'shiradi-mantle-prism',
  label: 'Shiradi Mantle (Prism)',
  isActive: hasShiradiPrism,
  toComponents: (_build, _engine, _ctx, activeSpells) =>
    shiradiPerSpell(
      activeSpells,
      7 * D77_AVG,             // 7d77 = avg 273
      'Force',                 // placeholder — 'random' scale profile
                               // averages SP / crit / crit-mult across
                               // all elements, so this field doesn't
                               // drive the math.
      'random',
      'Shiradi Mantle (Prism, random)',
    ),
};

/**
 * Shiradi Mantle (Stay X) — element-locked variant. Granted by the
 * Tier 2 `U51ShiradiChampionStay` selector. Rank 3 adds the
 * imbue-dice scaling (+1d77 per 7 imbue).
 */
export const SHIRADI_MANTLE_STAY: Proc = {
  id: 'shiradi-mantle-stay',
  label: 'Shiradi Mantle (Stay)',
  isActive: (build) => shiradiStaySelection(build) !== null,
  toComponents: (build, engine, _ctx, activeSpells) => {
    const choice = shiradiStaySelection(build);
    if (!choice) return [];
    const dice = stayXDiceCount(choice.rank, engine.imbueDice.total);
    if (dice <= 0) return [];
    return shiradiPerSpell(
      activeSpells,
      dice * D77_AVG,
      choice.element,
      'spell',
      `Shiradi Mantle (${choice.selection})`,
    );
  },
};

/**
 * Per-metamagic SP contribution for the on-cast 'proc' scaling pool.
 * Per the wiki: only Empower, Maximize, and Intensify drive proc spell
 * power (Heighten / Quicken / Enlarge / Extend / Accelerate / Embolden
 * don't). Empower Healing applies only to healing-flavored procs which
 * the engine doesn't currently surface, so we leave it out of the
 * damage-side pool by default.
 *
 * Keys match the in-game stance names from Feats.xml / Epic.class.xml
 * exactly so toggling a metamagic from the Stances panel writes the
 * same string the table expects.
 */
const METAMAGIC_SP_TABLE: Record<string, number> = {
  'Empower Spell':   75,
  'Maximize Spell':  150,
  'Intensify Spell': 75,
};

/**
 * Sum the SP contribution of every metamagic in `activeMetamagics`. Used
 * by the calculator to derive the 'proc' scale profile's SP input
 * dynamically from the build's active toggles instead of hardcoding 300.
 */
export function computeMetamagicSP(activeMetamagics: readonly string[] | undefined): number {
  if (!activeMetamagics) return 0;
  let sum = 0;
  for (const name of activeMetamagics) sum += METAMAGIC_SP_TABLE[name] ?? 0;
  return sum;
}

// Re-exports for tests / breakdown UI to address procs by static-catalog id.
function staticById(id: string): Proc {
  const e = STATIC_PROC_CATALOG.find(x => x.id === id);
  if (!e) throw new Error(`Static proc id not found in catalog: ${id}`);
  return entryToProc(e);
}
export const DRIPPING_WITH_MAGMA  = staticById('dripping-with-magma');
export const EARTH_ATTUNEMENT     = staticById('earth-attunement');
export const WOEFUL_ENERGY        = staticById('woeful-energy');
export const WOEFUL_ECHOES        = staticById('woeful-echoes');
export const REVEL_IN_BLOOD_MAGIC = staticById('revel-in-blood-magic');

// ── Aggregation ──────────────────────────────────────────────────────────

/** Every proc the engine knows about. Grows as wiki rows land in the
 *  static catalog or as new dynamic procs are added. */
export const PROC_CATALOG: Proc[] = [
  MAGICAL_AMBUSH,
  SHIRADI_MANTLE_PRISM,
  SHIRADI_MANTLE_STAY,
  ...STATIC_PROC_CATALOG.map(entryToProc),
];

/**
 * Return the `DamageComponent`s produced by every catalog proc that's
 * active for this build, given the rotation's active spells.
 */
export function expandActiveProcs(
  build: Build,
  engine: EngineResult,
  ctx: ProcContext,
  activeSpells: ActiveSpell[],
): DamageComponent[] {
  return PROC_CATALOG
    .filter(p => p.isActive(build, engine))
    .flatMap(p => p.toComponents(build, engine, ctx, activeSpells));
}
