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
import type { Build } from '@/types/build';
import { hasItemBuff, hasAugmentSlotted } from './procs';

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
  /** Subtracted from PRR; routed via `effectivePRR` for physical-rated
   *  components in `componentDebuffMultiplier`. */
  prrReduction?: number;
  /** How quickly the debuff reaches its modeled magnitude:
   *    'instant'  — full benefit the moment it's active (caster spells,
   *                 single-shot procs)
   *    'ramping'  — builds up to full over `rampSeconds`. The aggregator
   *                 scales every numeric magnitude by an average-stack
   *                 fraction over the fight duration.
   *  Defaults to 'instant' when omitted. */
  application?: 'instant' | 'ramping';
  /** For 'ramping' debuffs: seconds to reach full stacks from zero,
   *  assuming continuous trigger conditions (e.g. swinging a weapon
   *  every 2s × 20 stacks = 40s for Vulnerable). Ignored when
   *  `application !== 'ramping'`. */
  rampSeconds?: number;
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
  /** Auto-apply triggers — when the build carries any of the listed
   *  item-buff types or augment names, the debuff is treated as active
   *  even if the user hasn't manually toggled it. The Manage dialog
   *  shows these as locked-on with an "auto" badge. */
  autoApplyWhen?: {
    itemBuffs?: string[];
    augments?:  string[];
  };
}

/** Returns true when any of the entry's auto-apply triggers match the
 *  current build's gear / augments. Used by the aggregator + UI to
 *  fold detection into the existing per-debuff state. */
export function isDebuffAutoActive(entry: DebuffEntry, build: Build): boolean {
  const a = entry.autoApplyWhen;
  if (!a) return false;
  if (a.itemBuffs?.some(b => hasItemBuff(build, b))) return true;
  if (a.augments?.some(n => hasAugmentSlotted(build, n))) return true;
  return false;
}

/** Set of debuff ids whose auto-apply triggers fire on the current
 *  build. Lets the UI render those entries as locked-on with an
 *  "auto" badge regardless of the user's manual toggle state. */
export function autoActiveDebuffIds(
  build: Build,
  catalog: DebuffEntry[] = DEBUFF_CATALOG,
): Set<string> {
  const out = new Set<string>();
  for (const e of catalog) {
    if (isDebuffAutoActive(e, build)) out.add(e.id);
  }
  return out;
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

  // ── Weapon-procced item debuffs (assumes fully stacked) ──────────────
  // Sources: Mind Tear, Flamehorn, LGS Ash, etc. (50% proc on hit).
  // Per-stack: −7 MRR, −20 USP. 3-stack cap → −21 MRR fully stacked.
  // The USP reduction affects the target's casting, not ours, so it
  // doesn't enter the damage math.
  {
    id: 'legendary-ash',
    label: 'Legendary Ash',
    description: 'Weapon proc: 3 stacks × −7 MRR (max −21 MRR). Also −20 USP/stack on the target.',
    source: 'item',
    // 50% proc on hit at ~1 hit/sec → 3 stacks land in ~6s of combat.
    effect: { mrrReduction: 21, application: 'ramping', rampSeconds: 6 },
    defaultScope: 'self',
    autoApplyWhen: {
      itemBuffs: ['Mind Tear'],
      augments:  ['Flamehorn', 'LGS Ash'],
    },
  },
  // Sources: Constricting Nightmare, Shadowhorn, Aspect of Tar.
  // Single-stack proc — does not stack with itself.
  {
    id: 'ooze',
    label: 'Ooze',
    description: 'Weapon proc: −10 MRR and −10 PRR (single stack).',
    source: 'item',
    effect: { mrrReduction: 10, prrReduction: 10 },
    defaultScope: 'self',
    autoApplyWhen: {
      itemBuffs: ['Constricting Nightmare', 'Aspect of Tar'],
      augments:  ['Shadowhorn'],
    },
  },
  // Sources: Soul Tear, Melthorn, LGS Dust. Per-stack: −7 PRR, −20
  // Positive Heal Amp. 5-stack cap. PRR-only, informational on the
  // damage side until the engine grows physical-damage components.
  {
    id: 'legendary-dust',
    label: 'Legendary Dust',
    description: 'Weapon proc: 5 stacks × −7 PRR (max −35 PRR). Also reduces target healing.',
    source: 'item',
    // 50% proc on hit at ~1 hit/sec → 5 stacks land in ~10s.
    effect: { prrReduction: 35, application: 'ramping', rampSeconds: 10 },
    defaultScope: 'self',
    autoApplyWhen: {
      itemBuffs: ['Soul Tear'],
      augments:  ['Melthorn', 'LGS Dust'],
    },
  },
  // Vulnerability (general). Sources: Fetters of Unreality, Sparkhorn,
  // Flamebitten, Frostbite weapons. +1% damage taken / stack, max 20
  // stacks → +20% at full stacks. Stacks with itself; standard
  // generic-vuln channel.
  {
    id: 'vulnerable',
    label: 'Vulnerable (Mythic)',
    description: 'Weapon proc stacks: +1% damage taken / stack (max 20 stacks → +20%).',
    source: 'item',
    // 1 stack per swing, ICD 2s → 20 stacks land in ~40s.
    effect: { genericVulnPct: 20, application: 'ramping', rampSeconds: 40 },
    defaultScope: 'self',
    autoApplyWhen: {
      itemBuffs: ['Flamebitten', 'Frostbite', 'Sparkhorn', 'Fetters of Unreality'],
    },
  },
  // Fatesinger Tier 5. +10% sonic vulnerability per stack, max 3 →
  // +30% Sonic at full stacks. Also drops 15 AC per stack but AC is
  // phys-only so we leave that off the damage path.
  {
    id: 'harmonic-resonance',
    label: 'Harmonic Resonance',
    description: 'Fatesinger T5: 3 stacks × +10% Sonic vulnerability (max +30%).',
    source: 'caster-spell',
    // Stacks on Sonic-school casts; 3 casts to fully stack ≈ 6s.
    effect: { elementVulnPct: { Sonic: 30 }, application: 'ramping', rampSeconds: 6 },
    defaultScope: 'self',
  },
  // Shadowdancer Tier 4. −3 SR/PRR/MRR per stack, max 3 → −9 of each
  // at full stacks. The SR reduction is informational (we route MRR
  // for damage already).
  {
    id: 'darkness',
    label: 'Darkness',
    description: 'Shadowdancer T4: 3 stacks × −3 PRR / MRR / SR (max −9 of each).',
    source: 'caster-spell',
    // Stacks on each spellcast; 3 casts ≈ 4s in a normal rotation.
    effect: { mrrReduction: 9, prrReduction: 9, application: 'ramping', rampSeconds: 4 },
    defaultScope: 'self',
  },
  // Soul Eater Tier 2. −2 SR/PRR/MRR per stack, max 5 → −10 of each
  // when fully stacked. Procs on Consume.
  {
    id: 'taint-the-aura',
    label: 'Taint the Aura',
    description: 'Soul Eater T2: 5 stacks × −2 PRR / MRR / SR (max −10 of each).',
    source: 'caster-spell',
    // Procs on Consume casts only; ~5s per Consume → 5 stacks ≈ 25s.
    effect: { mrrReduction: 10, prrReduction: 10, application: 'ramping', rampSeconds: 25 },
    defaultScope: 'self',
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
/**
 * Average-stack fraction for a ramping debuff over a fight of length
 * `fightSeconds`, given linear ramp 0→full over `rampSeconds`. Returns
 * 1.0 when ramp is zero, the fight is infinite, or the ramp is short
 * relative to the fight; bounded to [0, 1].
 */
export function averageStackFraction(rampSeconds: number, fightSeconds: number): number {
  if (rampSeconds <= 0) return 1;
  if (!Number.isFinite(fightSeconds) || fightSeconds <= 0) return 1;
  if (fightSeconds <= rampSeconds) {
    // Ramping for the entire fight. Linear from 0 to fightSeconds/rampSeconds;
    // average is half the end value.
    return Math.min(1, fightSeconds / (2 * rampSeconds));
  }
  // Ramping in the first rampSeconds, fully stacked after.
  return Math.max(0, Math.min(1, 1 - rampSeconds / (2 * fightSeconds)));
}

export function aggregateDebuffs(
  state: DebuffState,
  catalog: DebuffEntry[] = DEBUFF_CATALOG,
  build?: Build,
  fightSeconds: number = Infinity,
): Debuffs {
  let genericVulnPct = 0;
  let sonicVulnPct   = 0;
  let mrrSubtract    = 0;
  let prrSubtract    = 0;
  const elementVulnPct: Partial<Record<SpellDamageType, number>> = {};
  for (const entry of catalog) {
    const userEnabled = !!state[entry.id]?.enabled;
    const autoEnabled = build ? isDebuffAutoActive(entry, build) : false;
    if (!userEnabled && !autoEnabled) continue;
    const e = entry.effect;
    // Ramping debuffs scale every numeric magnitude by their average-
    // stack fraction over the fight duration. Instant (default) keeps
    // the full magnitude.
    const fraction = e.application === 'ramping' && e.rampSeconds
      ? averageStackFraction(e.rampSeconds, fightSeconds)
      : 1;
    if (e.genericVulnPct)  genericVulnPct += e.genericVulnPct * fraction;
    if (e.mrrReduction)    mrrSubtract    += e.mrrReduction   * fraction;
    if (e.prrReduction)    prrSubtract    += e.prrReduction   * fraction;
    if (e.elementVulnPct) {
      for (const [el, v] of Object.entries(e.elementVulnPct)) {
        if (!v) continue;
        const key = el as SpellDamageType;
        const scaled = v * fraction;
        elementVulnPct[key] = (elementVulnPct[key] ?? 0) + scaled;
        // Keep the legacy `sonicVulnPct` field populated so existing
        // tests + fixtures that read it continue to work.
        if (key === 'Sonic') sonicVulnPct += scaled;
      }
    }
  }
  const hasElementVuln = Object.keys(elementVulnPct).length > 0;
  return {
    genericVulnPct,
    sonicVulnPct,
    // Baseline 0; debuffs make these negative. Avoid -0 when nothing applies.
    effectiveMRR: mrrSubtract ? -mrrSubtract : 0,
    effectivePRR: prrSubtract ? -prrSubtract : 0,
    ...(hasElementVuln ? { elementVulnPct } : {}),
  };
}
