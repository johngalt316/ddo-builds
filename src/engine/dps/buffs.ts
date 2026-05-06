// Phase 6.4.8 — Transient buff system.
//
// A `Buff` is a time-bounded effect applied when a specific cast (or set
// of casts) fires. While active it adds DamageComponents to every cast
// that overlaps its window — the casting cast itself (when affectsSelf)
// and any subsequent cast that fires before the buff expires.
//
// Maintaining the buff at high uptime is part of optimal rotation; the
// engine quantifies that uptime fraction so the calculator can scale the
// buff's contribution by how often it's actually active.
//
// Differs from a Proc:
//   • A Proc is unconditional: if the build qualifies, it fires on every
//     cast forever.
//   • A Buff is conditional: it fires only on casts that overlap an
//     active window, where the windows come from upstream casts in the
//     rotation timeline. Optimal rotation ≈ keep buff up = ≈ Proc; bad
//     rotation = lower contribution.

import type { Build } from '@/types/build';
import { getActiveEnhancementSet } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import type { DamageComponent } from './damage';
import type { MagicAbility } from './abilities';
import type { ResolvedStep } from './timing';
import type { ProcContext } from './procs';

export interface Buff {
  /** Stable id for breakdowns / tests. */
  id: string;
  /** Display name. */
  label: string;
  /** Icon basename in /assets/images/SpellImages/ (no extension). */
  icon: string;
  /** Buff duration in seconds. */
  duration: number;
  /** True if the build can apply this buff at all (e.g. enhancement taken). */
  isAvailable: (build: Build, engine: EngineResult) => boolean;
  /** Does this cast trigger (re-apply) the buff? */
  appliedBy: (ability: MagicAbility, build: Build, engine: EngineResult) => boolean;
  /** Does the cast that applies the buff also benefit from it the same
   *  cast? Default true. Override per buff if the in-game order is
   *  "buff lands AFTER the cast resolves". */
  affectsSelf?: boolean;
  /** Damage contribution per benefiting cast. Same shape as Proc.toComponents. */
  toComponents: (build: Build, engine: EngineResult, ctx: ProcContext) => DamageComponent[];
}

/** One active buff window in the rotation cycle. */
export interface BuffWindow {
  buffId: string;
  /** Wall-clock start (the triggering cast's startTime). */
  start: number;
  /** Wall-clock end (start + buff.duration). May extend past cycleSeconds. */
  end: number;
}

export interface ActiveBuff {
  buff: Buff;
  /** Windows ordered by start time. */
  windows: BuffWindow[];
  /** Step keys (`step.key` from the timeline) of casts that benefit. */
  benefitingStepKeys: Set<string>;
  /** Active fraction of the rotation cycle, considering wrap-around
   *  windows from the previous cycle (steady-state assumption). */
  uptimeFraction: number;
}

/**
 * Compute every active buff window + benefiting cast set + uptime fraction
 * for the given build's resolved rotation timeline.
 *
 * Steady-state model: the rotation repeats forever, so a window applied
 * by the LAST cast extends into the start of the next cycle. We model
 * this by simulating two concatenated cycles and reading the second cycle.
 */
export function computeActiveBuffs(
  buffs: Buff[],
  timeline: ResolvedStep[],
  cycleSeconds: number,
  build: Build,
  engine: EngineResult,
): ActiveBuff[] {
  const out: ActiveBuff[] = [];
  if (cycleSeconds <= 0) return out;

  for (const buff of buffs) {
    if (!buff.isAvailable(build, engine)) continue;

    // Collect windows from this cycle. (Upstream wrap-around — windows
    // from the *previous* cycle that bleed into this one — is handled
    // via duplicating windows shifted by ±cycleSeconds when checking.)
    const windows: BuffWindow[] = [];
    for (const step of timeline) {
      if (!buff.appliedBy(step.ability, build, engine)) continue;
      windows.push({
        buffId: buff.id,
        start: step.startTime,
        end:   step.startTime + buff.duration,
      });
    }
    if (windows.length === 0) continue;

    // Build steady-state coverage: for each window, also consider the
    // copy shifted -cycleSeconds (i.e. it was applied in the *previous*
    // cycle and might still be active at the start of this one).
    const steadyWindows: { start: number; end: number }[] = [];
    for (const w of windows) {
      steadyWindows.push({ start: w.start, end: w.end });
      steadyWindows.push({ start: w.start - cycleSeconds, end: w.end - cycleSeconds });
    }

    // ── Benefiting-cast set ─────────────────────────────────────────
    // A cast at time t benefits if any steady window covers t, OR — when
    // the buff's source cast is the same step and affectsSelf is true —
    // the cast's own starting moment counts as inside its own window.
    // (The window starts at t, so [start, end) includes t naturally.)
    const affectsSelf = buff.affectsSelf ?? true;
    const benefitingStepKeys = new Set<string>();
    for (const step of timeline) {
      const t = step.startTime;
      const inAnyWindow = steadyWindows.some(w => t >= w.start && t < w.end);
      if (inAnyWindow) {
        // If the cast IS the trigger and affectsSelf is false, exclude it
        // unless another window (from a different trigger) also covers t.
        if (!affectsSelf && buff.appliedBy(step.ability, build, engine)) {
          const otherWindow = steadyWindows.some(w =>
            t >= w.start && t < w.end && w.start !== t
          );
          if (!otherWindow) continue;
        }
        benefitingStepKeys.add(step.step.key);
      }
    }

    // ── Uptime fraction (union of windows in [0, cycleSeconds)) ────
    // Clip every steady window to [0, cycleSeconds), merge overlapping
    // intervals, sum lengths.
    const clipped = steadyWindows
      .map(w => ({ start: Math.max(0, w.start), end: Math.min(cycleSeconds, w.end) }))
      .filter(w => w.end > w.start)
      .sort((a, b) => a.start - b.start);
    let activeSeconds = 0;
    if (clipped.length > 0) {
      let mergeStart = clipped[0]!.start;
      let mergeEnd   = clipped[0]!.end;
      for (let i = 1; i < clipped.length; i++) {
        const w = clipped[i]!;
        if (w.start > mergeEnd) {
          activeSeconds += mergeEnd - mergeStart;
          mergeStart = w.start;
          mergeEnd   = w.end;
        } else {
          mergeEnd = Math.max(mergeEnd, w.end);
        }
      }
      activeSeconds += mergeEnd - mergeStart;
    }
    const uptimeFraction = Math.min(1, activeSeconds / cycleSeconds);

    out.push({ buff, windows, benefitingStepKeys, uptimeFraction });
  }
  return out;
}

// ── Catalog ──────────────────────────────────────────────────────────────

/**
 * Dark Imbuement — Shadowdancer Epic Strike upgrade.
 *
 *   "When you activate your Shadowdancer Epic Strike, you imbue your
 *    weapons and spells with Evil energies for 10 seconds. You deal 1d6
 *    per Sneak Attack Dice in Untyped damage on hit, scaling with Melee
 *    or Ranged Power."
 *
 * Triggered by any Shadowdancer Epic Strike cast (Nightmare Lance,
 * Shadowstrike Melee/Ranged). Lasts 10 s. While active it adds Nd6
 * Force damage (where N = sneak attack dice) per cast — to ANY cast,
 * not just the triggering one.
 *
 * Damage scaling: BUGGED — in-game the proc consumes BOTH Force Spell
 * Power AND max(MeleePower, RangedPower) as multiplicative scalars on
 * spellcasts. The `'dark-imbuement'` profile in calculator.ts encodes
 * the dual scaling.
 */
export const DARK_IMBUEMENT: Buff = {
  id: 'dark-imbuement',
  label: 'Dark Imbuement',
  icon: 'DarkImbuement',
  duration: 10,
  isAvailable: (build) =>
    getActiveEnhancementSet(build).destinyEnhancements.some(d =>
      d.enhancements.some(e => e.selection === 'Dark Imbuement'),
    ),
  appliedBy: (ability) =>
    ability.cooldownGroup === 'epic-strike'
    && (ability.slaSource ?? '').includes('Shadowdancer'),
  toComponents: (_build, _engine, ctx) => {
    if (ctx.sneakAttackDice <= 0) return [];
    return [{
      label: 'Dark Imbuement',
      // Triggers on every benefiting cast — the calculator scales the
      // per-cast cpm by the buff's uptime fraction at rotation roll-up.
      trigger: { kind: 'per-cast' },
      qtyPerTrigger: 1,
      avgDicePerHit: ctx.sneakAttackDice * 3.5,   // Nd6 average
      damageType: 'Force',
      scaleProfile: 'dark-imbuement',
      // ignores generic vuln, sonic vuln, and MRR per the spreadsheet
    }];
  },
};

export const BUFF_CATALOG: Buff[] = [
  DARK_IMBUEMENT,
];
