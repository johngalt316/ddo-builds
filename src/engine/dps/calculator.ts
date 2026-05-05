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
import type { DamageComponent, ScaleInputs } from './damage';
import { componentDamagePerTrigger } from './damage';
import type { ProcContext } from './procs';
import { projectileCount } from './spellRules';

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
 * damage always come from the component's damage element; only the
 * spell-power input differs per profile:
 *
 *   • 'spell'           → engine.spellPowers[damageType]
 *   • 'sneak'           → engine.spellPowers[damageType] × 0.5
 *                          (Magical Ambush — wiki: "scales with 50% of
 *                          force spell power"; using `damageType` keeps
 *                          this generic for any future sneak-style proc)
 *   • 'proc'            → ctx.metamagicSP (no element SP per wiki rule)
 *   • 'dark-imbuement'  → forceSP × (1 + max(MP, RP) / 100)
 *                          (bug-modeled — Dark Imbuement consumes both
 *                          Force SP AND MP/RP in-game)
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

  let spellPower: number;
  switch (component.scaleProfile) {
    case 'spell':
      spellPower = elementSP;
      break;
    case 'sneak':
      spellPower = elementSP * 0.5;
      break;
    case 'proc':
      spellPower = ctx.metamagicSP;
      break;
    case 'dark-imbuement': {
      const forceSP = engine.spellPowers.Force?.total ?? 0;
      spellPower = forceSP * (1 + Math.max(meleePower, rangedPower) / 100);
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
}

export interface Rotation {
  spells: RotationEntry[];
}

export interface Debuffs {
  /** Generic vulnerability % to add to flagged components. */
  genericVulnPct: number;
  /** Sonic-only vulnerability % to add to sonic-flagged components. */
  sonicVulnPct: number;
  /** Target's effective MRR after any debuff (can be negative). MRR-flagged
   *  components multiply by `100 / (effectiveMRR + 100)`. Set to 0 for
   *  the no-debuff baseline (multiplier = 1.0). */
  effectiveMRR: number;
}

/** Casts/minute summed across the whole rotation. */
export function totalCastsPerMinute(rotation: Rotation): number {
  return rotation.spells.reduce((s, sp) => s + sp.castsPerMinute, 0);
}

/**
 * How many times this component fires per minute under the given rotation.
 *
 *   • per-cast (no spell)  → total cpm (fires once per any cast)
 *   • per-cast (with spell)→ that spell's cpm
 *   • per-hit (with spell) → spell.cpm × projectileCount(spell, CL)
 *   • icd                  → 0 (math lands in 6.4.4)
 */
export function componentTriggersPerMinute(
  c: DamageComponent,
  rotation: Rotation,
): number {
  const t = c.trigger;
  if (t.kind === 'icd') return 0;
  if (t.kind === 'per-cast') {
    if (!t.spell) return totalCastsPerMinute(rotation);
    return rotation.spells.find(s => s.name === t.spell)?.castsPerMinute ?? 0;
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
  if (c.useMRR) m *= 100 / (d.effectiveMRR + 100);
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
  return {
    component:        c,
    scaleInputs,
    damagePerTrigger,
    triggersPerMinute,
    debuffMultiplier,
    damagePerMinute:  damagePerTrigger * triggersPerMinute * debuffMultiplier,
  };
}

// ── Whole-rotation roll-up ───────────────────────────────────────────────

export interface DamageBreakdown {
  totalPerMinute: number;
  totalDPS: number;
  byComponent: ComponentDamage[];
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
