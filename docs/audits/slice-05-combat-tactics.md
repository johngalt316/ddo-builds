# Slice 5 — Combat Tactics Audit

**Date:** 2026-05-10
**Scope:** TacticalDC, ThreatBonus*, SneakAttack*, BAB, OverrideBAB, ImprovedCritical detection.
**Status:** complete (audit + 1 inline fix). Several gaps surfaced; most
  defer until enemy-state or to-hit modeling lands.

## Coverage matrix

| Effect type | Total instances | Handler | Status |
|---|---:|---|---|
| `SneakAttackDice` | 113 | `breakdownSneakAttackDice` (breakdowns.ts:134) | ✅ — drives both melee/ranged sneak and Magical Ambush proc |
| `BAB` (effect type) | 1 | — | ⚠ — see "edge cases" |
| ImprovedCritical (feat detection) | — | `detectImprovedCritical` (meleeCalc.ts:172) | ✅ — heroic feat that doubles weapon's threat range; engine reads it from `build.feats` |

## Issues found

### Issue 1 — `<Type>BAB</Type>` requirement type silently passes (LOW) — **FIXED 2026-05-10**

**Location:** `src/engine/evaluateEffect.ts::passesRequirement`
**Severity:** Low — most BAB-gated requirements (e.g. require BAB ≥ 4 for
Druid wolf form) sit at heroic breakpoints that any build at relevant
character levels easily clears. But the gap is structurally identical
to Slice 1's `Skill` finding.

**Symptom.** ~50 instances across class XMLs and feats use
`<Type>BAB</Type>` as a *requirement* type ("BAB ≥ 4 to take wolf
form", "BAB ≥ 8 to take Whirlwind Attack" analog, etc.). The
`passesRequirement` switch had no case; the default branch returned
true → gates always passed.

**Resolution:** Added `case 'BAB':` matching Slice 1's `case 'Skill':`
pattern. Reads the build's seed BAB from `BuildContext.bab` (already
present). New unit tests in `tests/engine/skillRequirement.test.ts`
(BAB describe block) cover threshold pass/fail and the zero-threshold
edge case. No fixture snapshot impact — the existing builds all clear
their BAB-gated requirements anyway.

### Issue 2 — `TacticalDC` not modeled (MEDIUM, deferred)

**Severity:** Medium for build-planner stat coverage; not
DPS-relevant.

**Symptom.** 104 enhancement-tree instances of `<Type>TacticalDC</Type>`
across martial trees (Kensei, Stalwart, Henshin Mystic, etc.). Each
emits a per-tactic-targeted bonus via `<Item>` entries, e.g.:

```xml
<Effect>
  <Type>TacticalDC</Type>
  <Bonus>Enhancement</Bonus>
  <Item>Trip</Item>
  <Item>Sunder</Item>
  <Item>Stun</Item>
  <Item>General</Item>
</Effect>
```

The `<Item>General</Item>` target applies to every tactical DC
universally, similar to how `<Item>All</Item>` works for SpellDC. No
breakdown reads this — bonuses accrue to `allBonuses` but no
`EngineResult` field surfaces them.

**Why deferred:** Tactical DCs gate crowd-control hits (Stunning Blow,
Trip, Sunder, Sap). DPS isn't directly affected — the rotation calc
doesn't model "did the stun land?" yet. This is build-planner stat
coverage that would matter for melee CC builds.

**Recommended later:** Add a per-tactic `TacticalDC` breakdown (Trip /
Sunder / Stun / Assassinate / Quivering Palm) plus an aggregate. Same
shape as `breakdownSpellDC` with per-school targeting + 'All' → 'General'.

### Issue 3 — `OverrideBAB` not modeled (LOW, deferred)

**Severity:** Low — flag effect (Amount=1, AType=Simple) used by Bard
Warchanter, Vile Chemist Alchemist, etc. to grant full-BAB progression
(1.0 ratio) instead of the class default (0.75 for those classes).

**Symptom.** 11 instances total. The engine's `calculateBAB` works
from class progression tables; this effect would need to override that
ratio for the affected class. No handler exists.

**Why deferred:** BAB feeds into to-hit calculations, and the DPS
engine assumes 100% hit rate against unknown AC anyway. Until AC
modeling lands, OverrideBAB only matters for the Build Editor's BAB
display — not DPS numbers.

### Issue 4 — Per-direction Sneak Attack stats not gated (LOW, partial)

**Severity:** Low — sneak attacks already work (the dice are read), but
positional gating isn't modeled.

**Symptom.**
- `SneakAttackRange` (33 trees) — extends sneak-attack range / lateral
  arc
- `SneakAttackAttack` (29 trees) — to-hit while sneaking
- `SneakAttackDamage` (3 trees) — flat sneak damage rider
- `RangedSneakAttackRange` (5 trees) — ranged-specific arc

The DPS calculator currently treats all sneak attacks as "always-on
when you have sneak dice" which matches assassin/rogue archetype DPS
in optimal positioning. No need to model position for the long-run
average.

**Why deferred:** Positional sneak modeling would require a "behind
target / flanking / target distracted" probability input. Most builds
just assume optimal positioning. Not blocking.

## Deferred — out of DPS scope

| Effect type | Total | Reason |
|---|---:|---|
| `ThreatBonusMelee` | 42 | Tank stat — increases enemy aggro. Not DPS. |
| `ThreatBonusRanged` | 9 | Same. |
| `ThreatBonusSpell` | 20 | Same (caster aggro). |
| `Hireling*` | small | Out of scope (Slices 1-3 precedent). |

## Sample verification

- **Kemton's monk SneakAttackDice:** monk has limited sneak (only via
  multiclass dip), but the breakdown structure is the same. Engine's
  `sneakAttackDice.total` correctly reflects available dice. ✅
- **Kemton's BAB (~15 at level 20 monk):** seed comes from class table;
  no enhancements add to BAB directly. ✅
- **Kemton's ImprovedCritical (handwraps):** detected via feat, applied
  in meleeDPS via `hasIC` flag, doubles threat range. ✅

## What changed during the audit

- `src/engine/evaluateEffect.ts::passesRequirement` — added `case 'BAB':`
- `tests/engine/skillRequirement.test.ts` — added `passesRequirements
  — <Type>BAB</Type>` describe block (3 new tests)

## Next slice

**Slice 6 — Granted abilities** (~600 instances of `SpellLikeAbility`,
`GrantFeat`, `ToggleableStance`, plus the `Stance` infrastructure
underlying all of Slice 7).
