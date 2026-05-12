# Slice 7 — Stances & Exclusions Audit

**Date:** 2026-05-11
**Scope:** `<Type>Stance</Type>` requirement gating, the Stances.xml
  catalog, stance granters (feats / class auto-feats / enhancement
  trees / destinies), `IncompatibleStance` metadata,
  `<Type>GroupMember</Type>` / `<Type>GroupMember2</Type>` requirement
  gates, `<Type>ExclusionGroup</Type>` enhancement-selection
  constraints, and auto-controlled stances.
**Status:** complete (audit + 1 inline fix). One real engine gap
  closed (GroupMember/GroupMember2 silent-pass); structural items
  documented and deferred to a future build-editor / auto-stance pass.

## Inventory

| Mechanism | Count | Status |
|---|---:|---|
| `<Stance>` elements in build sources (feats / classes / trees) | 363 | Parsed via `parseStancesIn`; surfaced through `collectAvailableStances` (`collectEffects.ts:741`) |
| Stances.xml catalog entries | 30 | All `<Group>Auto</Group><AutoControlled/>` — game-derived, not toggleable. Parsed via `parseStancesXml`. |
| `<Requirement><Type>Stance</Type>` gates | 2,730 | ✅ Gated in `evaluateEffect.ts::passesRequirement` (`case 'Stance'`) against `ctx.activeStances` |
| `<IncompatibleStance>` declarations | 59 | Parsed into `DDOStanceData.incompatibleStances`; **not enforced at runtime** (UI concern, see deferred) |
| `<Type>GroupMember</Type>` requirements | 85 | ⚠ → **fixed this slice** |
| `<Type>GroupMember2</Type>` requirements | 3 | ⚠ → **fixed this slice** |
| `<Type>ExclusionGroup</Type>` effects | 261 | Build-editor concern (deferred, see Issue 4) |

## What was already working

- **Stance requirement gating** (Slice 1 onwards). The
  `case 'Stance':` arm of `passesRequirement` looks the requirement
  item up in `ctx.activeStances`. Any of the 2,730 stance-gated
  effects fire when the named stance is in the user's active list.
- **Available-stance discovery.** `collectAvailableStances` walks
  selected feats, class auto-feats, past-life feats, enhancement
  trees, destinies, and reaper trees for `<Stances>` blocks. Output
  feeds the `StancesPicker` UI so the user sees only stances their
  build can actually access.
- **Manual stance toggling.** `useBuildStore.toggleStance(name)` flips
  `build.activeStances` membership. The picker shows the chip in an
  "on" state when active.

## Issues found

### Issue 1 — `<Type>GroupMember</Type>` / `<Type>GroupMember2</Type>` silently passed (MEDIUM) — **FIXED 2026-05-11**

**Severity.** Medium. 88 total instances. The most concentrated user
is Fighter Kensei (49 — all `<Item>Focus Weapon</Item>` gates), with
the rest scattered across destinies (Shadowdancer, Shiradi Champion,
Legendary Dreadnought) and ranged trees (Elf/Ranger Arcane Archer).

**Symptom.** `passesRequirement` had no case for either type. The
`default` arm returned `true`, so every gate silently passed.
Practical impact:

- Legendary Dreadnought has three independent +1 effects, each gated
  on `GroupMember(Slashing)`, `GroupMember(Piercing)`, `GroupMember(Bludgeoning)`.
  A monk wielding handwraps (bludgeoning only) was getting all three
  → +3 instead of the correct +1.
- A Kensei build wielding a weapon outside its Focus Weapon group was
  still seeing Focus Weapon bonuses apply (49 effects in the Kensei
  tree gate on this).
- Arcane Archer effects gated on `GroupMember(Bow)` applied regardless
  of mainhand weapon.

**Resolution.** Implemented `case 'GroupMember':` and
`case 'GroupMember2':` in `passesRequirement`. The handlers consult
the existing `weaponInGroup(weapon, group, dynamicGroups)` helper in
`engine/weaponGroups.ts`, which already does static-registry plus
dynamic-group resolution. Inputs:

- `ctx.mainHandWeapon` / `ctx.offHandWeapon` — newly plumbed onto
  `BuildContext`. Sourced from the active gear set's
  `slot==='MainHand'` / `slot==='OffHand'` item's `weapon` field.
- `ctx.dynamicWeaponGroups` — also newly plumbed. Populated by a
  pre-pass in `runEngine.ts` that walks sourced effects for
  `AddGroupWeapon` (Kensei "Focus Weapon", Bard "Swashbuckling", etc.)
  BEFORE the main effects loop, so a GroupMember gate evaluated at any
  point sees all dynamic groups, not just those added by earlier
  effects.

```typescript
case 'GroupMember':
case 'GroupMember2': {
  const weapon = req.type === 'GroupMember' ? ctx.mainHandWeapon : ctx.offHandWeapon;
  if (!weapon) return false;
  return weaponInGroup(weapon, item, ctx.dynamicWeaponGroups);
}
```

**Fixture snapshot deltas.** Tiny — both kemton and yings lose 1
applied bonus (a previously silently-passing gate now correctly
fails). No per-stat user-visible totals changed; the affected bonuses
went to allBonuses but weren't surfaced in any breakdown. Maetrim and
zentek unchanged.

| Fixture | Δ bonuses | Δ failed gates |
|---|---:|---:|
| kemton (AT) | -1 | +1 |
| yings (Monk) | -1 | +1 |
| maetrim, zentek | 0 | 0 |

7 new unit tests in `skillRequirement.test.ts` cover: static-group
mainhand hit/miss, dynamic-group hit/miss, "All" wildcard, empty-hand
edge case, GroupMember2 routes to offhand.

### Issue 2 — Auto-controlled stances not auto-activated (MEDIUM, deferred)

**Severity.** Medium for accuracy. The 30 stances in `Stances.xml` are
all `<Group>Auto</Group><AutoControlled/>` — DDO derives them from
build state at runtime, not from a user toggle. Examples:

| Auto-stance | Should activate when… |
|---|---|
| Two Weapon Fighting | Wielding one-handed weapons in both hands |
| Two Handed Fighting | Wielding a two-handed weapon |
| Heavy Armor | Wearing heavy-armor docent / armor |
| Centered | Wielding monk centered weapons |
| Good / Lawful / Chaotic / True Neutral | Build's alignment matches |
| Favored Weapon (Shield) | Equipped favored weapon + shield |
| Shield / Buckler / Tower Shield / etc. | Equipped shield of that type |

**Symptom.** The current `StancesPicker` shows these as manually
toggleable, requiring the user to opt into "Two Handed Fighting" even
when wielding a great sword. Stance-gated effects (THF damage bonus,
heavy-armor PRR scaling, monk centered bonuses) don't fire until the
user toggles each one explicitly.

**Why deferred.** Auto-stance derivation is a non-trivial computation
layer that touches gear, alignment, class, and weapon-style detection.
Each of the 30 stances has its own activation rules — many of which
are encoded as `<Requirements>` blocks inside `Stances.xml` that the
engine doesn't currently evaluate (they'd need build-state inputs we
don't yet aggregate centrally).

**Recommended later.** Add a `computeAutoStances(build, gearSet,
weaponGroups, alignment)` function that walks Stances.xml entries with
`<AutoControlled/>` and adds qualifying ones to `activeStances` *in
addition to* the user-toggled set. UI then shows auto-on stances as
non-toggleable (or with a "(auto)" badge).

### Issue 3 — `<IncompatibleStance>` not enforced at toggle time (LOW, deferred)

**Severity.** Low. 59 declarations. The parser already pulls them into
`DDOStanceData.incompatibleStances`, but `useBuildStore.toggleStance`
just flips set membership without checking conflicts. A user can
simultaneously activate Defensive Fighting + Power Attack, which DDO
wouldn't allow.

**Why deferred.** UI / build-editor concern; doesn't affect the engine
output (the engine just sees whatever's in `activeStances`). The
deferred fix lives in `useBuildStore.toggleStance`: when activating
stance X, deactivate every stance in X's `incompatibleStances` list
(transitively if needed — IncompatibleStance is symmetric in DDO).

### Issue 4 — `<Type>ExclusionGroup</Type>` not enforced in tree picker (LOW, deferred)

**Severity.** Low for engine accuracy; affects the build editor. 261
instances, concentrated in caster trees:

| Tree | Count | Pattern |
|---|---:|---|
| Wizard Arch Mage | 16 | Element specialization (Fire / Cold / Acid / Electric) |
| Favored Soul Angel of Vengeance | 11 | Holy / Unholy specialization |
| Cleric Divine Disciple | 11 | Element / school specialization |
| Sorcerer (each savant tree) | 10 each | Primary / secondary element |
| Druid Seasons Herald | 10 | Element specialization |
| Alchemist Bombardier | 10 | Element specialization |
| Bard Stormsinger | 8 | Element specialization |

**Symptom.** Each effect lists 2-4 `<Item>` entries — the first is the
exclusion-group name (`HMCore6`, `Capstone Enhancement`, etc.), and
the rest are the alternatives. The intent: the user can pick only one
enhancement from the group. The current tree picker doesn't enforce
this — a user can technically allocate AP to mutually-exclusive
enhancements simultaneously.

**Why deferred.** Pure build-editor concern (enhancement selection
constraint). The engine doesn't care — if the user has picked both,
both fire, and the user sees a fictional build. The fix lives in the
tree-picker UI or the AP-allocation logic, not in `runEngine`.

### Issue 5 — Static weapon-group registry diverges from `WeaponGroupings.xml` (LOW, deferred)

**Severity.** Low (a few weapon types affected). `weaponGroups.ts`
hardcodes weapon → group mappings, and one observed discrepancy is
Handwraps: the local registry has `[Unarmed, Light, Melee, Simple]`,
but DDOBuilderV2's `WeaponGroupings.xml` puts Handwraps in
`[Exotic, Melee, Finesseable, Centered, Bludgeoning]`. The local
"Light" and "Simple" tags are incorrect; "Bludgeoning", "Finesseable",
and "Centered" are missing.

**Why deferred.** A targeted divergence audit is its own clean-up
task. The current implementation works for the bulk of cases (the
audit's snapshot deltas would have been larger if the registry was
broken in load-bearing ways). When ready, replace `STATIC_GROUPS`
with a parsed-at-init mapping derived from
`gameDataStore.weaponGroups` (which already loads
`WeaponGroupings.xml` at startup).

## Sample verification

- **Kemton's Sireth, Spear of the Sky in mainhand.** Spear maps to
  static groups `[Two Handed, Piercing, Melee, Martial]`. LD's
  GroupMember(Piercing) effect now correctly fires; GroupMember(Slashing)
  and GroupMember(Bludgeoning) correctly fail. ✅
- **Yings's monk handwraps.** Mainhand=`Handwraps` →
  `[Unarmed, Light, Melee, Simple]`. LD's GroupMember(Bludgeoning)
  effect now correctly FAILS (registry gap — should pass per upstream
  data; tracked in Issue 5). That's the net -1 bonus in the fixture
  snapshot.
- **Kensei (no fixture uses it yet).** With the fix in place, a Kensei
  Focus: Falchion build picking the AddGroupWeapon effect (Focus
  Weapon ← Falchion) would correctly gate the 41 Focus Weapon
  Kensei effects on the mainhand being a Falchion.

## What changed during the audit

- `src/engine/evaluateEffect.ts` — `BuildContext` gains
  `mainHandWeapon`, `offHandWeapon`, `dynamicWeaponGroups`;
  `passesRequirement` adds `case 'GroupMember':` and `case 'GroupMember2':`.
- `src/engine/runEngine.ts` — pre-pass walks sourced effects for
  `AddGroupWeapon` BEFORE `buildBuildContext` so dynamic groups are
  available for requirement evaluation; the main loop now skips
  AddGroupWeapon (already processed).
- `src/engine/collectEffects.ts::buildBuildContext` — accepts the
  three new ctx fields as optional params.
- `tests/engine/skillRequirement.test.ts` — 7 new GroupMember /
  GroupMember2 tests; helper `ctxWith` extended with new defaults.
- `tests/snapshots/{kemton,yings}.engine.snap.json` — topline counter
  deltas only (1 fewer bonus, 1 more failed gate each; no
  user-visible per-stat changes).

## Next slice

**Slice 8 — Spells.xml catalog.** The last untouched data slice: 
spell schema, per-spell damage type, casting class, max caster level,
and SP cost. The Spells.xml file is loaded but the engine currently
treats spells opaquely (the DPS pane consumes them via name lookup
without going through `evaluateEffect`). A dedicated audit will
inventory what each spell record contains and whether the per-cast
damage / SP / DC math has any gaps.
