// Phase 6.4 — Spell-damage components.
//
// A `DamageComponent` is the unit of damage in the DPS model. Every spell
// expands into one or more components (base hits + per-spell procs) and
// the build also contributes global components (mantles, capstone procs,
// standalone proc effects). The full DPS calculation = sum over all
// triggered components of (qty × baseAvg × scaleMult × triggerRate × debuffMult).
//
// Reference: "Copy of Proc Based Arcane Trickster DPS" spreadsheet.
// Formula verified to reproduce that workbook's Components rows exactly.

import type { SpellDamageType } from '@/engine/breakdowns';
import type { MagicAbility } from './abilities';
import { avgPerHit, projectileCount } from './spellRules';

/**
 * Per-component scaling profile — which SP pool feeds `scaleMult`. The
 * formula is identical across profiles; only the spell-power input changes.
 *
 *   • spell           — full element Spell Power for the component's damage
 *                        type. Used by spell base hits.
 *   • sneak           — Force SP × 0.5. Magical Ambush uses this (its
 *                        description explicitly says "scales with 50% of
 *                        force spell power"); other procs do NOT.
 *   • proc            — on-spellcast proc damage: scales only with active
 *                        metamagic toggles (Maximize / Empower / Intensify),
 *                        NOT with the build's element Spell Power. End-game
 *                        baseline with all three toggles active is ~300.
 *   • dark-imbuement  — Arcane Trickster capstone: Force SP × (1 + max(MP,
 *                        RP)/100). The MP/RP multiplier is the part that
 *                        drives the spreadsheet's ~2.45× display value.
 */
export type DamageScaleProfile = 'spell' | 'sneak' | 'proc' | 'dark-imbuement' | 'random';

/**
 * When does the component fire and how many times per fire?
 *
 *   • per-hit  — once per missile/ray of `spell` (e.g. Ambush rolls per
 *                missile of Magic Missile).
 *   • per-cast — once per cast of `spell`, or once per *any* cast if
 *                `spell` is omitted.
 *   • icd      — proc with chance per cast and an internal cooldown
 *                between procs. (Modeled in 6.4.4.)
 */
export type DamageTrigger =
  | { kind: 'per-hit';  spell: string }
  | { kind: 'per-cast'; spell?: string }
  | { kind: 'icd';      cooldownSec: number; chance: number };

export interface DamageComponent {
  label: string;
  /** Optional grouping key for UI aggregation. When a proc emits one
   *  component per active spell (e.g. Magical Ambush emits "Magical
   *  Ambush (Magic Missile)" + "Magical Ambush (Force Missiles)"…),
   *  set `groupLabel` to the bare proc name so the damage-source
   *  summary collapses every per-spell row into a single total. Falls
   *  back to `label` when undefined. */
  groupLabel?: string;
  trigger: DamageTrigger;
  /** Hits per trigger (5 missiles, 4 rays, 1 hit, …). */
  qtyPerTrigger: number;
  /** Average damage per single hit, post caster-level / metamagic scaling.
   *  For now this is an input; 6.4.2 will derive it from spell rules. */
  avgDicePerHit: number;
  damageType: SpellDamageType;
  scaleProfile: DamageScaleProfile;
  /** Y/N flags from the spreadsheet: which debuffs apply to this component. */
  useGenericVuln?: boolean;
  useSonicVuln?:   boolean;
  useMRR?:         boolean;
  /** UI-only hint: when `avgDicePerHit` has a chance baked in (e.g.
   *  Shiradi Mantle's 7d77 × pFire), `fullHitAvg` is the unmodified
   *  on-fire damage and `perMissileChance` the per-missile roll rate.
   *  Doesn't affect the calculator math — only used by tooltips that
   *  want to surface the underlying mechanic. */
  fullHitAvg?: number;
  perMissileChance?: number;
}

/**
 * Per-element scaling inputs for `scaleMult`.
 *   spellPower    — total SP for the element, e.g. 1182.
 *   critChance    — fractional crit rate, e.g. 0.68 for 68 %.
 *   critMultBonus — the spreadsheet's "Crit Mult" column minus 1
 *                   (so a 2.49× total multiplier → 1.49 here).
 */
export interface ScaleInputs {
  spellPower:    number;
  critChance:    number;
  critMultBonus: number;
}

/**
 * Variable damage multiplier from spell power and crit. Empirically
 * verified against the reference spreadsheet — a crit deals
 * `(critMult + 2) ×` non-crit damage in this model:
 *
 *   scaleMult = (1 + SP/100) × (1 + critChance × (critMultBonus + 2))
 */
export function scaleMult({ spellPower, critChance, critMultBonus }: ScaleInputs): number {
  return (1 + spellPower / 100) * (1 + critChance * (critMultBonus + 2));
}

/**
 * Average damage from one trigger of this component, before multiplying
 * by trigger rate or debuffs. Mirrors the spreadsheet's `Damage / Trigger`
 * column.
 */
export function componentDamagePerTrigger(
  component: Pick<DamageComponent, 'qtyPerTrigger' | 'avgDicePerHit'>,
  scale: ScaleInputs,
): number {
  return component.qtyPerTrigger * component.avgDicePerHit * scaleMult(scale);
}

/**
 * Build the base-damage `DamageComponent`s for a single ability. Each entry
 * in `ability.damages` produces one component; multi-projectile spells
 * (Magic Missile, Force Missiles, Scorching Ray) get their per-projectile
 * count + per-projectile dice from `spellRules.ts`.
 *
 * Per-hit procs (Ambush etc.) that fire per missile are NOT emitted here —
 * they live in the proc catalog (6.4.3) and read `projectileCount` to know
 * how many times they trigger per cast.
 */
export function abilityToBaseComponents(
  ability: MagicAbility,
  casterLevel: number,
): DamageComponent[] {
  const qty = projectileCount(ability.name, casterLevel);
  return ability.damages.map(d => ({
    label: `${ability.name} (base)`,
    trigger: { kind: 'per-cast', spell: ability.name },
    qtyPerTrigger: qty,
    avgDicePerHit: avgPerHit(ability.name, d.dice, casterLevel, ability.maxCasterLevel),
    damageType: d.damageType as SpellDamageType,
    scaleProfile: 'spell',
    useGenericVuln: true,
    useMRR: true,
  }));
}
