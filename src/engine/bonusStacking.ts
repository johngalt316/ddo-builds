// Bonus stacking algorithm — the core of the Phase 2 engine.
//
// Inputs: a flat list of typed Bonus values + a stacking rules table from
// BonusTypes.xml. Output: a final total + every contributor annotated with
// whether it actually applied or got dominated by a same-type bonus.
//
// DDO stacking rules in plain English:
//   - Bonuses share a type ("Insight", "Enhancement", etc.) — those compete.
//   - "Highest Only" types: only the largest *positive* same-type bonus
//     applies. All penalties (negative values) of any type stack — they
//     don't compete with positive bonuses.
//   - "Always" types ("Stacking", "Destiny", etc.): every bonus sums.
//   - Untyped or unknown bonus types: treat as Always (untyped fully stacks).
//
// Intentionally NOT implemented yet:
//   - "Stacking " (with trailing space — separate in BonusTypes.xml)
//     handled the same way as "Always".
//   - Multi-rule edge cases (some bonus types have special interactions).
//   - We rely on bonusType strings being canonical; future Phase 2.x can
//     add normalization (case + whitespace).

import type { DDOBonusType } from '@/types/ddoData';

export interface Bonus {
  /** Stacking category from BonusTypes.xml (e.g. "Insight", "Enhancement", "Stacking", "Feat"). */
  bonusType: string;
  /** Numeric contribution. Negative values are penalties — they always apply. */
  value: number;
  /** Human-readable origin shown in the breakdown ("Toughness feat", "Mountain Stance", "kemton's gloves"). */
  source: string;
  /** Optional sub-target detail ("Strength", "Jump", weapon name). Used when grouping. */
  target?: string;
  /** EffectType this bonus contributes to ("AbilityBonus", "MeleePower", …). Set by the evaluator; breakdowns filter on it. */
  effectType?: string;
  /**
   * `<Percent/>` flag — `value` is a percentage of the running breakdown
   * total instead of a flat amount. `stackBonuses` applies all flat bonuses
   * first, then layers percentages on top of the flat subtotal.
   */
  isPercent?: boolean;
  /**
   * Set when the source is gear-like (item buff, augment, set bonus,
   * filigree, or an effect tagged `<ApplyAsItemEffect/>`). DDOBuilderV2
   * only applies Highest-Only stacking to these; non-item effects (most
   * feats, enhancements, destinies, reaper) stack freely regardless of
   * bonusType. Mirrors the `m_effects` vs `m_itemEffects` split.
   */
  isItemEffect?: boolean;
}

export interface AppliedBonus extends Bonus {
  /** True if this bonus contributes to the total; false if dominated by a same-type larger bonus. */
  applied: boolean;
  /** When `applied=false`, the source name of whatever dominated it. */
  dominatedBy?: string;
}

export interface BreakdownResult {
  total: number;
  contributors: AppliedBonus[];
}

/** lowercased bonusType → 'highest' | 'always'. Missing entries default to 'always'. */
export type StackingRules = ReadonlyMap<string, 'highest' | 'always'>;

/** Build a fast lookup table from the parsed BonusTypes.xml data. */
export function buildStackingRules(bonusTypes: DDOBonusType[]): StackingRules {
  const rules = new Map<string, 'highest' | 'always'>();
  for (const t of bonusTypes) {
    const key = t.name.trim().toLowerCase();
    rules.set(key, t.stacking === 'Highest Only' ? 'highest' : 'always');
  }
  return rules;
}

export function stackBonuses(bonuses: Bonus[], rules: StackingRules): BreakdownResult {
  // Two passes: flat bonuses first, percentage bonuses (`isPercent`) layer
  // on top of the flat subtotal. Percent bonuses still go through the
  // normal grouped stacking — same-bonusType percents compete just like flats.
  const flat = bonuses.filter(b => !b.isPercent);
  const pct  = bonuses.filter(b => b.isPercent);

  const stackGroup = (
    list: Bonus[],
    apply: (val: number) => number,
  ): { contributors: AppliedBonus[]; total: number } => {
    const groups = new Map<string, Bonus[]>();
    for (const b of list) {
      const key = (b.bonusType || '').trim().toLowerCase();
      const arr = groups.get(key);
      if (arr) arr.push(b);
      else groups.set(key, [b]);
    }

    const contributors: AppliedBonus[] = [];
    let total = 0;

    for (const [key, group] of groups) {
      const declaredMode = key === '' ? 'always' : (rules.get(key) ?? 'always');

      // DDOBuilderV2 only enforces Highest-Only competition between gear/item
      // effects (m_itemEffects). Non-item effects in the same group all stack.
      // Split the group: item effects compete with each other, non-item all
      // apply.
      const itemEffects = group.filter(b => b.isItemEffect);
      const nonItem    = group.filter(b => !b.isItemEffect);

      // Non-item effects always apply.
      for (const b of nonItem) {
        contributors.push({ ...b, applied: true });
        total += apply(b.value);
      }

      // Item effects: respect declared mode.
      if (declaredMode === 'always' || itemEffects.length === 0) {
        for (const b of itemEffects) {
          contributors.push({ ...b, applied: true });
          total += apply(b.value);
        }
        continue;
      }

      const positives = itemEffects.filter(b => b.value > 0);
      const negatives = itemEffects.filter(b => b.value < 0);
      const zeros     = itemEffects.filter(b => b.value === 0);

      let winner: Bonus | undefined;
      for (const p of positives) {
        if (!winner || p.value > winner.value) winner = p;
      }
      for (const p of positives) {
        if (p === winner) {
          contributors.push({ ...p, applied: true });
          total += apply(p.value);
        } else {
          contributors.push({ ...p, applied: false, dominatedBy: winner?.source });
        }
      }
      for (const n of negatives) {
        contributors.push({ ...n, applied: true });
        total += apply(n.value);
      }
      for (const z of zeros) {
        contributors.push({ ...z, applied: false });
      }
    }
    return { contributors, total };
  };

  const flatResult = stackGroup(flat, v => v);
  // Percent bonuses are computed against the flat subtotal (Math.round to
  // match DDO's integer HP display).
  const flatSubtotal = flatResult.total;
  const pctResult = stackGroup(pct, v => Math.round(flatSubtotal * v / 100));

  return {
    total: flatResult.total + pctResult.total,
    contributors: [...flatResult.contributors, ...pctResult.contributors],
  };
}

/**
 * Stack bonuses scoped to a specific (target). For stats with multiple
 * sub-targets like AbilityBonus[STR vs DEX] or SkillBonus[Jump vs Tumble],
 * different targets don't compete. Caller filters by target first.
 */
export function stackBonusesByTarget(
  bonuses: Bonus[],
  rules: StackingRules,
): Map<string, BreakdownResult> {
  const byTarget = new Map<string, Bonus[]>();
  for (const b of bonuses) {
    const key = b.target ?? '';
    const arr = byTarget.get(key);
    if (arr) arr.push(b);
    else byTarget.set(key, [b]);
  }

  const out = new Map<string, BreakdownResult>();
  for (const [target, list] of byTarget) {
    out.set(target, stackBonuses(list, rules));
  }
  return out;
}
