// Phase 6.4.5 — DPS calculator.
//
// Given a list of damage components (spell base hits + procs), an engine
// result, and an evaluation context, produces per-component and total
// expected damage per minute.
//
// 6.4.5a (this file) — `resolveScaleInputs(component, engine, ctx)`:
// resolves the four scale profiles into the SP / crit / crit-damage inputs
// `scaleMult` consumes. Lays the groundwork for the per-cast / per-minute
// orchestration in 6.4.5b.

import type { EngineResult } from '@/engine/runEngine';
import type { Build } from '@/types/build';
import { SPELL_DAMAGE_TYPES, type SpellDamageType } from '@/engine/breakdowns';
import type { DamageComponent, ScaleInputs } from './damage';
import { componentDamagePerTrigger, abilityToBaseComponents } from './damage';
import type { ProcContext, ActiveSpell } from './procs';
import { expandActiveProcs } from './procs';
import type { MagicAbility } from './abilities';
import type { RotationStep } from './rotation';
import { resolveTimeline } from './timing';
import { projectileCount } from './spellRules';
import { BUFF_CATALOG, computeActiveBuffs, type ActiveBuff } from './buffs';

/**
 * Inputs for evaluating components into damage numbers. Extends
 * `ProcContext` (sneak-attack dice etc. used during proc expansion) with
 * fields the calculator pulls from the user's panel state.
 */
export interface EvalContext extends ProcContext {
  /** Total SP-equivalent from active metamagic toggles (Maximize +
   *  Empower + Intensify). End-game baseline with all three ≈ 300.
   *  Drives the `'proc'` scale profile. */
  metamagicSP: number;
}

/**
 * Pull the right SP / crit chance / crit-damage-bonus for a component
 * based on its damage type and scale profile. The crit chance & crit
 * damage normally come from the component's damage element. Active
 * metamagics (Empower / Maximize / Intensify) add a flat SP bonus on
 * top of the profile-specific spell power, mirroring how the in-game
 * spell card shows the boosted total during casting.
 *
 *   • 'spell'           → element SP + metamagic SP
 *   • 'sneak'           → (element SP + metamagic SP) × 0.5
 *                          (Magical Ambush baseline — the proc reads
 *                          the spell's effective Force SP at cast
 *                          time, including metamagic, then applies
 *                          its 50% scaling factor)
 *   • 'proc'            → metamagic SP only (no element SP per wiki —
 *                          on-spellcast procs don't read element pools)
 *   • 'dark-imbuement'  → (forceSP + metamagic SP) × (1 + max(MP, RP) / 100)
 *                          (bug-modeled — Dark Imbuement consumes both
 *                          Force SP AND MP/RP in-game)
 *   • 'random'          → mean(element SP) + metamagic SP, averaged
 *                          across all 13 spell-damage elements. Used
 *                          by Shiradi Mantle's Prism base proc.
 */
export function resolveScaleInputs(
  component: DamageComponent,
  engine: EngineResult,
  ctx: EvalContext,
): ScaleInputs {
  const dt          = component.damageType;
  const elementSP   = engine.spellPowers[dt]?.total ?? 0;
  const meleePower  = engine.meleePower.total;
  const rangedPower = engine.rangedPower.total;
  const mmSP        = ctx.metamagicSP;

  if (component.scaleProfile === 'random') {
    // Average SP / crit / crit-mult across every spell damage element.
    // Metamagic SP adds flat on top of the averaged pool.
    let sumSP = 0, sumCrit = 0, sumCritMult = 0;
    for (const el of SPELL_DAMAGE_TYPES) {
      sumSP       += engine.spellPowers[el]?.total          ?? 0;
      sumCrit     += engine.spellCriticalChance[el]?.total  ?? 0;
      sumCritMult += engine.spellCriticalDamage[el]?.total  ?? 0;
    }
    const n = SPELL_DAMAGE_TYPES.length;
    return {
      spellPower:    sumSP / n + mmSP,
      critChance:    sumCrit / n / 100,
      critMultBonus: sumCritMult / n / 100,
    };
  }

  let spellPower: number;
  switch (component.scaleProfile) {
    case 'spell':
      spellPower = elementSP + mmSP;
      break;
    case 'sneak':
      spellPower = (elementSP + mmSP) * 0.5;
      break;
    case 'proc':
      spellPower = mmSP;
      break;
    case 'dark-imbuement': {
      const forceSP = engine.spellPowers.Force?.total ?? 0;
      spellPower = (forceSP + mmSP) * (1 + Math.max(meleePower, rangedPower) / 100);
      break;
    }
  }

  const critChance    = (engine.spellCriticalChance[dt]?.total    ?? 0) / 100;
  const critMultBonus = (engine.spellCriticalDamage[dt]?.total    ?? 0) / 100;

  return { spellPower, critChance, critMultBonus };
}

// ── Rotation + debuff inputs ─────────────────────────────────────────────

export interface RotationEntry {
  /** Spell name as known by spellRules.ts (used to resolve per-hit qty). */
  name: string;
  /** Effective caster level for this entry. */
  casterLevel: number;
  /** How often the spell fires per minute. */
  castsPerMinute: number;
  /** Spell-side cap on distinct enemy targets per cast. 1 = single-target,
   *  100 = uncapped AoE, N = bounded multi-target (chain spells). */
  maxTargetCap: number;
}

export interface Rotation {
  spells: RotationEntry[];
  /** UI-controlled count of available enemy targets (1–5 in the dropdown).
   *  Per-spell effective targets = `min(spell.maxTargetCap, targetCount)`.
   *  Single-target spells stay single-target (their cap is 1); AoE spells
   *  scale up to the user's chosen group size. Defaults to 1. */
  targetCount?: number;
}

export interface Debuffs {
  /** Generic vulnerability % to add to flagged components. */
  genericVulnPct: number;
  /** Sonic-only vulnerability % to add to sonic-flagged components.
   *  Kept for backwards compatibility with existing tests / fixtures;
   *  new code should populate `elementVulnPct.Sonic` instead. */
  sonicVulnPct: number;
  /** Target's effective MRR after any debuff (can be negative). Magical
   *  components multiply by `100 / (effectiveMRR + 100)`. Set to 0 for
   *  the no-debuff baseline (multiplier = 1.0). */
  effectiveMRR: number;
  /** Target's effective PRR. Same shape as MRR but applied to physical
   *  components. 0 = no reduction. */
  effectivePRR?: number;
  /** Per-element damage-vulnerability percentages applied to components
   *  whose `damageType` matches the element. The element key on the
   *  component is the implicit opt-in (no `useFireVuln`-style flag is
   *  needed — a Fire spell automatically benefits from Fire vuln).
   *  Stacks additively with `genericVulnPct` and the legacy
   *  `sonicVulnPct` (for Sonic only). */
  elementVulnPct?: Partial<Record<SpellDamageType, number>>;
  /** Flat multiplier applied to every component's damage — used for the
   *  Reaper difficulty damage-dealt reduction. Defaults to 1 (no scaling)
   *  when omitted. Computed by `spellDamageMultiplier(difficultyIdx)` for
   *  the spell rotations we model today; physical-type rotations (future
   *  Phase 6.7+) would use `physicalDamageMultiplier` instead. */
  damageDealtMultiplier?: number;
}

/** Casts/minute summed across the whole rotation. */
export function totalCastsPerMinute(rotation: Rotation): number {
  return rotation.spells.reduce((s, sp) => s + sp.castsPerMinute, 0);
}

/**
 * How many times this component fires per minute under the given rotation.
 *
 *   • per-cast (no spell)         → total cpm (fires once per any cast)
 *   • per-cast (with spell)       → that spell's cpm
 *   • per-cast (with chance)      → cpm × chance (e.g. Shiradi Mantle's
 *                                    pFire derived from per-missile 7%
 *                                    capped at one fire per cast)
 *   • per-hit (with spell)        → spell.cpm × projectileCount(spell, CL)
 *   • icd                         → 0 (math lands in 6.4.4)
 */
export function componentTriggersPerMinute(
  c: DamageComponent,
  rotation: Rotation,
): number {
  const t = c.trigger;
  if (t.kind === 'icd') return 0;
  if (t.kind === 'per-cast') {
    const baseCpm = t.spell
      ? rotation.spells.find(s => s.name === t.spell)?.castsPerMinute ?? 0
      : totalCastsPerMinute(rotation);
    return baseCpm * (t.chance ?? 1);
  }
  // per-hit: fires once per missile of the parent spell.
  const sp = rotation.spells.find(s => s.name === t.spell);
  return sp ? sp.castsPerMinute * projectileCount(t.spell, sp.casterLevel) : 0;
}

/**
 * Multiplier from target debuffs. Components opt into each debuff via the
 * `useGenericVuln` / `useSonicVuln` / `useMRR` flags; unflagged components
 * get a 1.0 multiplier (debuff doesn't apply).
 */
export function componentDebuffMultiplier(
  c: DamageComponent,
  d: Debuffs,
): number {
  let m = 1;
  if (c.useGenericVuln && d.genericVulnPct > 0) m *= 1 + d.genericVulnPct / 100;
  if (c.useSonicVuln   && d.sonicVulnPct   > 0) m *= 1 + d.sonicVulnPct   / 100;
  // Per-element vulnerability applies whenever the component's damage
  // type matches a populated entry in `elementVulnPct` (no opt-in flag
  // — element type is the implicit signal). Skip Sonic to avoid
  // double-counting with the legacy `sonicVulnPct` channel.
  if (d.elementVulnPct && c.damageType !== 'Sonic') {
    const ev = d.elementVulnPct[c.damageType];
    if (ev && ev > 0) m *= 1 + ev / 100;
  }
  // Resistance rating: explicit `damageRating` wins; otherwise fall
  // back to the legacy `useMRR` flag for components that haven't been
  // migrated yet. Same `100 / (100 + rating)` formula either way —
  // PRR or MRR depending on the rating type. Negative ratings (target
  // debuffed) yield a multiplier > 1 (damage amplified).
  const rating = c.damageRating ?? (c.useMRR ? 'magical' : 'none');
  if (rating === 'magical') {
    m *= 100 / (d.effectiveMRR + 100);
  } else if (rating === 'physical') {
    m *= 100 / ((d.effectivePRR ?? 0) + 100);
  }
  // Flat damage-dealt scaling (Reaper difficulty). Applied uniformly to
  // every component since all of them are spell-typed in our current
  // model, and spell-type damage takes the same reduction at every
  // difficulty regardless of the component's element/MRR flags.
  if (d.damageDealtMultiplier !== undefined && d.damageDealtMultiplier !== 1) {
    m *= d.damageDealtMultiplier;
  }
  return m;
}

// ── Per-component evaluation ─────────────────────────────────────────────

export interface ComponentDamage {
  component: DamageComponent;
  scaleInputs: ScaleInputs;
  damagePerTrigger: number;
  triggersPerMinute: number;
  debuffMultiplier: number;
  damagePerMinute: number;
}

export function evaluateComponent(
  c: DamageComponent,
  engine: EngineResult,
  ctx: EvalContext,
  rotation: Rotation,
  debuffs: Debuffs,
): ComponentDamage {
  const scaleInputs       = resolveScaleInputs(c, engine, ctx);
  const damagePerTrigger  = componentDamagePerTrigger(c, scaleInputs);
  const triggersPerMinute = componentTriggersPerMinute(c, rotation);
  const debuffMultiplier  = componentDebuffMultiplier(c, debuffs);
  const targetMultiplier  = componentTargetMultiplier(c, rotation);
  return {
    component:        c,
    scaleInputs,
    damagePerTrigger,
    triggersPerMinute,
    debuffMultiplier,
    damagePerMinute:  damagePerTrigger * triggersPerMinute * debuffMultiplier * targetMultiplier,
  };
}

/**
 * AoE / multi-target multiplier for one component. Folds in the
 * spell's `targetCap` (1 / N / 100) and the user-chosen `targetCount`
 * (1–5 in the dropdown). Returns:
 *   • `min(targetCap, targetCount)` for components that scale per
 *     target — base damage and per-hit procs (Magical Ambush adds
 *     sneak dice to each enemy hit).
 *   • `1` for chance-based per-cast procs (Shiradi mantle), which
 *     fire at most once per cast regardless of how many targets the
 *     spell hits. Opt out via `component.capsAtOnePerCast`.
 *   • `1` when the component lacks `targetCap` (defensive default —
 *     treats unknown components as single-target).
 */
export function componentTargetMultiplier(
  c: DamageComponent,
  rotation: Rotation,
): number {
  if (c.capsAtOnePerCast) return 1;
  if (c.trigger.kind === 'per-cast' && c.trigger.chance !== undefined) return 1;
  const cap = c.targetCap ?? 1;
  const tc  = rotation.targetCount ?? 1;
  return Math.min(cap, tc);
}

// ── Whole-rotation roll-up ───────────────────────────────────────────────

export interface DamageBreakdown {
  totalPerMinute: number;
  totalDPS: number;
  byComponent: ComponentDamage[];
}

// ── Per-spell tooltip helper ─────────────────────────────────────────────

export interface PerCastDamage {
  /** Sum of every contributing component's damage per trigger. */
  total: number;
  /** Caster level used to size dice and projectile counts. */
  casterLevel: number;
  byComponent: ComponentDamage[];
}

/**
 * Damage info for one ability surfaced into the palette UI. Combines the
 * per-cast breakdown (DPC) with the build-aware cycle time and resulting
 * standalone DPS so tooltips / tiles can show both side by side.
 */
export interface AbilityDamageInfo {
  damage: PerCastDamage;
  /** Effective seconds between casts if this spell were spammed alone —
   *  max(effectiveCooldown, castTime, 1e-3). Drives `dps`. */
  cycleTime: number;
  /** Damage per second when spammed standalone: `damage.total / cycleTime`. */
  dps: number;
}

/** No-debuff baseline (multiplier = 1.0 across the board). */
export const NO_DEBUFFS: Debuffs = {
  genericVulnPct: 0,
  sonicVulnPct:   0,
  effectiveMRR:   0,
};

/**
 * Single-cast damage breakdown for one ability — what fires when this
 * spell is cast once, with no rotation context. Sums the spell's base
 * hit, per-spell procs that target this spell, and global per-cast procs
 * that fire on every cast. Used by the rotation palette / spell tooltips
 * so the user can cross-reference against in-game numbers.
 *
 * Transient buffs (Dark Imbuement, …) are included optimistically — the
 * per-cast view assumes the user's rotation maintains the buff. The
 * whole-rotation calculator scales the buff contribution by its actual
 * uptime; this view is the "buff up" upper bound.
 *
 * `debuffs` defaults to the no-debuff baseline; pass aggregated values
 * to see how active debuffs lift the per-cast number.
 */
export function damagePerCast(
  ability: MagicAbility,
  build: Build,
  engine: EngineResult,
  ctx: EvalContext,
  debuffs: Debuffs = NO_DEBUFFS,
): PerCastDamage {
  const buildCL = engine.casterLevel.total;
  const effMCL  = effectiveMaxCasterLevel(ability, build, engine);
  const casterLevel = effMCL > 0 ? Math.min(buildCL, effMCL) : buildCL;

  const base  = abilityToBaseComponents(ability, casterLevel);
  const procs = expandActiveProcs(build, engine, ctx, [
    { name: ability.name, casterLevel, maxTargetCap: ability.maxTargetCap },
  ]);
  // Buffs (assume up) — optimal-rotation upper bound.
  const buffs = BUFF_CATALOG
    .filter(b => b.isAvailable(build, engine))
    .flatMap(b => b.toComponents(build, engine, ctx));

  // Synthetic single-spell rotation — gives `componentTargetMultiplier`
  // and proc emitters a `Rotation`-shaped object to read targetCap /
  // targetCount from for the per-cast view.
  const perCastRotation: Rotation = {
    spells: [{
      name:           ability.name,
      casterLevel,
      castsPerMinute: 0,                   // not used in per-cast view
      maxTargetCap:   ability.maxTargetCap,
    }],
    targetCount: ctx.targetCount,
  };

  const byComponent: ComponentDamage[] = [...base, ...procs, ...buffs].map(c => {
    const scaleInputs      = resolveScaleInputs(c, engine, ctx);
    const damagePerTrigger = componentDamagePerTrigger(c, scaleInputs);
    const debuffMultiplier = componentDebuffMultiplier(c, debuffs);
    const targetMultiplier = componentTargetMultiplier(c, perCastRotation);
    // Per-cast contribution multiplier:
    //   • per-hit  → fires once per missile (e.g. Magical Ambush adds
    //                its sneak dice to each of Magic Missile's 5
    //                missiles). Multiply by projectile count.
    //   • per-cast → 1 fire per cast, scaled by `chance` when set
    //                (Shiradi mantle: cpm × pFire is the long-run
    //                proc count, so a single cast contributes pFire ×
    //                full-hit damage on average).
    //   • icd      → long-run avg, not modeled in the per-cast view.
    const triggersPerCast =
      c.trigger.kind === 'per-hit'
        ? projectileCount(c.trigger.spell, casterLevel)
        : c.trigger.kind === 'icd'
          ? 0
          : c.trigger.chance ?? 1;
    return {
      component:        c,
      scaleInputs,
      damagePerTrigger,
      triggersPerMinute: 0,        // per-cast view is rotation-agnostic
      debuffMultiplier,
      damagePerMinute:   damagePerTrigger * triggersPerCast * debuffMultiplier * targetMultiplier,
    };
  });
  const total = byComponent.reduce((s, b) => s + b.damagePerMinute, 0);
  return { total, casterLevel, byComponent };
}

/**
 * Effective MaxCasterLevel for a spell — the catalog cap (e.g. Magic
 * Missile's 20) plus any `MaxCasterLevel` bonuses targeting the spell's
 * casting class. Epic Knowledge (granted at every other epic level) and
 * Legendary Knowledge (every other legendary level) each emit +1 to
 * `MaxCasterLevel` per acquisition for every casting class — so a
 * fully-leveled pure caster at level 30 sees +10 to MCL, raising
 * standard-cap spells from 20 → 30.
 *
 * For class-trained spells we use `ability.className` directly. For
 * SLAs (no className), fall back to the build's primary caster class
 * — its bonuses still apply since DDO treats those SLAs as cast by
 * the granting class. Returns 0 for abilities without a catalog cap
 * (which the caller treats as "use buildCL unclamped").
 */
function effectiveMaxCasterLevel(
  ability: MagicAbility,
  build: Build,
  engine: EngineResult,
): number {
  if (ability.maxCasterLevel <= 0) return 0;
  const className = ability.className ?? primaryCasterClassName(build);
  if (!className) return ability.maxCasterLevel;
  let bonus = 0;
  for (const b of engine.allBonuses ?? []) {
    if (b.effectType !== 'MaxCasterLevel') continue;
    if (b.target !== className) continue;
    bonus += b.value;
  }
  return ability.maxCasterLevel + bonus;
}

/** Pick the casting-context class for an SLA without an explicit
 *  className. Returns the highest-level class in the build, since
 *  most SLA-granting features key off the player's main caster class. */
function primaryCasterClassName(build: Build): string | undefined {
  if (!build.classes || build.classes.length === 0) return undefined;
  let best = build.classes[0]!;
  for (const c of build.classes) {
    if (c.levels > best.levels) best = c;
  }
  // ClassLevel.classId is snake_case; the bonus targets are the
  // human-readable class names. Map by replacing underscores with
  // spaces and title-casing each token (matches our DDOClassData
  // naming convention — "arcane_trickster" → "Arcane Trickster").
  return best.classId
    .split(/[_-]/)
    .map(w => w.length === 0 ? '' : w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Whole-rotation breakdown ─────────────────────────────────────────────

/**
 * Run the calculator over an entire magic rotation. Resolves the
 * rotation's cycle length, derives each spell's casts-per-minute,
 * collects every base hit + active proc, and returns the per-component
 * + total per-minute breakdown.
 *
 * Returns `null` for an empty rotation (no time to spread damage over).
 */
export interface RotationDPSResult extends DamageBreakdown {
  /** Per-buff uptime + benefiting cast count for the timeline UI. */
  activeBuffs: ActiveBuff[];
  /** Cycle length in seconds (sets the buff-window scale). */
  cycleSeconds: number;
}

export function rotationDPS(
  magicSteps: RotationStep[],
  abilities: MagicAbility[],
  build: Build,
  engine: EngineResult,
  ctx: EvalContext,
  debuffs: Debuffs,
  cooldownReductionPct: number,
): RotationDPSResult | null {
  if (magicSteps.length === 0) return null;
  const abilityById = new Map(abilities.map(a => [a.id, a]));
  const timeline = resolveTimeline(magicSteps, abilityById, cooldownReductionPct);
  if (timeline.totalSeconds <= 0) return null;

  const buildCL         = engine.casterLevel.total;
  const cyclesPerMinute = 60 / timeline.totalSeconds;

  // Collect unique abilities firing in the rotation + how many times each
  // appears per cycle. Casts-per-minute = count × cycles/min.
  interface UsedAbility {
    ability:     MagicAbility;
    casterLevel: number;
    count:       number;
  }
  const used = new Map<string, UsedAbility>();
  for (const r of timeline.steps) {
    const existing = used.get(r.ability.id);
    if (existing) { existing.count++; continue; }
    // Effective MCL incorporates Epic Knowledge / Legendary Knowledge
    // (and any other MaxCasterLevel feat) bonuses targeting the spell's
    // casting class — same path as damagePerCast. See `effectiveMaxCasterLevel`.
    const effMCL = effectiveMaxCasterLevel(r.ability, build, engine);
    const cl = effMCL > 0 ? Math.min(buildCL, effMCL) : buildCL;
    used.set(r.ability.id, { ability: r.ability, casterLevel: cl, count: 1 });
  }

  // ── Dedupe by spell name for damage / trigger calculations ─────────
  // Multiple distinct abilities can invoke the same underlying spell
  // (e.g. class-trained `Magic Missile` + Arcane Trickster Stolen
  // Spell SLA + a gear clickie all firing "Magic Missile"). The
  // rotation timeline keeps them as separate steps for UI purposes
  // (different display names, different cooldowns), but the damage /
  // trigger math wants ONE entry per spell name with its total cpm —
  // otherwise:
  //   • baseComponents emit duplicate damage rolls for each ability,
  //     and `componentTriggersPerMinute`'s `rotation.spells.find(...)`
  //     returns the first match's cpm — so both copies look up the
  //     SAME cpm and double-count damage.
  //   • Per-spell procs (Magical Ambush, Shiradi mantles) emit
  //     duplicate components per ability sharing the spell name,
  //     each looking up the same first-match cpm, doubling triggers.
  // Collapsing by name fixes both: triggers/min for "Magic Missile"
  // = sum of cpm across every ability that invokes it, and there's
  // exactly one base damage roll set per spell name.
  interface NameGroup {
    name:        string;
    /** Representative ability — used for catalog data (damages,
     *  spellLevel). All abilities sharing this name resolve through
     *  the same Spells.xml entry, so any of them works. */
    sample:      MagicAbility;
    /** Highest CL across all sharing abilities. Multi-CL same-name
     *  rotations (rare) get the strongest CL, matching how the engine
     *  treats overlap. */
    casterLevel: number;
    /** Total casts/min across all abilities sharing this name. */
    cpm:         number;
  }
  const byName = new Map<string, NameGroup>();
  for (const u of used.values()) {
    const cur = byName.get(u.ability.name);
    const thisCpm = u.count * cyclesPerMinute;
    if (cur) {
      cur.cpm += thisCpm;
      if (u.casterLevel > cur.casterLevel) cur.casterLevel = u.casterLevel;
    } else {
      byName.set(u.ability.name, {
        name:        u.ability.name,
        sample:      u.ability,
        casterLevel: u.casterLevel,
        cpm:         thisCpm,
      });
    }
  }

  // Per-spell procs (Magical Ambush, Shiradi mantles, …) fire on
  // *damaging* spells only — clickies, action boosts, buffs, and
  // utility abilities don't trigger them in DDO. Filter to abilities
  // with at least one real damage roll so a rotation mixing offensive
  // spells with non-damaging entries doesn't inflate proc triggers/min.
  const activeSpells: ActiveSpell[] = [...byName.values()]
    .filter(g => g.sample.damages.length > 0 && !g.sample.placeholderDamage)
    .map(g => ({
      name:         g.name,
      casterLevel:  g.casterLevel,
      maxTargetCap: g.sample.maxTargetCap,
    }));

  // One base component set per unique spell name — collapses
  // class/SLA/clickie variants of the same spell into a single
  // damage roll set, with cpm = total cast frequency.
  const baseComponents: DamageComponent[] = [...byName.values()].flatMap(g =>
    abilityToBaseComponents(g.sample, g.casterLevel),
  );
  const procComponents = expandActiveProcs(build, engine, ctx, activeSpells);

  const rotation: Rotation = {
    spells: [...byName.values()].map(g => ({
      name:           g.name,
      casterLevel:    g.casterLevel,
      castsPerMinute: g.cpm,
      maxTargetCap:   g.sample.maxTargetCap ?? 1,
    })),
    targetCount: ctx.targetCount,
  };

  // ── Buff contributions ──────────────────────────────────────────────
  // For each buff, count benefiting casts in one cycle, then evaluate its
  // damage components with `triggersPerMinute = benefitingCount × cyclesPerMinute`
  // (overrides the standard per-cast cpm so non-benefiting casts don't
  // contribute). Bypasses evaluateComponent's rotation lookup.
  const activeBuffs = computeActiveBuffs(
    BUFF_CATALOG, timeline.steps, timeline.totalSeconds, build, engine,
  );
  const buffComponentDamages: ComponentDamage[] = [];
  for (const ab of activeBuffs) {
    const benefitingCpm = ab.benefitingStepKeys.size * cyclesPerMinute;
    if (benefitingCpm === 0) continue;
    const components = ab.buff.toComponents(build, engine, ctx);
    for (const c of components) {
      const scaleInputs       = resolveScaleInputs(c, engine, ctx);
      const damagePerTrigger  = componentDamagePerTrigger(c, scaleInputs);
      const debuffMultiplier  = componentDebuffMultiplier(c, debuffs);
      buffComponentDamages.push({
        component:        c,
        scaleInputs,
        damagePerTrigger,
        triggersPerMinute: benefitingCpm,
        debuffMultiplier,
        damagePerMinute:  damagePerTrigger * benefitingCpm * debuffMultiplier,
      });
    }
  }

  const baseAndProcs = evaluateAll(
    [...baseComponents, ...procComponents],
    engine, ctx, rotation, debuffs,
  );
  const allByComponent = [...baseAndProcs.byComponent, ...buffComponentDamages];
  const totalPerMinute = allByComponent.reduce((s, b) => s + b.damagePerMinute, 0);
  return {
    totalPerMinute,
    totalDPS:        totalPerMinute / 60,
    byComponent:     allByComponent,
    activeBuffs,
    cycleSeconds:    timeline.totalSeconds,
  };
}

/** Roll up every component's per-minute damage and return a DPS total. */
export function evaluateAll(
  components: DamageComponent[],
  engine: EngineResult,
  ctx: EvalContext,
  rotation: Rotation,
  debuffs: Debuffs,
): DamageBreakdown {
  const byComponent    = components.map(c => evaluateComponent(c, engine, ctx, rotation, debuffs));
  const totalPerMinute = byComponent.reduce((s, b) => s + b.damagePerMinute, 0);
  return {
    totalPerMinute,
    totalDPS: totalPerMinute / 60,
    byComponent,
  };
}
