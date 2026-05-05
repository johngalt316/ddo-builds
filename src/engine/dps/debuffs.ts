// Phase 6.4.7 — Debuff catalog.
//
// Damage-relevant debuffs the user can layer onto the simulated target:
// vulnerability multipliers, MRR/PRR reductions. Each catalog entry has
// a fixed effect; the user toggles which are active and (informationally)
// whether the debuff is self-applied or coming from a party member.
//
// The aggregator collapses the active set down to the calculator's
// `Debuffs` shape (genericVulnPct, sonicVulnPct, effectiveMRR), which
// already feeds `componentDebuffMultiplier`.

import type { SpellDamageType } from '@/engine/breakdowns';
import type { Debuffs } from './calculator';

/** Where the user wants to attribute this debuff in the rotation model.
 *  Currently informational only — the math doesn't change with scope. */
export type DebuffScope = 'self' | 'party';

/** Categorical source — drives grouping in the panel + tooltip text. */
export type DebuffSource =
  | 'caster-spell'
  | 'martial-tactic'
  | 'item'
  | 'aura'
  | 'monster'
  | 'other';

export interface DebuffEffect {
  /** Generic damage vulnerability % (additive into the calculator's
   *  `genericVulnPct` for components flagged `useGenericVuln`). */
  genericVulnPct?: number;
  /** Element-specific vulnerability % per damage type. The aggregator
   *  currently only routes Sonic into the calculator's `sonicVulnPct`;
   *  other elements stay informational until the calculator grows
   *  per-element vulnerability flags (future). */
  elementVulnPct?: Partial<Record<SpellDamageType, number>>;
  /** Subtracted from the target's effective MRR for components flagged
   *  `useMRR`. Stacks across active debuffs. */
  mrrReduction?: number;
  /** Subtracted from PRR; informational for now (no PRR-flagged DPS
   *  components yet — surface when melee comes online). */
  prrReduction?: number;
}

export interface DebuffEntry {
  id: string;
  label: string;
  description: string;
  source: DebuffSource;
  effect: DebuffEffect;
  /** Default scope shown to the user when first encountered. The user
   *  can override per debuff. Doesn't affect damage math. */
  defaultScope: DebuffScope;
}

/**
 * Per-debuff user state. Lives in panel-local state for now (Phase 6.4.7
 * is UI-only); promote to the build / persisted state if it ever has a
 * permanent home there.
 */
export type DebuffState = Record<string, { enabled: boolean; scope: DebuffScope }>;

// ── Catalog (seed) ───────────────────────────────────────────────────────

/**
 * Starter catalog. Hand-curated from common DDO knowledge — the wiki's
 * Category:Debuffs page is sparse, so this list grows as users surface
 * more debuffs they care about. Magnitudes reflect typical end-game
 * values; users can model "Custom" effects via the panel for anything
 * not represented here.
 */
export const DEBUFF_CATALOG: DebuffEntry[] = [
  {
    id: 'improved-sunder',
    label: 'Improved Sunder',
    description: 'Fighter tactic: target loses 25 MRR and 25 PRR.',
    source: 'martial-tactic',
    effect: { mrrReduction: 25, prrReduction: 25 },
    defaultScope: 'self',
  },
  {
    id: 'sundering-words',
    label: 'Sundering Words',
    description: 'Bard / cleric mass debuff: 20 MRR & 20 PRR reduction on targets within range.',
    source: 'caster-spell',
    effect: { mrrReduction: 20, prrReduction: 20 },
    defaultScope: 'party',
  },
  {
    id: 'curse-of-vulnerability',
    label: 'Curse of Vulnerability',
    description: 'Caster curse: target takes +20% damage from all sources.',
    source: 'caster-spell',
    effect: { genericVulnPct: 20 },
    defaultScope: 'party',
  },
  {
    id: 'expose-weakness',
    label: 'Expose Weakness',
    description: 'Rogue / Arcane Trickster: target takes +10% damage from all sources.',
    source: 'martial-tactic',
    effect: { genericVulnPct: 10 },
    defaultScope: 'self',
  },
  {
    id: 'word-of-detonation-fire',
    label: 'Word of Detonation (Fire)',
    description: 'Sorc / Wiz: target takes +25% Fire damage.',
    source: 'caster-spell',
    effect: { elementVulnPct: { Fire: 25 } },
    defaultScope: 'party',
  },
  {
    id: 'word-of-detonation-sonic',
    label: 'Word of Detonation (Sonic)',
    description: 'Sorc / Wiz: target takes +25% Sonic damage.',
    source: 'caster-spell',
    effect: { elementVulnPct: { Sonic: 25 } },
    defaultScope: 'party',
  },
];

// ── Aggregation ──────────────────────────────────────────────────────────

/** Initialize a state map covering every catalog entry, all disabled by
 *  default but seeded with each entry's `defaultScope`. */
export function initialDebuffState(catalog: DebuffEntry[] = DEBUFF_CATALOG): DebuffState {
  const out: DebuffState = {};
  for (const entry of catalog) {
    out[entry.id] = { enabled: false, scope: entry.defaultScope };
  }
  return out;
}

/**
 * Collapse the user's active debuffs into the calculator's `Debuffs`
 * input. Vulnerabilities are additive; MRR reductions accumulate; only
 * Sonic element vuln is currently routed (extend the calculator's
 * Debuffs shape if more elements need bespoke vuln slots).
 */
export function aggregateDebuffs(
  state: DebuffState,
  catalog: DebuffEntry[] = DEBUFF_CATALOG,
): Debuffs {
  let genericVulnPct = 0;
  let sonicVulnPct   = 0;
  let mrrSubtract    = 0;
  for (const entry of catalog) {
    if (!state[entry.id]?.enabled) continue;
    const e = entry.effect;
    if (e.genericVulnPct)            genericVulnPct += e.genericVulnPct;
    if (e.elementVulnPct?.Sonic)     sonicVulnPct   += e.elementVulnPct.Sonic;
    if (e.mrrReduction)              mrrSubtract    += e.mrrReduction;
  }
  return {
    genericVulnPct,
    sonicVulnPct,
    // Baseline MRR 0; debuffs make it negative. Avoid -0 when no debuff applies.
    effectiveMRR: mrrSubtract ? -mrrSubtract : 0,
  };
}
