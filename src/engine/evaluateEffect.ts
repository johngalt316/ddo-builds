// Effect → Bonus[] evaluator.
//
// Translates a parsed DDOEffect (from a feat / item / set bonus / etc.)
// into the typed Bonus values consumed by the stacking engine. The Effect
// schema lets one block target multiple stat types (e.g. MeleePower +
// Doublestrike) and multiple sub-targets (e.g. Strength + Constitution),
// so a single Effect can fan out to N bonuses.
//
// Cardinality: typically `types × items` bonuses, with the `target`
// distinguishing which sub-target each bonus applies to. Effects with no
// items (generic stat boost like a flat MeleePower bonus) emit one bonus
// per type.
//
// Out-of-scope for the MVP (effect is recorded as not-modeled and skipped):
//   - Slider / SliderValue / SliderValueLookup (UI-driven runtime values)
//   - SLA / SpellInfo (spell-list metadata, not stat math)
//   - Dice / CriticalDice (DPS pane consumes these directly)
//   - Stance gating where the build doesn't track active stances yet

import type { DDOEffect, DDORequirements } from '@/types/ddoData';
import type { Bonus } from './bonusStacking';

// AmountType strings we can evaluate now. Anything outside this set is
// flagged as not-modeled and the effect is skipped.
const SUPPORTED_AMOUNT_TYPES = new Set([
  'Simple', 'NotNeeded', 'Stacks',
  'TotalLevel', 'BaseClassLevel', 'ClassLevel', 'ClassCasterLevel',
  'AbilityValue', 'AbilityTotal', 'AbilityMod',
  'HalfAbilityMod', 'ThirdAbilityMod',
  'FeatCount', 'BAB',
  'APCount',
]);

export interface BuildContext {
  /** Total character level. */
  totalLevel: number;
  /** Map: classId (lowercased, normalized) → number of levels in that class. */
  classLevels: Map<string, number>;
  /** Map: baseClassId → max number of levels in any class with that base. */
  baseClassLevels: Map<string, number>;
  /** Race id (lowercased + underscores). */
  raceId: string;
  /** Race name as it appears in XML (e.g. "Eladrin", "Half-Elf"). */
  raceName: string;
  /** Names of feats currently selected (unique, exact name strings). */
  feats: ReadonlySet<string>;
  /** Pre-effects ability scores (base + race mods only). Used for Ability* amount types. */
  abilityScores: Record<string, number>;
  /** BAB before effects. */
  bab: number;
  /** AP spent per enhancement tree name (lowercased). For APCount amount type. */
  apSpentInTree: Map<string, number>;
  /** Active stances. Stance-gated effects fire only if their stance is in this set. */
  activeStances: ReadonlySet<string>;
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Look up an ability score by the XML name ("Strength", "Dexterity", …). */
function abilityByName(name: string, scores: Record<string, number>): number | undefined {
  const map: Record<string, string> = {
    Strength: 'STR', Dexterity: 'DEX', Constitution: 'CON',
    Intelligence: 'INT', Wisdom: 'WIS', Charisma: 'CHA',
  };
  const code = map[name];
  return code ? scores[code] : undefined;
}

/** Test a single Requirement against the build context. Unknown types pass (don't gate). */
function passesRequirement(req: { type: string; item?: string; value?: number }, ctx: BuildContext): boolean {
  const item = req.item ?? '';
  const value = req.value ?? 0;
  switch (req.type) {
    case 'Class': {
      // exact prestige class match
      const lvl = ctx.classLevels.get(item.toLowerCase()) ?? 0;
      return value > 0 ? lvl >= value : lvl > 0;
    }
    case 'BaseClass': {
      const lvl = ctx.baseClassLevels.get(item.toLowerCase()) ?? 0;
      return value > 0 ? lvl >= value : lvl > 0;
    }
    case 'ClassMinLevel': {
      const lvl = ctx.classLevels.get(item.toLowerCase()) ?? 0;
      return lvl >= value;
    }
    case 'BaseClassMinLevel': {
      const lvl = ctx.baseClassLevels.get(item.toLowerCase()) ?? 0;
      return lvl >= value;
    }
    case 'TotalLevel':
    case 'SpecificLevel':
    case 'CharacterLevel':
      // Three flavors of "character has reached level X" — DDO data uses
      // them interchangeably. All compare against current character level.
      return ctx.totalLevel >= value;
    case 'Race':
      return ctx.raceName.toLowerCase() === item.toLowerCase()
          || ctx.raceId === item.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
    case 'Feat':
      return ctx.feats.has(item);
    case 'Stance':
      return ctx.activeStances.has(item);
    case 'Ability':
      // Ability X >= value
      return (abilityByName(item, ctx.abilityScores) ?? 0) >= value;
    default:
      // Unknown requirement type — don't block; engine logs as not-modeled
      // upstream. Returning true here means we err on the side of including
      // bonuses, which matches DDOBuilderV2's "show effects, even if gates
      // can't be evaluated" stance.
      return true;
  }
}

/** Evaluate a Requirements block against a BuildContext. Tolerates undefined/partial blocks (the catalog JSON omits empty fields to save space). */
export function passesRequirements(reqs: DDORequirements | undefined, ctx: BuildContext): boolean {
  if (!reqs) return true;
  for (const r of reqs.allOf ?? []) {
    if (!passesRequirement(r, ctx)) return false;
  }
  for (const group of reqs.oneOf ?? []) {
    if (group.length === 0) continue;
    if (!group.some(r => passesRequirement(r, ctx))) return false;
  }
  for (const group of reqs.noneOf ?? []) {
    if (group.some(r => passesRequirement(r, ctx))) return false;
  }
  return true;
}

/** Result of evaluating one effect. */
export interface EvaluatedEffect {
  bonuses: Bonus[];
  skipped?: 'unmodeled-amount-type' | 'requirements-failed' | 'no-amount';
  unmodeledAmountType?: string;
}

/**
 * Compute the numeric value of an effect from its amount table + amount type.
 * Returns undefined if we can't evaluate (caller will skip the effect).
 *
 * `rankCount` is how many ranks/stacks this effect is currently applying
 * (1 by default for non-stacking sources; higher for enhancements with
 * multiple ranks taken).
 */
function valueFor(effect: DDOEffect, ctx: BuildContext, rankCount: number): number | undefined {
  const amount = effect.amount ?? [];
  // Some effects use Value1..Value4 instead of Amount.
  const fallback = effect.values?.[0];
  const amountType = effect.amountType ?? 'Simple';

  if (amountType === 'NotNeeded') return 0;

  switch (amountType) {
    case 'Simple':
      return amount[0] ?? fallback;
    case 'Stacks':
      // For Stacks, the amount table is indexed by stack count (1-based).
      // For feat sources rankCount=1 → amount[0]. Enhancements with N ranks
      // → amount[N-1].
      return amount[Math.max(0, rankCount - 1)] ?? amount[0] ?? fallback;
    case 'TotalLevel':
      return amount[Math.max(0, ctx.totalLevel - 1)];
    case 'BaseClassLevel': {
      // Effects parameterise the class either via <Item> (legacy) or
      // <StackSource> (newer enhancement-tree pattern, used when the
      // class name doubles as the stack-source key — e.g. AT's Applied
      // Force uses StackSource="Arcane Trickster" with no Item).
      // StackSource stores the display name ("Arcane Trickster"); the
      // map keys are lowercase classIds ("arcane_trickster"), so
      // normalize spaces / hyphens / apostrophes to underscores.
      const className = effect.items[0] ?? effect.stackSource ?? '';
      const key       = className.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
      const lvl = ctx.baseClassLevels.get(key) ?? 0;
      return amount[Math.max(0, lvl - 1)];
    }
    case 'ClassLevel':
    case 'ClassCasterLevel': {
      const className = effect.items[0] ?? effect.stackSource ?? '';
      const key       = className.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
      const lvl = ctx.classLevels.get(key) ?? 0;
      return amount[Math.max(0, lvl - 1)];
    }
    case 'AbilityValue':
    case 'AbilityTotal':
      return abilityByName(effect.items[0] ?? '', ctx.abilityScores);
    case 'AbilityMod': {
      const v = abilityByName(effect.items[0] ?? '', ctx.abilityScores);
      return v === undefined ? undefined : abilityModifier(v);
    }
    case 'HalfAbilityMod': {
      const v = abilityByName(effect.items[0] ?? '', ctx.abilityScores);
      return v === undefined ? undefined : Math.floor(abilityModifier(v) / 2);
    }
    case 'ThirdAbilityMod': {
      const v = abilityByName(effect.items[0] ?? '', ctx.abilityScores);
      return v === undefined ? undefined : Math.floor(abilityModifier(v) / 3);
    }
    case 'FeatCount':
      return ctx.feats.has(effect.items[0] ?? '') ? (amount[0] ?? 0) : 0;
    case 'BAB':
      return ctx.bab;
    case 'APCount': {
      const ap = ctx.apSpentInTree.get((effect.items[0] ?? '').toLowerCase()) ?? 0;
      return amount[Math.max(0, ap - 1)];
    }
    default:
      return undefined;
  }
}

/**
 * Evaluate a single Effect block against a BuildContext + a source label
 * for breakdown display. `rankCount` for enhancements with multiple ranks
 * taken (defaults to 1).
 */
export function evaluateEffect(
  effect: DDOEffect,
  ctx: BuildContext,
  source: string,
  rankCount = 1,
): EvaluatedEffect {
  const amountType = effect.amountType ?? 'Simple';
  if (!SUPPORTED_AMOUNT_TYPES.has(amountType)) {
    return { bonuses: [], skipped: 'unmodeled-amount-type', unmodeledAmountType: amountType };
  }

  // `<Rank>N</Rank>` gating: skip the effect when fewer ranks than its
  // minimum threshold are taken. Used by multi-rank enhancements where a
  // specific rider only fires at a higher rank (e.g. Storm Core's spell-
  // power piece at rank 3).
  if (effect.minRank !== undefined && rankCount < effect.minRank) {
    return { bonuses: [], skipped: 'requirements-failed' };
  }

  if (!passesRequirements(effect.requirements, ctx)) {
    return { bonuses: [], skipped: 'requirements-failed' };
  }

  const baseValue = valueFor(effect, ctx, rankCount);
  if (baseValue === undefined) {
    return { bonuses: [], skipped: 'no-amount' };
  }

  // Per-rank scaling. Three patterns:
  //  - Simple / NotNeeded: amount is a single per-rank value, multiplied by
  //    rankCount (e.g. Toughness +5 HP at rank 3 = 15).
  //  - TotalLevel: amount[charLevel-1] is the per-stack value, multiplied by
  //    rankCount. Mirrors DDOBuilderV2's `total = m_Amount[vi] * m_stacks`
  //    (Effect.cpp::TotalAmount). E.g. Past Life: Primal Sphere: Ancient
  //    Power at level 34 reads amount[33]=15 per stack × 3 stacks = 45 HP.
  //  - Stacks / AbilityMod / BAB / ClassLevel / etc.: amount already
  //    encodes the value for the current rank/stat — don't multiply.
  //
  // `<Rank>N</Rank>` overrides the per-rank multiplier: the effect is a
  // fixed rider that fires *once* when rank N is reached (e.g. Storm Core
  // grants +5 USP at rank 3 — not 5×3).
  const isPerRank = amountType === 'Simple' || amountType === 'NotNeeded' || amountType === 'TotalLevel';
  const value = isPerRank && effect.minRank === undefined
    ? baseValue * rankCount
    : baseValue;

  // Cardinality: emit one Bonus per (type, item) pair. If items is empty,
  // emit one Bonus per type with no target.
  const items = effect.items?.length ? effect.items : [''];
  const types = effect.types?.length ? effect.types : [''];

  const bonuses: Bonus[] = [];
  for (const type of types) {
    for (const item of items) {
      bonuses.push({
        bonusType: effect.bonus ?? '',
        value,
        source: effect.displayName ? `${source}: ${effect.displayName}` : source,
        target: item || undefined,
        effectType: type || undefined,
        ...(effect.isPercent && { isPercent: true }),
        ...(effect.isApplyAsItemEffect && { isItemEffect: true }),
      });
    }
  }
  return { bonuses };
}
