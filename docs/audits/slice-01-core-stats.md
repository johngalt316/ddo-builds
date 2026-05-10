# Slice 1 — Core Stats Audit

**Date:** 2026-05-09
**Scope:** AbilityBonus, SaveBonus, Hitpoints, SpellPoints, SkillBonus + edge cases
**Status:** complete

## How the engine processes effects

Three layers, all in `src/engine/`:

1. **`collectEffects.ts`** walks the build (feats, enhancements, items, set bonuses, …)
   and produces `{effect, source, rankCount}` tuples.
2. **`evaluateEffect.ts`** is **type-agnostic** — it validates the `<AmountType>`,
   computes the numeric value (per-rank scaling, ability-mod resolution, etc.),
   and packages each effect into `Bonus` objects with the XML `<Type>` carried
   on `effectType`. It does **not** switch on effect type.
3. **`breakdowns.ts`** is where type-specific consumption happens — each
   `breakdown*` function filters bonuses by `effectType` and stacks them.

So the audit question for any effect type is: **is there a `breakdown*`
function that consumes it, and does that function correctly handle stacking,
target filtering, and edge cases?**

## Coverage matrix

| Effect type | Instances | Handler | Status | Notes |
|---|---:|---|---|---|
| `AbilityBonus` | 730 | `breakdownAbilityScore` (breakdowns.ts:94) | ✅ | Filters by `target === <ability>` or `target === 'All'`; both stack via the normal rules |
| `SaveBonus` | 233 | `breakdownSave` (breakdowns.ts:70) | ✅ | Filters by `target === <save>`, `target === 'All'`, or no target |
| `Hitpoints` | 233 | `breakdownHitPoints` (breakdowns.ts:57) | ✅ | Bucketed with `HitpointsStyleBonus` + `FalseLife` (DDOBuilderV2 parity) |
| `SpellPoints` | 90 | `breakdownSpellPoints` (breakdowns.ts:527) | ✅ | Stacked on top of class-table seed computed in `runEngine` |
| `SkillBonus` | 232 | `breakdownSkill` (breakdowns.ts:552) | ✅ | Filters by skill name or `'All'` |
| `SkillBonusAbility` | 0 (trees) | `breakdownSkill` (same) | ✅ | Per-ability skill bonus (used by item buffs / set bonuses, not trees) |

## Edge cases

| Effect type | Instances | Status | Notes |
|---|---:|---|---|
| `HitpointsReaper` | 3 | ⚠ intentional | Excluded from `HP_TYPES` — only applies in Reaper difficulty, requires reaper-stance gating which isn't modeled. Documented in `breakdowns.ts:51-55`. |
| `Hireling*` (8 variants) | 15 | ✗ unmodeled | Hirelings out of scope. Currently fall through `evaluateEffect` and produce bonuses with `effectType === 'HirelingHitpoints'` etc., but no `breakdown*` consumes them. **Confirmed silent drop** — bonus exists in `engine.allBonuses` but never affects anything. Low priority; correct behavior given hirelings aren't modeled. |
| `SaveNoFailOn1` | 9 | ✗ unmodeled | Binary capability ("save can't fail on a natural 1"), not a stat bonus. No handler. Affects gameplay but not engine numbers — only matters when we model probabilistic saves. Defer. |
| `Skill` (singular) | 2 | ✗ **REAL GAP** | This is a **requirement type**, not an effect type. Used in Bard Warchanter to gate enhancements on Perform ranks (e.g. "requires Perform 4"). `evaluateEffect.ts::passesRequirement` (lines 94-134) has no `'Skill'` case, so it falls through to `default: return true` — gates are silently bypassed. See [Issue 1](#issue-1) below. |

## Issues found

### Issue 1: `<Type>Skill</Type>` requirement type silently passes — **FIXED 2026-05-10**

**Location:** `src/engine/evaluateEffect.ts:91-135`
**Trees affected:** `Bard_Warchanter.tree.xml` (2 enhancements)
**Severity:** Low — only 2 references, only Bard, and a build that lacks Perform ranks would still meet the prerequisite check on the Bard side anyway because Bards train Perform automatically. But it's a correctness gap.

**Resolution:** Added `case 'Skill':` to `passesRequirement` and plumbed
`skillRanks` into `BuildContext`. New unit tests in
`tests/engine/skillRequirement.test.ts` cover threshold pass/fail,
untrained skills, 0-rank explicit, and display-name normalization.
Engine snapshots updated: kemton/zentek/maetrim each gain +2
`requirementsFailedCount` and lose −2 `totalAppliedBonuses` — the two
silent passes that previously slipped through, now correctly gated.

The `passesRequirement` switch handles `Class`, `BaseClass`, `ClassMinLevel`,
`BaseClassMinLevel`, `TotalLevel`, `Race`, `Feat`, `Stance`, `Ability` — but
not `Skill`. The default branch `return true` means a Bard Warchanter
enhancement that requires Perform 4 / Perform 8 will appear available even
on a build with 0 ranks in Perform.

**Recommended fix:** Add a `case 'Skill':` that looks up the rank count from
`build.skillRanks`. Requires plumbing `skillRanks` into `BuildContext`
(currently only ability scores, levels, feats, race, BAB, AP, stances).

**Affected enhancements:**
- `BardWarchanterCore3` (?) — needs ID confirmation; the two hits are inside `<Requirements>` blocks under enhancement items in `Bard_Warchanter.tree.xml`. Both gate on Perform ≥ 4 and ≥ 8 respectively.

### Issue 2: Hireling-prefixed bonuses linger in `allBonuses` (cosmetic)

**Location:** Engine pipeline, no specific file
**Severity:** Cosmetic / hygiene

15 effect instances (across 8 `Hireling*` types) flow through `evaluateEffect`
into `allBonuses` and never get consumed by any breakdown. They aren't
*wrong* — they correctly aren't double-counted on the player — but they
add noise to debug dumps.

**Recommended fix:** Either (a) drop them at parse time with a comment, or
(b) add a `Hireling*` filter at evaluation that skips them with a "not
modeled" tag (already a defined skip reason for unmodeled amount types;
extend to unmodeled effect types).

## Sample verification

Walked one enhancement of each kind through the pipeline by hand:

- **AbilityBonus**: `BarbarianFrenziedBerserkerCore1` → +1 STR (Profane bonus)
  - Effect emitted with `effectType=AbilityBonus, target=Strength, bonus=Profane, value=1`
  - Caught by `breakdownAbilityScore('STR', …)` because `target === 'Strength'`
  - Stacks correctly with item Profane bonuses (same bonus type, takes max)
- **SaveBonus**: `MonkBasicVowOfSilence` (saves +X) — caught by `breakdownSave` for each save type. ✅
- **Hitpoints**: `WarforgedReinforcedShell` → +HP at rank N. Per-rank scaling via `Stacks` amount type, lands in HP breakdown. ✅
- **SpellPoints**: `WizardArchmageCore3` → +SP. Lands in SP breakdown on top of class-table seed. ✅
- **SkillBonus**: `RogueAcrobaticBoost` → +Tumble. Filters into `breakdownSkill('Tumble', …)` correctly. ✅

## Open questions

1. **`SkillBonusAbility`**: 0 instances in trees. Used elsewhere (item buffs?
   set bonuses?). Should sweep `public/data/ItemBuffs.xml`,
   `SetBonuses.xml`, etc. in **Slice 7** (item/set/filigree).
2. **HP seed correctness**: The breakdown stacks on a seed computed in
   `runEngine`. Slice 1 didn't re-verify the seed itself (class HD + CON ×
   levels + Toughness heuristic). That's worth a separate spot-check —
   already covered by the kemton fixture which matches DDOBuilderV2 within
   ±2 HP.
3. **AbilityBonus targeting `'All'`**: confirmed via Master of Trickery /
   Completionist set bonuses. No discrepancies in trees, but the rule is
   important to keep in mind for slice 7 (set bonuses).

## Next slice

**Slice 2 — Weapon mechanics** (~700 instances): `Weapon_Attack`,
`Weapon_AttackAndDamage`, `Weapon_Damage`, `Weapon_CriticalRange`,
`Weapon_CriticalMultiplier`, `Weapon_Alacrity`, `Weapon_BaseDamage`,
`Weapon_DamageAbility`, `Weapon_FlatDamage`, `Weapon_DamagePct`,
`MeleePower`, `RangedPower`, `Doublestrike`, `Doubleshot`,
`OffhandAttackChance`. This is the melee DPS engine's surface area.
