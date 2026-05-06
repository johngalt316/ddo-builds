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
import { type RotationStep, newRotationStep } from './rotation';

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
 * fit into an existing cooldown gap — i.e. the new cast can complete
 * without delaying the next step in the rotation. A gap before step
 * `i` is fillable when:
 *
 *   max(cursor, newAbility's CD ready) + newCastTime ≤ steps[i].startTime
 *
 * — meaning the new cast may wait *inside* the gap for its own CD to
 * elapse, as long as it still finishes before the existing step is
 * scheduled to start.
 *
 * Also considers the tail gap: if the last step ends at `cursor` but
 * the rotation cycle's effective length (driven by another step's CD
 * pushing the next iteration's start) leaves idle time past the end,
 * a fitting cast lands at the tail too. Reflected by checking
 * `steps.length` as a final candidate position.
 *
 * Returns `steps.length` when no in-rotation gap fits; the caller
 * appends in that case.
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

  const lastStart  = new Map<string, number>();
  const groupReady = new Map<string, number>();
  let cursor = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const ability = abilityById.get(step.abilityId);
    if (!ability) continue;

    const eff   = ability.cooldown * cdMul;
    const own   = (lastStart.get(ability.id) ?? -Infinity) + eff;
    const grp   = ability.cooldownGroup
      ? (groupReady.get(ability.cooldownGroup) ?? -Infinity)
      : -Infinity;
    const startTime = Math.max(cursor, own, grp);

    const newOwn   = (lastStart.get(newAbility.id) ?? -Infinity) + newCdEff;
    const newGrp   = newAbility.cooldownGroup
      ? (groupReady.get(newAbility.cooldownGroup) ?? -Infinity)
      : -Infinity;
    const newCdReady       = Math.max(newOwn, newGrp);
    const earliestNewStart = Math.max(cursor, newCdReady);
    // Fits if the new cast can start at-or-after the gap's open AND
    // finish before the existing step begins. Allows waiting *inside*
    // the gap for the new ability's own CD to elapse.
    if (earliestNewStart + newCastTime <= startTime + EPS) {
      return i;
    }

    lastStart.set(ability.id, startTime);
    if (ability.cooldownGroup) {
      groupReady.set(ability.cooldownGroup, startTime + eff);
    }
    cursor = startTime + ability.castTime;
  }

  return steps.length;
}

/** Maximum rotation cycle length (seconds) the auto-fill click targets. */
export const FILL_TARGET_SECONDS = 60;

/**
 * Repeatedly insert `ability` into the rotation — preferring cooldown-gap
 * fills (which don't lengthen the cycle) and falling back to append —
 * until adding one more would push the cycle past `FILL_TARGET_SECONDS`.
 *
 * Used to make a single click on the palette materialize a full one-minute
 * rotation rather than a single cast. The caller can still drag/remove
 * individual steps after.
 *
 * Hard-capped at 200 iterations as a safety net (cast time is at least
 * 1.0s in the catalog so the natural bound is ~60, but a future
 * faster-cast spell shouldn't loop forever).
 */
export function fillToOneMinute(
  steps: RotationStep[],
  ability: MagicAbility,
  abilityById: Map<string, MagicAbility>,
  cooldownReductionPct: number,
): RotationStep[] {
  let next = [...steps];
  for (let i = 0; i < 200; i++) {
    const idx       = findFirstAvailableSlot(next, ability, abilityById, cooldownReductionPct);
    const candidate = [...next];
    candidate.splice(idx, 0, newRotationStep(ability.id));
    const { totalSeconds } = resolveTimeline(candidate, abilityById, cooldownReductionPct);
    if (totalSeconds > FILL_TARGET_SECONDS + 1e-6) break;
    next = candidate;
  }
  return next;
}

export function resolveTimeline(
  steps: RotationStep[],
  abilityById: Map<string, MagicAbility>,
  cooldownReductionPct: number,
): TimelineTiming {
  const lastStart  = new Map<string, number>();
  // Per-cooldown-group ready time. When firing a member of a group we
  // push the group's ready time to startTime + that fire's cooldown,
  // so any subsequent group member must wait at least that long.
  // Powers the Epic Strike "shared cooldown" rule.
  const groupReady = new Map<string, number>();
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
    const ownReady   = (lastStart.get(ability.id) ?? -Infinity) + effectiveCooldown;
    const groupCdReady = ability.cooldownGroup
      ? (groupReady.get(ability.cooldownGroup) ?? -Infinity)
      : -Infinity;
    const cdReady    = Math.max(ownReady, groupCdReady);
    const startTime  = Math.max(cursor, cdReady);
    const endTime    = startTime + ability.castTime;
    const hasGap     = startTime > cursor + 1e-6;
    lastStart.set(ability.id, startTime);
    if (ability.cooldownGroup) {
      groupReady.set(ability.cooldownGroup, startTime + effectiveCooldown);
    }
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
