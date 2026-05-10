# Slice 2 — Weapon Mechanics Audit

**Date:** 2026-05-10
**Scope:** Weapon_*, MeleePower, RangedPower, Doublestrike, Doubleshot,
  OffHandAttackBonus, SneakAttack*, ThreatBonus*, HelplessDamage*, and the
  class-restricted `Weapon*Class` family.
**Status:** complete (audit) — three real gaps surfaced, recommended fixes
  listed but not yet applied.

## Coverage matrix — well-modeled

These effect types have a dedicated `breakdown*` consumer and pass
verification through the kemton fixture.

| Effect type | Tree count | Handler | Notes |
|---|---:|---|---|
| `Weapon_Damage` (flat) | 153 | `breakdownWeaponFlatDamage` (breakdowns.ts:172) | Filters `!isPercent` so only flat lines apply here |
| `Weapon_Damage` (percent) | (subset) | `breakdownWeaponDamagePct` (breakdowns.ts:189) | Filters `isPercent`, strips the flag, stacks raw values; `meleeCalc` applies as `× (1 + pct/100)` |
| `Weapon_BaseDamage` | 25 | `breakdownWeaponBaseDamage` (breakdowns.ts:163) | Adds [W] dice (Legendary Dreadnought Dread Mantle, Henshin Ki Focus) |
| `Weapon_CriticalRange` | 60 | `breakdownWeaponCritRange` (breakdowns.ts:141) + `critRangeBonusForWeapon` (meleeCalc.ts:341) | Per-weapon-type filtering applied at meleeDPS time |
| `Weapon_CriticalMultiplier` | 33 | `breakdownWeaponCritMult` (breakdowns.ts:146) | Crit mult on every crit |
| `Weapon_CriticalMultiplier19To20` | 14 | `breakdownWeaponCritMult1920` (breakdowns.ts:151) | Extra crit mult only on 19/20 rolls |
| `Weapon_AttackAndDamageCritical` | 17 | `breakdownSeeker` (breakdowns.ts:155) | Seeker — flat add to damage on crit |
| `Weapon_DamageAbility` | 18 | `buildStatsFromEngine` inline (meleeCalc.ts:358-365) | Replaces the weapon's own damage stat with a different ability if higher; matches kemton (WIS over STR) |
| `MeleePower` | 139 | `breakdownMeleePower` (breakdowns.ts:208) | ✅ |
| `RangedPower` | 91 | `breakdownRangedPower` (breakdowns.ts:212) | ✅ |
| `Doublestrike` | 78 | `breakdownDoublestrike` (breakdowns.ts:112) | ✅ |
| `Doubleshot` | 69 | `breakdownDoubleshot` (breakdowns.ts:116) | ✅ |
| `OffHandAttackBonus` | 18 | `breakdownOffHandChance` (breakdowns.ts:135) | Stacks on top of TWF feat base |
| `SneakAttackDice` | 84 | `breakdownSneakAttackDice` (breakdowns.ts:126) | Drives both sneak attacks and Magical Ambush proc |

## Issues found

### Issue 1 — `Weapon_Alacrity` / `WeaponAlacrityClass` silently dropped (HIGH) — **FIXED 2026-05-10**

**Severity:** High — directly affects DPS numbers for any build with monk
Henshin Mystic, Fighter Kensei, Ranger Tempest, Bard Swashbuckler, etc.
Also affects monk class XML and several augments.

**Symptom.** XML uses two effect types for attack speed from non-gear
sources:
- `Weapon_Alacrity` — 21 trees + 5 class XMLs + 1 augment = **27 instances**
- `WeaponAlacrityClass` — 3 trees + 4 class XMLs + 9 augments = **16 instances**

But `breakdownMeleeSpeed` (breakdowns.ts:262) and `breakdownRangedSpeed`
(breakdowns.ts:266) only filter on `MeleeAlacrity` / `RangedAlacrity`
respectively. Neither consumes either `Weapon_*` variant.

`MeleeAlacrity` / `RangedAlacrity` ARE used by `ItemBuffs.xml` and the
`items/by-slot/*.json` catalog, so gear-sourced alacrity is correctly
modeled. The gap is specifically the enhancement / class-feature /
augment path.

**Concrete impact.** Henshin Mystic Porous Soul rank 3 grants
`<Type>Weapon_Alacrity><Amount size="3">5 10 15</Amount>` — the engine
silently drops this entire +15% attack-speed contribution. Same for the
analogous Kensei, Tempest, Vile Chemist, Druid Nature's Warrior, etc.
nodes.

**Recommended fix.** Two paths:
1. **Smaller change:** extend the breakdown filters to recognize the
   `Weapon_*` aliases:
   ```ts
   const MELEE_ALACRITY_TYPES   = ['MeleeAlacrity', 'Weapon_Alacrity'];
   const RANGED_ALACRITY_TYPES  = ['RangedAlacrity', 'Weapon_Alacrity'];
   ```
   Note `Weapon_Alacrity` would feed BOTH filters — DDOBuilderV2 treats
   the type as "weapon attack speed regardless of melee/ranged," so this
   is correct. (Verified by reading sample data: Henshin Mystic uses it
   on melee handwraps; Tempest uses it on ranged builds.)
2. **`*Class` variants:** these only fire when wielding a weapon on the
   class's "favored weapons" list (Kensei builds the list via
   `AddGroupWeapon`). Same machinery as Issue 3 below — defer.

**Resolution:** Path 1 implemented. `breakdownMeleeSpeed` now reads both
`MeleeAlacrity` and `Weapon_Alacrity`; `breakdownRangedSpeed` does the
same with `RangedAlacrity`. New `ofTypes` helper in `breakdowns.ts`.
`WeaponAlacrityClass` now flows through Path 2 (Issue 3 resolution
below) — the weapon-group filter handles class-restricted alacrity
correctly. Engine snapshots updated: kemton's `meleeSpeed.total`
went `0 → 30` (Henshin Mystic Porous Soul rank 3 + other monk
alacrity), zentek's went `0 → -20` (a slow effect now visible),
maetrim's `0 → 20`, yings' `0 → 35`. The DPS panel still clamps
visible alacrity at 15% via `effectiveAlacrity`, so the user-facing
cap is preserved.

### Issue 2 — `Weapon_AttackAndDamage` damage half silently dropped (MEDIUM) — **FIXED 2026-05-10**

**Severity:** Medium — affects most martial builds by 3–8 flat damage per
hit cumulatively from feats / enhancements like Weapon Specialization
analogs.

**Symptom.** `Weapon_AttackAndDamage` (147 instances across trees) is a
combined "+N to attack and damage" effect. DDOBuilderV2 treats it as
both `Weapon_Attack` and `Weapon_Damage` simultaneously.

Our engine has no handler for `Weapon_AttackAndDamage` at all — neither
the attack half (which doesn't matter yet, since the DPS calc assumes
100% hit rate against unknown AC) nor the damage half. The damage half
should feed into `breakdownWeaponFlatDamage`.

**Concrete impact.** Greater Weapon Focus, Kensei +X to Hit and Damage
nodes, and similar enhancements appear to add nothing to the per-hit
damage chain.

**Recommended fix.** Extend `breakdownWeaponFlatDamage` to also pick up
non-percent `Weapon_AttackAndDamage` bonuses:
```ts
const WEAPON_FLAT_DAMAGE_TYPES = ['Weapon_Damage', 'Weapon_AttackAndDamage'];
```

**Resolution:** Implemented. The attack half remains unmodeled (no AC
yet) but the damage half now correctly contributes to per-hit flat
damage.

### Issue 3 — Class-restricted `Weapon*Class` variants not modeled (MEDIUM-LARGE) — **PARTIALLY FIXED 2026-05-10**

**Severity:** Medium-large in scope (~144 instances), but moderate impact
in practice — these are class-specialty weapon bonuses that only fire
when the equipped weapon is in the class's "favored" list (Kensei +
short sword, Tempest + scimitar / kukri, Stalwart + bastard sword, etc).

**Affected effect types** (no handler exists for any of them):

| Effect type | Tree count | Notes |
|---|---:|---|
| `WeaponDamageBonusClass` | 40 | Class-restricted +damage |
| `WeaponAttackBonusClass` | 34 | Class-restricted +to-hit (irrelevant until AC modeled) |
| `WeaponDamageBonusCriticalClass` | 18 | Class-restricted bonus on crit |
| `WeaponAttackBonusCriticalClass` | 16 | Same, attack half |
| `Weapon_EnchantmentClass` | 15 | Class-restricted enchantment +N |
| `WeaponCriticalMultiplierClass` | 10 | Class-restricted ×N crit mult |
| `WeaponCriticalRangeClass` | 5 | Class-restricted +crit-range |
| `WeaponDamageAbilityClass` | 3 | Class-restricted damage-stat replacement |
| `WeaponAttackAbilityClass` | 1 | Class-restricted attack-stat replacement |
| `WeaponOtherDamageBonusClass` | 1 | Off-hand specific |
| `WeaponOtherDamageBonusCriticalClass` | 1 | Off-hand specific, on-crit |

**Required infrastructure** (none of which exists yet):
1. **Class-favored-weapon list per build.** Built up from `AddGroupWeapon`
   effects (56 instances — these grant a weapon class to a class's
   list, e.g. "Kensei: Add short sword").
2. **Equipped-weapon → class-favored membership query.** Given the build's
   MainHand item type and the favored list, decide which `*Class`
   bonuses fire.
3. **Per-Class breakdown machinery** that filters `Weapon*Class`
   bonuses by the relevant class context.

**Recommendation:** scope this as its own follow-up rather than fold it
into Slice 2 fixes. It's the largest single audit finding so far and
deserves a focused PR.

**Resolution:** Built the favored-weapon infrastructure. New module
`src/engine/weaponGroups.ts` exposes a static weapon-type → group
registry covering every weapon in the items catalog (Handwraps →
Unarmed/Light/Melee/Simple, Great Sword → Two Handed/Sword/Heavy
Blades/Martial/Slashing, etc.) plus a `weaponInGroup(weaponType,
groupName, dynamicGroups)` resolver.

Dynamic groups are built from `AddGroupWeapon` effects in the
build's active enhancements / feats / class abilities — collected in
`runEngine.ts` into `EngineResult.dynamicWeaponGroups`.

`buildStatsFromEngine` (meleeCalc.ts) now folds the eligible
`Weapon*Class` bonuses into per-weapon stats:

| Effect type | Routes to | Status |
|---|---|---|
| `WeaponDamageBonusClass` | flat damage | ✅ wired |
| `WeaponDamageBonusCriticalClass` | seeker / crit damage rider | ✅ wired |
| `Weapon_EnchantmentClass` | flat damage (enchantment is a flat per-hit) | ✅ wired |
| `WeaponCriticalRangeClass` | crit range | ✅ wired |
| `WeaponCriticalMultiplierClass` | crit mult on all | ✅ wired |
| `WeaponAlacrityClass` | melee/ranged alacrity (via Issue 1 path + group filter) | ✅ wired |
| `WeaponAttackBonusClass` | (deferred) | — to-hit, no AC modeling |
| `WeaponAttackBonusCriticalClass` | (deferred) | — same |
| `WeaponDamageAbilityClass` | (deferred) | 3 instances, niche |
| `WeaponAttackAbilityClass` | (deferred) | 1 instance |
| `WeaponOtherDamageBonusClass` | (deferred) | off-hand only, 1 instance |
| `WeaponOtherDamageBonusCriticalClass` | (deferred) | off-hand only, 1 instance |

New unit tests in `tests/engine/favoredWeapon.test.ts` cover static
membership, dynamic groups (Kensei "Focus Weapon" pattern), the "All"
wildcard for divine "Favored Weapon", and rejection cases. Engine
snapshots updated: `totalAppliedBonuses` drops by the count of
`AddGroupWeapon` effects per build (those previously fell through
`evaluateEffect` and accrued unconsumed bonuses; they now early-return
into `dynamicWeaponGroups`).

## Edge cases — out of scope or deferred

| Effect type | Tree count | Status | Reason |
|---|---:|---|---|
| `Weapon_Attack` | 141 | ✗ no handler | To-hit not modeled (no enemy AC). Deferred until AC modeling lands. |
| `Weapon_AttackCritical` | 5 | ✗ no handler | Same — attack-half on crit. |
| `Weapon_DamageCritical` | 3 | ⚠ partial | Adds flat damage on crit only. Not currently fed into the crit branch of `meleeAbilityAvgPerHit`. |
| `Weapon_AttackAbility` | 14 | ✗ no handler | Drives to-hit ability stat. Deferred. |
| `Weapon_Enchantment` | 12 | ✗ no handler | Already handled per-item via the enchantment buff on the weapon itself; effect-driven enchantment from enhancements is unused in current data anyway (verified empty after grep). |
| `Weapon_VorpalRange` | 1 | ✗ no handler | Vorpal effect; not modeled. |
| `KiCritical` | 1 | ✗ no handler | Single-instance Monk-only Ki crit; not modeled. |
| `HelplessDamage` | 15 | ✗ no handler | Requires enemy-helpless state modeling. Defer. |
| `HelplessDamageReduction` | 7 | ✗ no handler | Same. |
| `ThreatBonusMelee` | 37 | ✗ no handler | Tank stat, not DPS. Defer. |
| `ThreatBonusRanged` | 8 | ✗ no handler | Same. |
| `SneakAttackRange` | 33 | ⚠ partial | Sneak attack expansion (e.g. behind / flanking). Engine collects bonuses via `ofType('SneakAttackRange')` for stat readout but doesn't actually condition damage on positional sneak. |
| `SneakAttackAttack` | 29 | ⚠ partial | Same — to-hit while sneaking. |
| `SneakAttackDamage` | 3 | ⚠ partial | Flat sneak damage rider. |
| `RangedSneakAttackRange` | 5 | ⚠ partial | Ranged-specific sneak range. |
| `AddGroupWeapon` | 56 | ✗ no handler | Adds weapon class to a class's favored list. Required infrastructure for Issue 3. |
| `WeaponTypesEquipped` | 9 | ⚠ query | Used as a *requirement* type ("equipped weapon is in group X"), not a stat effect. Not currently checked by `passesRequirement`. |
| `DamageAbilityMultiplierOffhand` | 1 | ✗ no handler | Single instance off-hand stat-mod multiplier. Niche. |
| `Hireling*Power` (2) | 2 | ✗ no handler | Hirelings out of scope (consistent with Slice 1 finding). |

## Sample verification — kemton's monk

Walked the kemton fixture's relevant weapon-related enhancements through
the pipeline by hand:

- **Henshin Mystic Porous Soul rank 3:** XML grants `Weapon_Alacrity 15`.
  Engine bonus stream contains `{ effectType: 'Weapon_Alacrity', value: 15 }`.
  `breakdownMeleeSpeed` filter is `'MeleeAlacrity'` only → bonus excluded
  → `engine.meleeSpeed.total` does NOT include +15%. **Confirms Issue 1.**
- **Kensei +1 to Hit and Damage (probe):** searched `Fighter_Kensei.tree.xml`
  for `Weapon_AttackAndDamage`. Bonus stream has it; no breakdown reads
  it. **Confirms Issue 2.**
- **Stalwart Defender Bastard Sword Specialization (probe):** uses
  `WeaponDamageBonusClass`. No handler. **Confirms Issue 3.**
- **Doublestrike from monk Centered ki strike:** XML grants `Doublestrike`,
  `breakdownDoublestrike` picks it up, `engine.doublestrike.total`
  reflects it. ✅
- **Crit profile (Henshin Mystic +1 keen / +1 mult on 19-20):** all four
  crit handlers (`Range`, `Mult`, `Mult1920`, `AttackAndDamageCritical`)
  read their respective types. ✅

## Recommended next actions

1. **Fix Issue 1** (alacrity gap) — small, mechanical, high impact.
   ~15 lines of code in `breakdowns.ts` plus snapshot regen.
2. **Fix Issue 2** (`Weapon_AttackAndDamage` damage half) — even smaller.
3. **Defer Issue 3** to a separate scoped piece of work — it needs
   class-favored-weapon infrastructure that touches `BuildContext` and
   `meleeCalc` together.
4. Move on to **Slice 3 — Spell mechanics** (~800 instances of
   SpellPower / DC / Lore / Cost reductions / etc.) once 1 and 2 are
   resolved.
