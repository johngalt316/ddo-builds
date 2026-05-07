// Per-spell SP cost.
//
// The reference SP-per-cast number for any rotation entry is:
//
//   final = max(0, base + modifiers)
//
// where `modifiers` rolls up:
//   • metamagic surcharges from active toggles, gated by per-spell
//     eligibility flags (e.g. Empower only adds cost when the spell
//     has `metamagic.empower === true`)
//   • per-metamagic cost reductions from feats / enhancements / past
//     lives, sourced as `MetamagicCost*` effects on the build
//   • a flat percent reduction from `SpellPointCostPercent` effects
//     (epic feats etc.) applied last
//
// Everything is data-driven from public/data/Metamagics.xml — see
// DDOMetamagicData. The base cost lives on the spell entry (or the
// class override). Eligibility is a boolean field on
// DDOSpellMetamagic; the catalog tells us which field to read.

import type { Build } from '@/types/build';
import { getActiveEnhancementSet } from '@/types/build';
import type {
  DDOMetamagicData,
  DDOSpellData,
  DDOSpellMetamagic,
  DDOClassData,
} from '@/types/ddoData';
import type { EngineResult } from '@/engine/runEngine';
import type { MagicAbility } from './abilities';
import type { RotationStep } from './rotation';

/** Sums the build's collected `MetamagicCost*` and
 *  `SpellPointCostPercent` bonuses into a per-metamagic flat reduction
 *  map plus a single percent reduction. The values come straight off
 *  `EngineResult.allBonuses` — same path used for stat breakdowns. */
export interface SpellCostReductions {
  /** key = metamagic name (matches DDOMetamagicData.name). value = SP saved per cast. */
  perMetamagic: Record<string, number>;
  /** Flat percent off the post-base/surcharge total (0–100). */
  percentReduction: number;
}

export function aggregateSpellCostReductions(
  engine: EngineResult,
  metamagics: DDOMetamagicData[],
): SpellCostReductions {
  const perMetamagic: Record<string, number> = {};
  let percentReduction = 0;

  // The engine exposes its raw Bonus pool via `allBonuses` so a few
  // domain-specific consumers (spell cost, fate-point bonus, …) can
  // route effect types we don't bucket into top-level breakdowns.
  // SP cost reductions stack additively — no Highest-Only competition
  // since the upstream sources are all per-stack feats / enhancements
  // / past lives, not gear.
  for (const b of engine.allBonuses ?? []) {
    const t = b.effectType;
    if (!t) continue;
    if (t === 'SpellPointCostPercent') {
      percentReduction += b.value;
      continue;
    }
    for (const mm of metamagics) {
      if (t === mm.costReductionEffect) {
        perMetamagic[mm.name] = (perMetamagic[mm.name] ?? 0) + b.value;
        break;
      }
    }
  }
  return { perMetamagic, percentReduction };
}

/** Per-spell metamagic surcharge breakdown — used by tooltips that
 *  want to show "base + each metamagic" instead of just the rolled-up
 *  total. The DPS calculator usually uses `spellCost()` for the total. */
export interface SpellCostBreakdown {
  base:      number;
  modifiers: number;
  total:     number;
  /** Per-metamagic line items (only those that fire on this spell). */
  perMetamagic: Array<{
    name: string;
    surcharge: number;
    reduction: number;
    net:       number;
  }>;
  /** Resolved percent reduction (0–100) applied at the end. */
  percentReduction: number;
}

interface ResolvedAbility {
  baseCost:    number;
  spellLevel?: number;
  metamagic?:  DDOSpellMetamagic;
}

/** Pull base cost + spell-level + eligibility from a class catalog row
 *  + spell catalog entry, mirroring how `getMagicAbilities` resolves
 *  per-class overrides. SLAs without a spell entry still get costed. */
function resolveAbility(
  ability: MagicAbility,
  spellCatalog: DDOSpellData[],
  classCatalog: DDOClassData[],
): ResolvedAbility {
  const spell = spellCatalog.find(s => s.name === ability.name);
  let baseCost = ability.cost;
  if (ability.source === 'spell' && ability.className) {
    const cls = classCatalog.find(c => c.name === ability.className);
    const cs = cls?.spells.find(cs => cs.name === ability.name);
    if (cs?.cost !== undefined) baseCost = cs.cost;
    else if (spell?.cost !== undefined) baseCost = spell.cost;
  }
  return {
    baseCost,
    spellLevel: ability.spellLevel,
    metamagic:  spell?.metamagic,
  };
}

/** Highest spell level the build can currently cast across all
 *  casting classes. Drives Heighten's per-level surcharge. */
function maxCastableSpellLevel(build: Build, classes: DDOClassData[]): number {
  let max = 0;
  for (const cl of build.classes) {
    if (cl.levels <= 0) continue;
    const cdata = classes.find(c =>
      c.name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_') === cl.classId);
    if (!cdata) continue;
    const slotRow = cdata.spellSlotsByLevel?.[cl.levels - 1] ?? [];
    for (let i = 0; i < slotRow.length; i++) {
      if ((slotRow[i] ?? 0) > 0 && i + 1 > max) max = i + 1;
    }
  }
  return max;
}

/** True when a metamagic's eligibility flag is set on the spell's
 *  metamagic flag bag (or the wildcard sentinel `'any'`). */
function appliesToSpell(mm: DDOMetamagicData, mflags: DDOSpellMetamagic | undefined): boolean {
  if (mm.spellEligibilityFlag === 'any') return true;
  if (!mflags) return false;
  return !!(mflags as Record<string, unknown>)[mm.spellEligibilityFlag];
}

/**
 * Per-cast surcharge contributed by a single metamagic, post-reduction.
 * For Heighten, the result depends on how many spell levels above its
 * native level the spell is being raised — the engine multiplies the
 * 1 SP base by `(maxLevel - spellLevel)`.
 */
function metamagicSurcharge(
  mm: DDOMetamagicData,
  resolved: ResolvedAbility,
  reductions: SpellCostReductions,
  maxSpellLevel: number,
): number {
  let raw = mm.baseSPCost;
  if (mm.costFormula === 'per-level') {
    const level = resolved.spellLevel ?? 1;
    const delta = Math.max(0, maxSpellLevel - level);
    raw = mm.baseSPCost * delta;
  }
  const reduction = reductions.perMetamagic[mm.name] ?? 0;
  return Math.max(0, raw - reduction);
}

/**
 * Resolve the SP cost of a single ability under the build's current
 * active metamagics + collected reductions. Returns a 2-row breakdown
 * (base + modifiers) plus per-metamagic line items for tooltip use.
 */
export function spellCostBreakdown(
  ability:        MagicAbility,
  build:          Build,
  _engine:        EngineResult,
  spellCatalog:   DDOSpellData[],
  classCatalog:   DDOClassData[],
  metamagics:     DDOMetamagicData[],
  reductions:     SpellCostReductions,
): SpellCostBreakdown {
  const resolved      = resolveAbility(ability, spellCatalog, classCatalog);
  const maxSpellLevel = maxCastableSpellLevel(build, classCatalog);
  const active        = new Set(build.activeMetamagics ?? []);
  const perMetamagic: SpellCostBreakdown['perMetamagic'] = [];

  let modifiersGross = 0;
  for (const mm of metamagics) {
    if (!active.has(mm.name)) continue;
    if (!appliesToSpell(mm, resolved.metamagic)) continue;

    const raw       = mm.costFormula === 'per-level'
      ? mm.baseSPCost * Math.max(0, maxSpellLevel - (resolved.spellLevel ?? 1))
      : mm.baseSPCost;
    const reduction = reductions.perMetamagic[mm.name] ?? 0;
    const net       = Math.max(0, raw - reduction);
    if (raw <= 0) continue;
    perMetamagic.push({ name: mm.shortName, surcharge: raw, reduction, net });
    modifiersGross += net;
  }

  const preTotal       = resolved.baseCost + modifiersGross;
  const pctReduction   = Math.min(100, Math.max(0, reductions.percentReduction));
  const afterPercent   = pctReduction > 0 ? preTotal * (1 - pctReduction / 100) : preTotal;
  const total          = Math.max(0, Math.round(afterPercent));
  const modifiers      = total - resolved.baseCost;

  return {
    base:             resolved.baseCost,
    modifiers,
    total,
    perMetamagic,
    percentReduction: pctReduction,
  };
}

/** Convenience wrapper for callers that just want the total SP. */
export function spellCost(
  ability:      MagicAbility,
  build:        Build,
  engine:       EngineResult,
  spellCatalog: DDOSpellData[],
  classCatalog: DDOClassData[],
  metamagics:   DDOMetamagicData[],
  reductions:   SpellCostReductions,
): number {
  return spellCostBreakdown(ability, build, engine, spellCatalog, classCatalog, metamagics, reductions).total;
}

// Re-use shared helpers for Heighten level calc (exposed for tests).
export const _internal = {
  resolveAbility,
  maxCastableSpellLevel,
  appliesToSpell,
  metamagicSurcharge,
};

// ── Reaper's Efficiency ────────────────────────────────────────────────
//
// Dire Thaumaturge T4 clickie. Activate to expend one Reaper Charge and
// reduce SP cost of all spells by 15/30/45% for 30 seconds. 60s native
// cooldown. When the user has the clickie in their rotation, we model
// the buff as an *average* percent reduction applied to the rotation's
// SP/minute total — uptime-weighted so a 60s cycle gets 30/60 = 50% of
// the full reduction, while a 30s cycle gets the full reduction (the
// buff covers the whole window).
//
// We don't fold this into the per-spell costBreakdown because the
// effect is rotation-aware (depends on which step is the activation
// and how long the cycle is) — keeping it at the SPM rollup level is
// simpler and still surfaces in the only place the user sees the
// total cost.

const REAPER_EFFICIENCY_ID = 'clickie::Dire Thaumaturge::DireEfficiency';
const REAPER_EFFICIENCY_PCT_BY_RANK = [15, 30, 45];   // ranks 1..3
const REAPER_EFFICIENCY_DURATION_SEC = 30;

export interface ReaperEfficiencyEffect {
  /** 0 when the user hasn't taken DireEfficiency. */
  rank:                   number;
  /** Per-rank base percent (15/30/45) before uptime weighting. */
  basePercent:            number;
  /** Fraction of the rotation cycle the buff is up (0..1). */
  uptimeFraction:         number;
  /** `basePercent × uptimeFraction` — the average percent off the
   *  rotation's SP cost. */
  effectiveReductionPct:  number;
}

/**
 * Compute Reaper's Efficiency's average SP-cost reduction for a given
 * rotation. Returns zeros if the buff isn't in the rotation, the user
 * has no rank, or the cycle length is zero.
 */
export function reaperEfficiencyEffect(
  build: Build,
  magicSteps: RotationStep[],
  rotationCycleSeconds: number,
): ReaperEfficiencyEffect {
  const empty: ReaperEfficiencyEffect = {
    rank: 0, basePercent: 0, uptimeFraction: 0, effectiveReductionPct: 0,
  };
  if (rotationCycleSeconds <= 0) return empty;
  if (!magicSteps.some(s => s.abilityId === REAPER_EFFICIENCY_ID)) return empty;

  // User's rank in the DireEfficiency tree item.
  const set = getActiveEnhancementSet(build);
  let rank = 0;
  for (const spend of set.reaperEnhancements) {
    const e = spend.enhancements.find(x => x.enhancementId === 'DireEfficiency');
    if (e && e.rank > rank) rank = e.rank;
  }
  if (rank <= 0) return empty;

  const basePercent    = REAPER_EFFICIENCY_PCT_BY_RANK[Math.min(rank, REAPER_EFFICIENCY_PCT_BY_RANK.length) - 1] ?? 0;
  const uptimeFraction = Math.min(1, REAPER_EFFICIENCY_DURATION_SEC / rotationCycleSeconds);
  return {
    rank,
    basePercent,
    uptimeFraction,
    effectiveReductionPct: basePercent * uptimeFraction,
  };
}
