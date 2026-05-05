// Phase 6.2 — Cooldown- and charge-aware rotation timing.
//
// Walks an ordered rotation and assigns each cast a (startTime, endTime,
// cdReadyAt, chargesRemaining) tuple. Each cast can't fire unless:
//   • the previous cast has finished (global progression), AND
//   • the SAME ability's cooldown has elapsed since its last cast, AND
//   • the ability has at least one charge left (when charge-limited).
//
// DDO convention: cooldown is measured from cast START (so a 5s CD on a
// 1s cast leaves a 4s real wait after the cast finishes).
//
// Charges represent per-rest uses. When `ability.charges === 0` the cast
// is treated as unlimited; when > 0 we decrement on each cast and refuse
// further casts once the pool is empty.

import type { MagicAbility } from './abilities';
import type { RotationStep } from './rotation';

export interface ResolvedStep {
  step: RotationStep;
  ability: MagicAbility;
  /** Wall-clock seconds when this cast begins. */
  startTime: number;
  /** Wall-clock seconds when this cast finishes (startTime + castTime). */
  endTime: number;
  /** Effective cooldown after build modifiers (seconds). */
  effectiveCooldown: number;
  /** Wall-clock seconds when the ability is ready to cast again. */
  cdReadyAt: number;
  /** True when CD enforcement inserted dead time before this cast. */
  hasGap: boolean;
  /** Per-rest charges remaining AFTER this cast fires. `Infinity` for
   *  unlimited-charge abilities. */
  chargesRemaining: number;
}

/** Why a step couldn't fire — used for UI to flag the broken cast. */
export type StepFailureReason = 'no-charges';

export interface SkippedStep {
  step: RotationStep;
  ability: MagicAbility;
  reason: StepFailureReason;
}

export interface TimelineTiming {
  steps: ResolvedStep[];
  /** Steps that couldn't fire (e.g. SLA out of charges). */
  skipped: SkippedStep[];
  /** Total wall-clock duration of one cycle of the rotation in seconds. */
  totalSeconds: number;
}

/**
 * Walk the rotation and return per-step timing. Steps whose ability is no
 * longer in the catalog are dropped silently — the caller can show a
 * placeholder in the UI for the original `RotationStep`.
 *
 * `cooldownReductionPct` is the SUMMED reduction (e.g. 20 means -20%).
 * Effective cooldown = base × (1 - pct/100), floored at 0.
 */
/**
 * Find the first index in `steps` where inserting `newAbility` would
 * land in an existing cooldown gap — i.e. the new cast can fire there
 * without lengthening the rotation cycle. A gap is fillable when:
 *
 *   1. `newAbility`'s own cooldown has elapsed by the gap's start
 *      (no prior cast of the same ability earlier in the rotation
 *      blocks it), AND
 *   2. The gap is at least as wide as the new ability's cast time.
 *
 * Returns `steps.length` when no fillable gap exists; the caller can
 * fall through to appending in that case.
 */
export function findFirstAvailableSlot(
  steps: RotationStep[],
  newAbility: MagicAbility,
  abilityById: Map<string, MagicAbility>,
  cooldownReductionPct: number,
): number {
  const cdMul       = Math.max(0, 1 - cooldownReductionPct / 100);
  const newCdEff    = newAbility.cooldown * cdMul;
  const newCastTime = newAbility.castTime;
  const EPS = 1e-6;

  const lastStart = new Map<string, number>();
  let cursor = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const ability = abilityById.get(step.abilityId);
    if (!ability) continue;

    const eff       = ability.cooldown * cdMul;
    const cdReady   = (lastStart.get(ability.id) ?? -Infinity) + eff;
    const startTime = Math.max(cursor, cdReady);
    const gap       = startTime - cursor;

    const newCdReady = (lastStart.get(newAbility.id) ?? -Infinity) + newCdEff;
    if (newCdReady <= cursor + EPS && gap + EPS >= newCastTime) {
      return i;   // insert before this step — fills the gap exactly
    }

    lastStart.set(ability.id, startTime);
    cursor = startTime + ability.castTime;
  }

  return steps.length;
}

export function resolveTimeline(
  steps: RotationStep[],
  abilityById: Map<string, MagicAbility>,
  cooldownReductionPct: number,
): TimelineTiming {
  const lastStart = new Map<string, number>();
  // Charges-remaining ledger. Seeded lazily on first cast of a charged
  // ability so we don't reserve entries for unlimited abilities.
  const chargesLeft = new Map<string, number>();
  const out: ResolvedStep[] = [];
  const skipped: SkippedStep[] = [];
  let cursor = 0;
  const cdMul = Math.max(0, 1 - cooldownReductionPct / 100);

  for (const step of steps) {
    const ability = abilityById.get(step.abilityId);
    if (!ability) continue;

    // Charge gate — only meaningful when the ability is limited (>0).
    if (ability.charges > 0) {
      const remaining = chargesLeft.has(ability.id)
        ? chargesLeft.get(ability.id)!
        : ability.charges;
      if (remaining <= 0) {
        skipped.push({ step, ability, reason: 'no-charges' });
        continue;                                       // skip — no time spent
      }
      chargesLeft.set(ability.id, remaining - 1);
    }

    const effectiveCooldown = ability.cooldown * cdMul;
    const cdReady = (lastStart.get(ability.id) ?? -Infinity) + effectiveCooldown;
    const startTime = Math.max(cursor, cdReady);
    const endTime   = startTime + ability.castTime;
    const hasGap    = startTime > cursor + 1e-6;
    lastStart.set(ability.id, startTime);
    out.push({
      step, ability, startTime, endTime,
      effectiveCooldown,
      cdReadyAt: startTime + effectiveCooldown,
      hasGap,
      chargesRemaining: ability.charges > 0
        ? chargesLeft.get(ability.id)!
        : Infinity,
    });
    cursor = endTime;
  }
  return { steps: out, skipped, totalSeconds: cursor };
}
