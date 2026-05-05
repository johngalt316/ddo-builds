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
/**
 * Dark Imbuement — Shadowdancer destiny enhancement (sibling of Paranoia
 * in the same selector). Active while Shadowdancer Epic Strike is up;
 * for DPS modelling we assume it's perma-active (re-applied every 10 s).
 *
 * Damage rule (per ddowiki):
 *
 *   "1d6 per Sneak Attack Dice in Untyped damage on hit, scaling with
 *    Melee or Ranged Power."
 *
 * In-game behavior: BUGGED — the proc actually consumes BOTH Force Spell
 * Power AND max(MeleePower, RangedPower) as multiplicative scalars on
 * spellcasts. Players exploit this. We model the bug, not the spec — the
 * `'dark-imbuement'` scale profile encodes the dual scaling at calculator
 * time. If/when the bug gets patched, swap the profile for 'spell' (full
 * Force SP only) or recompute against the post-fix mechanics.
 *
 * Despite the wiki's "on hit" wording, the proc effectively fires once
 * per spell cast (not once per missile) — matching how the reference
 * spreadsheet models it. Damage type is Force for crit/scaling purposes
 * even though the wiki labels it Untyped.
 */
export const DARK_IMBUEMENT: Proc = {
  id: 'dark-imbuement',
  label: 'Dark Imbuement',
  isActive: (build) =>
    build.destinyEnhancements.some(d =>
      d.enhancements.some(e => e.selection === 'Dark Imbuement'),
    ),
  toComponents: (_build, _engine, ctx) => {
    if (ctx.sneakAttackDice <= 0) return [];
    return [{
      label: 'Dark Imbuement',
      trigger: { kind: 'per-cast' },
      qtyPerTrigger: 1,
      avgDicePerHit: ctx.sneakAttackDice * 3.5,   // Nd6 average
      damageType: 'Force',
      scaleProfile: 'dark-imbuement',
      // ignores generic vuln, sonic vuln, and MRR per the spreadsheet
    }];
  },
};

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

// Re-exports for tests / breakdown UI to address procs by static-catalog id.
export const DRIPPING_WITH_MAGMA  = entryToProc(STATIC_PROC_CATALOG[0]!);
export const WOEFUL_ENERGY        = entryToProc(STATIC_PROC_CATALOG[1]!);
export const WOEFUL_ECHOES        = entryToProc(STATIC_PROC_CATALOG[2]!);
export const REVEL_IN_BLOOD_MAGIC = entryToProc(STATIC_PROC_CATALOG[3]!);

// ── Aggregation ──────────────────────────────────────────────────────────

/** Every proc the engine knows about. Grows as wiki rows land in the
 *  static catalog or as new dynamic procs are added. */
export const PROC_CATALOG: Proc[] = [
  MAGICAL_AMBUSH,
  DARK_IMBUEMENT,
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
