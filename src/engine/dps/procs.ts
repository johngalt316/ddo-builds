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

function hasItemBuff(build: Build, buffType: string): boolean {
  return activeGearItems(build).some(it =>
    it.buffs.some(b => b.type === buffType),
  );
}

function hasAugmentSlotted(build: Build, augmentName: string): boolean {
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
}

function entryToProc(entry: StaticProcEntry): Proc {
  const avg = entry.diceCount * (entry.diceSides + 1) / 2;
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
  {
    id: 'dripping-with-magma',
    label: 'Dripping with Magma',
    source: { kind: 'item-buff', name: 'Dripping with Magma' },
    diceCount: 50, diceSides: 20,
    damageType: 'Fire',
    useGenericVuln: true, useMRR: true,
  },
  {
    // Carried by alchemical Earth Attunement gear (e.g. Bound Elemental
    // Ring of Acid, The Autumn Equinox, The Theurgy of Autumn).
    // Reference spreadsheet "Acid Attunement" row: 50d10 Acid (avg 275),
    // scales with full Acid Spell Power (profile 'spell', not 'proc').
    // In-game description says "stacking acid damage over time"; the
    // spreadsheet models the average instant per-cast contribution.
    id: 'earth-attunement',
    label: 'Acid Attunement',
    source: { kind: 'item-buff', name: 'AlchemicalEarthAttunement' },
    diceCount: 50, diceSides: 10,
    damageType: 'Acid',
    scaleProfile: 'spell',
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
];

// ── Dynamic procs (build-derived dice / qty) ─────────────────────────────

/**
 * Magical Ambush — Arcane Trickster level 8 automatic feat.
 *
 *   "Your offensive instantaneous damaging spells deal additional 1d6 force
 *    damage equal to your sneak attack dice. Scales with 50% of force spell
 *    power."
 *
 * Stays in code (not the static catalog) because:
 *   • dice count = sneak attack dice (build-derived)
 *   • qty per trigger = projectileCount(spell, CL) (per-spell)
 *   • scale profile = 'sneak' (the wiki's "specified" exception that does
 *     scale with force SP — at 50%)
 */
export const MAGICAL_AMBUSH: Proc = {
  id: 'magical-ambush',
  label: 'Magical Ambush',
  isActive: (build) =>
    build.classes.some(c => c.classId === 'arcane_trickster' && c.levels >= 8),
  toComponents: (_build, _engine, ctx, activeSpells) => {
    if (ctx.sneakAttackDice <= 0) return [];
    const avg = ctx.sneakAttackDice * 3.5;   // Nd6 average
    return activeSpells.map(s => ({
      label: `Magical Ambush (${s.name})`,
      trigger: { kind: 'per-cast', spell: s.name },
      qtyPerTrigger: projectileCount(s.name, s.casterLevel),
      avgDicePerHit: avg,
      damageType: 'Force',
      scaleProfile: 'sneak',
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
 * the dice-count × 39 (d77 average) for a successful proc; we apply
 * the 1 - (1 - p)^missiles per-cast probability to that.
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
      trigger: { kind: 'per-cast', spell: s.name },
      qtyPerTrigger: 1,
      avgDicePerHit: avgFullHit * pFire,
      damageType,
      scaleProfile,
      useGenericVuln: true,
      useMRR: true,
      // Surface the underlying mechanic for tooltips: full hit damage
      // before the per-cast pFire multiplier, plus the per-missile
      // roll rate. Doesn't affect the calculator math.
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
