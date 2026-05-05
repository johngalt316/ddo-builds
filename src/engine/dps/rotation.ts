// Phase 6.2 — Rotation data model.
//
// A rotation is just an ordered list of ability invocations. The simulator
// (6.4) walks this list, looping when it reaches the end, firing each step
// when CD + cost permit.

import type { MagicAbility } from './abilities';

export interface RotationStep {
  /** Unique within the rotation — used for React keys + drag/drop ordering. */
  key: string;
  /** Joins to MagicAbility.id. */
  abilityId: string;
}

export function newRotationStep(abilityId: string): RotationStep {
  // Crypto-uuid lookalike — local uniqueness is enough.
  const key = `${abilityId}-${Math.random().toString(36).slice(2, 10)}`;
  return { key, abilityId };
}

/** Resolve a rotation against the current ability catalog. Drops steps
 *  whose ability is no longer trained (e.g. user untrained a spell). */
export function resolveRotation(
  steps: RotationStep[],
  abilities: MagicAbility[],
): { step: RotationStep; ability: MagicAbility }[] {
  const byId = new Map<string, MagicAbility>();
  for (const a of abilities) byId.set(a.id, a);
  const out: { step: RotationStep; ability: MagicAbility }[] = [];
  for (const s of steps) {
    const a = byId.get(s.abilityId);
    if (a) out.push({ step: s, ability: a });
  }
  return out;
}
