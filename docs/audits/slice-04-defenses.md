# Slice 4 — Defenses Audit

**Date:** 2026-05-10
**Scope:** PRR, MRR, ACBonus, DodgeBonus, HealingAmp, EnergyResistance,
  EnergyAbsorbance, Immunity, Fortification, DodgeCapBonus, MRRCap,
  Displacement, HelplessDamage, FortificationBypass, DodgeBypass.
**Status:** complete (audit). One small fix recommended (ArmorACBonus
  inclusion). Several stats have no handler — most are
  build-planner-relevant rather than DPS-relevant, deferred.

## Coverage matrix — well-modeled

| Effect type | Tree count | Total instances | Handler | Notes |
|---|---:|---:|---|---|
| `PRR` | 174 | (high) | `breakdownPRR` (breakdowns.ts:264) | Single scalar; flat sums via stacking rules |
| `MRR` | 150 | (high) | `breakdownMRR` (breakdowns.ts:268) | Same pattern |
| `ACBonus` | 97 | (high) | `breakdownAC` (breakdowns.ts:251) | Filters `ACBonus` ∪ `ACBonusShield` ∪ `ACBonusTowerShield` |
| `ACBonusShield` | 10 | — | `breakdownAC` | Shield AC stacks with armor — same filter |
| `DodgeBonus` | 76 | — | `breakdownDodge` (breakdowns.ts:260) | Single scalar |
| `HealingAmplification` | 90 | (high) | `breakdownHealingAmp` (breakdowns.ts:237) | Positive-energy heals |
| `NegativeHealingAmplification` | 42 | — | `breakdownNegativeHealingAmp` (breakdowns.ts:241) | Undead self-heal scaling |
| `RepairAmplification` | (gear-side) | 38 | `breakdownRepairAmp` (breakdowns.ts:245) | Construct repair |
| `SpellResistance` | 15 | — | `breakdownSpellResistance` (breakdowns.ts:272) | Defensive vs spells |
| `ArcaneSpellFailure` / `ArcaneSpellFailureShields` | 22 | — | `breakdownArcaneSpellFailure` (breakdowns.ts:301) | Already covered in Slice 3 (caster-relevant) |

## Issues found

### Issue 1 — `ArmorACBonus` not folded into `breakdownAC` (LOW) — **FIXED 2026-05-10**

**Severity:** Low (5 instances total) — but a real correctness gap.

**Symptom.** `breakdownAC` (breakdowns.ts:251) filters
`ACBonus | ACBonusShield | ACBonusTowerShield` but not `ArmorACBonus`.
The 5 instances appear in armor-specific class enhancements (e.g.
heavy-armor specialization that adds AC only when wearing the right
armor type). They emit the bonus but it's silently dropped.

**Recommended fix.** Add `'ArmorACBonus'` to the filter:
```ts
const AC_TYPES = ['ACBonus', 'ACBonusShield', 'ACBonusTowerShield', 'ArmorACBonus'];
```
~3-line change, no infrastructure needed. Defer the armor-conditional
gating to a later slice if needed (the bonus on its own already has
armor requirements via `<Requirements>` at the effect level).

**Resolution:** Implemented. `breakdownAC` now uses an `AC_TYPES` constant
and the `ofTypes` helper. No fixture snapshot changes needed (none of
kemton/zentek/maetrim/yings use ArmorACBonus directly).

## Real gaps (not modeled at all)

These effect types accrue to `engine.allBonuses` but no `breakdown*`
function reads them, and `EngineResult` has no field for them. From a
**DPS** perspective most are irrelevant — they're survival /
status-protection stats. From a **build planner** perspective they're
real omissions that the Breakdowns tab can't surface.

| Effect type | Total instances | Why it matters | DPS impact |
|---|---:|---|---|
| `EnergyResistance` | 119 | Per-element flat resistance to incoming damage | None |
| `EnergyAbsorbance` | 110 | Per-element % damage absorbed | None |
| `Immunity` | 131 | Binary status protections (Disease, Poison, Sleep, Fear, etc.) | None |
| `Fortification` | 57 | % anti-crit (1.00 = full immunity to crits) | None — affects taken damage, not dealt |
| `DodgeCapBonus` | 49 | Raises the dodge cap (default ~25%, gear can push higher) | None directly; would matter if engine enforced the cap |
| `MRRCap` | 57 | Raises the MRR cap (matters for Evasion-style scaling) | None |
| `Displacement` | 21 | % miss chance (concealment) for incoming attacks | None |
| `HelplessDamage` | 43 | Bonus damage WHEN ATTACKING helpless enemies | DPS-relevant but requires enemy-state modeling |
| `HelplessDamageReduction` | 7 | Damage reduction WHEN PLAYER IS HELPLESS | None |
| `FortificationBypass` | 46 | Offensive — bypasses enemy fort on crit | DPS-relevant when enemy fort modeled |
| `DodgeBypass` | 13 | Offensive — bypasses enemy dodge | DPS-relevant when enemy dodge modeled |
| `Hireling*` (defensive variants) | small | Out of scope (consistent with Slices 1-3) | None |

**Recommendation:** add `EngineResult` fields for the most-asked
defensive stats (Fortification, EnergyResistance per-element,
EnergyAbsorbance per-element, DodgeCapBonus, MRRCap) when the
Breakdowns UI needs them. Until then the data is correctly captured in
`allBonuses` for ad-hoc consumers but not surfaced as a topline.

`HelplessDamage`, `FortificationBypass`, and `DodgeBypass` are
offensive but require enemy-state modeling (helpless, has Fort, has
Dodge) that Slice 0's UI placeholders explicitly don't have yet.
Defer to a future "enemy modeling" milestone.

## Edge cases — out of scope or expected

| Effect type | Total | Status | Reason |
|---|---:|---|---|
| `Concealment` | 0 in trees, gear-side | ✗ no handler | Same shape as Displacement; defer with it |
| `LesserDisplacement` | 1 | ✗ no handler | Variant, defer with parent |
| `Web Immunity`, `Petrification Immunity`, `BlindnessImmunity`, etc. | small | ✗ no handler | Per-status binary protections; if Immunity is modeled these would be variants |
| `Construct Fortification (10%)` | 1 | ⚠ data quirk | Looks like a literal value baked into the type name. One-off; may be a parser anomaly worth investigating later. |
| `SongRepairAmp` | 1 | ⚠ song buff | Bardic song; correct exclusion — not in resting total |

## Sample verification

- **Kemton's monk Iron Skin (PRR/MRR feat path):** PRR/MRR breakdowns
  read flat sums. ✅
- **AC stack on armored fighter:** `ACBonus` from feats + `ACBonusShield`
  from shield + dexterity mod (seed) all stack via the rules. ✅
- **Healing amp from Aasimar racial Sun Soul:** flows into `healingAmp`
  total. ✅
- **Energy resistance from Sun Soul / Cleric Cocoon:** emits
  `EnergyResistance` bonuses; lands in `allBonuses` but no breakdown.
  ⚠ This is correct (no handler exists) but means the build planner
  can't display elemental resists.

## Recommended next actions

1. Apply Issue 1 fix (`ArmorACBonus` to `breakdownAC`) inline — small
   and uncontroversial.
2. Defer all "real gap" defensive stats until a build planner stat-page
   wants them. The DPS engine doesn't need them.
3. Move on to **Slice 5 — Combat tactics** (~300 instances of
   TacticalDC, ThreatBonus, SneakAttackDice, BAB, etc.).

## What changed during the audit

Slice 4 is read-only pending Issue 1's tiny fix. No code changes from
the audit itself.
