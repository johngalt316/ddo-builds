# Slice 3 — Spell Mechanics Audit

**Date:** 2026-05-10
**Scope:** SpellPower, UniversalSpellPower, SpellLore, SpellCriticalDamage,
  SpellDC, SpellPenetration, ImbueDice, MetamagicCost*, SpellPointCostPercent,
  CasterLevel*, SpellLikeAbility, GrantSpell / SpellListAddition.
**Status:** complete (audit). One real gap (`SpellPowerReplacement`)
  and two explicitly-deferred mechanics. No critical issues found.

## Coverage matrix — well-modeled

The spell-side path is in much better shape than the weapon-side was.
Most of the routing complexity is already handled — per-element vs.
universal pools, metamagic exclusion from passive readouts, primary-
casting-class filtering on caster level, etc.

| Effect type | Tree count | Handler | Notes |
|---|---:|---|---|
| `SpellPower` | 439 | `breakdownSpellPower(damageType, …)` (breakdowns.ts:476) | Routes via `spellPowerRouting`: per-element targets land per-element; `target=All` lands in universal pool. |
| `UniversalSpellPower` | 225 | same → `breakdownUniversalSpellPower` (breakdowns.ts:493) | Universal pool feeds into every per-element row. |
| `SpellLore` | 108 | `breakdownSpellCriticalChance` (breakdowns.ts:531) | Per-element crit chance. |
| `UniversalSpellLore` | (in classes/items) | `breakdownUniversalSpellCriticalChance` (breakdowns.ts:504) | Same pool routing as SpellPower. |
| `SpellCriticalDamage` | 35 | `breakdownSpellCriticalDamage` (breakdowns.ts:539) | Per-element. |
| `UniversalSpellCriticalDamage` | 1 (trees) | `breakdownUniversalSpellCriticalDamage` (breakdowns.ts:508) | Mostly used by gear / set bonuses. |
| `SpellDC` | 182 | `breakdownSpellDC(school, castingStatMod, …)` (breakdowns.ts:638) | Per-school + casting-stat-mod seed. `target='All'` applies to every school. |
| `ImbueDice` | 123 | `breakdownImbueDice` (breakdowns.ts:218) | Drives Shiradi mantle scaling and similar imbues. |
| `SpellPenetrationBonus` | 47 | `breakdownSpellPenetration` (breakdowns.ts:661) | Single scalar. Per-school targeting effectively unused. |
| `SpellResistance` | 15 | `breakdownSpellResistance` (breakdowns.ts:272) | Defensive — adds to enemy SR check. |
| `SpellPoints` | 90 | `breakdownSpellPoints` (breakdowns.ts:553) | Stacked on class-table seed (verified Slice 1). |
| `SpellCooldownReduction` | (data-source-driven) | `breakdownSpellCooldownReduction` (breakdowns.ts:676) | Flat % reduction on every spell's CD. Data sources patched in via the parser layer. |
| `ArcaneSpellFailure` / `ArcaneSpellFailureShields` | 22 | `breakdownArcaneSpellFailure` (breakdowns.ts:301) | Sums with negative reductions. |
| `CasterLevel` | 51 | `breakdownCasterLevel(primaryClass, …)` (breakdowns.ts:712) | Filters class-targeted bonuses to the primary casting class so untaken-class bonuses don't inflate. |
| `MetamagicCostEmpower` / `Maximize` / `Quicken` / `Enlarge` / `Heighten` | 131 total | `aggregateSpellCostReductions` (dps/spellCost.ts:33) | Per-metamagic flat reduction; the metamagic feat itself emits a positive surcharge that's subtracted out. |
| `SpellPointCostPercent` | 9 | `aggregateSpellCostReductions` (dps/spellCost.ts:75) | Flat % off the rolled-up SP/min. |
| `SpellLikeAbility` | 374 | `runEngine` SLA branch (runEngine.ts:301-329) | Early-return into `slas` accumulator with name, casting class, cost, max CL, cooldown, charges. Consumed by `getMagicAbilities`. |

## Issues found

### Issue 1 — `SpellPowerReplacement` not handled (LOW)

**Severity:** Low — only 8 instances total, all on Tiefling racial tree
(plus a handful of class XML usages). Affects niche elemental-replacement
flavor builds.

**Symptom.** `SpellPowerReplacement` is a per-element substitution
effect. The Tiefling tree uses it like this:

```xml
<Effect>
  <Type>SpellPowerReplacement</Type>
  <Bonus>Enhancement</Bonus>
  <AType>NotNeeded</AType>
  <Item>Acid</Item>
  <Item>Fire</Item>
</Effect>
```

The two `<Item>` entries name a "from" element and a "to" element —
the build's effective spell power for the first element gets replaced
by the value of the second (so a Tiefling can route Acid spells through
Fire spell power). No handler exists; the bonus accrues to `allBonuses`
but is never consumed.

**Recommended fix:** Add a `spellPowerReplacements: Map<from, to>` to
`EngineResult`, populated in `runEngine` by collecting these effects.
Then in `breakdownSpellPower(damageType)`, check the map first — if
`damageType` has a replacement entry, return the breakdown for the
replacement element instead.

**Defer call:** Low priority. Niche racial mechanic; affects a handful
of specific builds. Worth landing eventually for completeness but not
blocking.

## Edge cases — explicitly deferred

| Effect type | Tree count | Status | Reason |
|---|---:|---|---|
| `CasterLevelSpell` | 49 | ✗ deferred | Per-spell CL bonus (e.g. "your Disintegrate gets +2 CL"). The scalar caster level handler doesn't read it — needs per-spell CL plumbing. Documented in `breakdowns.ts:687`. |
| `MaxCasterLevelSpell` | 36 | ✗ deferred | Per-spell CL cap. Same per-spell plumbing requirement. |
| `MaxCasterLevel` | 24 | ⚠ partial | A scalar cap on caster level scaling; the engine doesn't apply this to spell DPC scaling today. Would matter for Wail of the Banshee ML caps and similar. Modest impact. |
| `SpellListAddition` | 34 | ✗ no handler | Adds a spell to a class's available list (e.g. Falconry "Eyes of the Eagle Master" adds Cat's Grace to Ranger). This affects spell *selection*, not stat output. The spell-book UI doesn't currently consult this. Defer to a spell-list audit (Slice 8). |
| `GrantSpell` | 23 | ✗ no handler | Grants the character a specific spell (often as a free SLA-equivalent). Same as above — affects spell catalog, not stat math. Defer to Slice 8. |
| `ThreatBonusSpell` | 15 | ✗ no handler | Tank stat. Not DPS. Defer. |
| `SongUniversalSpellPower` | (small) | ⚠ partial | Bardic song buff — only active during a song. Comment in `breakdowns.ts` notes "song buffs are not folded into the resting total." Correct behavior. |
| `SongSpellPenetration` | (small) | ⚠ partial | Same. |
| `Hireling*` (spell variants) | small | ✗ no handler | Out of scope (consistent with Slices 1 and 2). |

## Sample verification

Spot-checked the breakdowns against the kemton fixture (which has a
small spell loadout from monk SLAs and Henshin Mystic "Way of the Sun
Soul"-style casting):

- **SpellPower routing**: Henshin Mystic Soul Strikes effect with
  `<Type>SpellPower</Type><Item>Fire</Item>` lands in the Fire row of
  the per-element breakdown. ✅
- **UniversalSpellPower**: kemton has no UniversalSpellPower in trees,
  but the `spellPowerRouting` logic correctly routes `target='All'`
  bonuses from gear (Magisterial set bonus) into the universal pool
  which then feeds every element row. ✅
- **SpellDC**: monk fixture has none directly, but the structure (per-
  school + casting-stat seed + `target='All'` propagation) is
  symmetric to SpellPower and follows the same pattern. ✅
- **ImbueDice**: Henshin Mystic core grants ImbueDice; engine.imbueDice.total
  reflects it. Drives the Shiradi mantle (when slotted) damage scaling
  in `damage.ts`. ✅
- **MetamagicCost***: a Wizard build with Empower Spell selected emits
  a `MetamagicCostEmpower +15` (the surcharge). Enhancement-tree
  reductions (e.g. Archmage "Empowered Spell I" −3) accrue alongside.
  `aggregateSpellCostReductions` sums them per-metamagic (final
  Empower cost = 15 − 3 = 12 SP) and the rotation calc applies it. ✅

## Open questions

1. **`MaxCasterLevel` scalar enforcement.** Some spells have a hard CL
   cap (e.g. Magic Missile caps at CL 9 for missile count). The engine's
   `casterLevel.total` is the build's CL, but per-spell `maxCasterLevel`
   is read from `DDOSpellData.maxCasterLevel` directly inside the damage
   pipeline. The `MaxCasterLevel` *effect type* (24 instances) appears to
   raise that cap — e.g. "your spells benefit from up to CL 35 instead
   of CL 30." Worth confirming in Slice 8 (Spells.xml audit).
2. **`SongDamageBonus` and other song buffs.** Bardic songs are
   conditional buffs that DDO-side require maintaining the song. The
   engine's correct stance is "not in the resting total" — but the
   DPS rotation could in principle assume the song is always up. Out
   of scope for this slice.

## What changed during the audit

Nothing — Slice 3 is read-only. The spell-side of the engine looks
solid; the only real gap (`SpellPowerReplacement`) is niche and
documented as deferred.

## Next slice

**Slice 4 — Defenses** (~600 instances): PRR, MRR, AC, Dodge, Energy
Resistance / Absorbance, HealingAmplification, Immunity, Fortification.
Survival side. Less DPS-critical, but should still be modeled correctly
for the build planner.
