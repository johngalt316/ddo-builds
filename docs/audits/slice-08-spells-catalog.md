# Slice 8 — Spells.xml Catalog Audit

**Date:** 2026-05-12
**Scope:** Spells.xml catalog parsing, field coverage, and consumer
  routing. Last data slice of the audit pass; complements the spell
  *mechanics* audit (Slice 3 — spell power / crit / DC stacking) by
  inventorying the per-spell data itself.
**Status:** complete (read-only inventory). No code changes —
  catalog is fully parsed and the DPS layer consumes the
  hot-path fields. Two gaps surfaced; both require design work and
  are deferred (logged to `deferred.md`).

## Catalog scope

707 distinct spells (708 raw `<Spell>` entries minus the "No spell
trained" sentinel). Schema fields parsed by `parseSpellsXml`
(`src/utils/ddoXmlParser.ts:567`):

| Field | Type | Coverage | Consumer |
|---|---|---:|---|
| `name`, `description`, `icon` | string | 707 / 707 | SpellsTab UI, spell-picker dialogs |
| `school` | string | 583 / 707 | UI tooltip; per-school DC routing (Slice 3) |
| `metamagic` | record of flags | 567 with ≥1 flag | `spellCost.ts::appliesToSpell` (filters per-spell metamagic applicability) |
| `damages[]` (damageType, spellPower, dice w/ PerCasterLevels + Cap) | array | 261 / 707 | `abilities.ts::buildAbilityFromSpell` → DPS damage components |
| `dcs[]` (dcType, dcVersus, schools, modAbility, castingStatMod) | array | 245 / 707 | ⚠ **parsed but unused** — see Issue 1 |
| `effects[]` (buff spell side effects) | array | 106 / 707 | ⚠ **partially unused** — see Issue 2 |
| `cost` | number | partial | `spellCost.ts::resolveBaseCost` (class-spell overrides win) |
| `cooldown` | number | partial | DPS rotation timing |
| `maxCasterLevel` | number | 289 / 707 | DPS CL capping in `calculator.ts:436` |
| `maxTargetCap` | number | optional | DPS AoE target accounting |
| `placeholderDamage` | bool | source: enhancement-item XML | SLA categorization (not from Spells.xml directly) |
| `weaponAttack` (mhHits / scalar / crit modifiers) | object | source: enhancement-item XML | Cleave-style abilities (not from Spells.xml directly) |

**School distribution (informational):**

| School | Spells |
|---|---:|
| Conjuration | 158 |
| Transmutation | 142 |
| Evocation | 121 |
| Necromancy | 55 |
| Enchantment | 49 |
| Abjuration | 39 |
| Illusion | 11 |
| Divination | 8 |

## What's working

**Parsing is comprehensive.** Every field present in the upstream
XML lands on `DDOSpellData`. Metamagic flags self-close cleanly
(`<Empower/>` etc.) and round-trip through `parseSpellMetamagic`.
Multi-damage spells (e.g. Ice Storm — bludgeoning + cold) emit one
`SpellDamage` entry per damage type with their own SpellDice and
SpellPower routing.

**DPS-hot fields are consumed.** The damage path
(`abilities.ts:280-310` → `calculator.ts` → `damage.ts`) reads
`damages[]`, applies `MaxCasterLevel` capping, applies `BonusDice`
scaling, and resolves the spell power category from
`damages[i].spellPower`. Metamagic SP cost math via
`spellCost.ts::spellCostBreakdown` honors `appliesToSpell(mm,
spell.metamagic)` so e.g. Maximize doesn't bill SP for spells that
can't be maximized.

**Class-spell overrides win for cost / cooldown / max CL.**
Class XMLs (parsed by `parseClassXml`) define `ClassSpell` rows that
can override the catalog defaults — a Cleric's Recitation has a
different cost than a Bard's, and the spec correctly falls through
catalog defaults only when the class doesn't override (see
`abilities.ts:295-298`).

## Issues found

### Issue 1 — `dcs[]` field parsed but unused (MEDIUM, deferred)

**Severity.** Medium. 245 spells carry a `SpellDC` block. Schema:

```xml
<SpellDC>
  <DCType>Reflex</DCType>         <!-- save type tested -->
  <DCVersus>DEX</DCVersus>         <!-- ability the save reads -->
  <School>Evocation</School>       <!-- … sometimes multiple -->
  <CastingStatMod/>                <!-- whether DC reads casting-stat mod -->
  <ModAbility>Intelligence</ModAbility>  <!-- ability override (heightened arcane) -->
</SpellDC>
```

**Symptom.** The engine computes per-school DC totals via
`breakdownSpellDC` (`runEngine.ts:594`) and surfaces them on
`EngineResult.spellDCs[school]`. That covers the bulk case (a
Necromancy spell uses the Necromancy DC). But the per-spell `dcs[]`
records — which capture spell-specific overrides like ModAbility
swaps for Wizard schools, multi-school spells (e.g. Conjuration AND
Evocation), or `DCType=NoSave` for save-less spells — never flow
into the DPS path. The DPS calculator treats every spell as if its
DC equals the school baseline.

**Why deferred.** Save-vs-DC math isn't currently modeled in the DPS
path at all — the simulator assumes every spell hits and computes
expected damage. Per-spell DC accuracy only matters once save-
based hit-or-miss enters the model (which would also require
modeling enemy save profiles). Surfacing `dcs[]` in the UI tooltip
is a smaller change worth doing independently when the UI gets
revisited.

**Recommended later.** Two-stage:
1. **UI surfacing**: extend the SpellsTab tooltip to show "DC: X
   (Reflex vs. DEX)" pulled from `data.dcs[0]`. Trivial; helps build
   planners.
2. **Engine routing**: when save-vs-DC math lands, route through
   `data.dcs` for the per-spell DC value instead of the school
   default. Honor ModAbility overrides.

### Issue 2 — Self-cast buff spell effects (106 spells) not activated by any path (MEDIUM, deferred)

**Severity.** Medium. 106 spells in the catalog have `<Effect>`
blocks defining what they do when cast on the caster (e.g. Bull's
Strength → +N Enhancement-typed STR). The parser puts these on
`DDOSpellData.effects` correctly, but no engine path fires them.

**Overlap analysis:**

| Bucket | Count | Status |
|---|---:|---|
| Buff spells in BOTH Spells.xml AND SelfAndPartyBuffs.xml | 34 | ✅ Covered — `build.activePartyBuffs` activates them through the SelfAndPartyBuffs path. Spells.xml `effects[]` is redundant for these. |
| Buff spells ONLY in Spells.xml | 72 | ❌ **No activation path.** |

Examples of the 72 uncovered: Bull's Strength, Cat's Grace, Bear's
Endurance, Adamantine Weapons, Align Fang, Angelskin, Armor of
Speed, Augment Armor, Blighted Bite, Byeshk Weapons, Camouflage
Mass.

**Symptom.** A Wizard casting Bull's Strength on themselves should
get +4-6 Enhancement-typed STR (depending on caster level). The
engine has no way to know the spell is active — there's no
`build.activeSelfSpells` or equivalent. The user would have to
remember to toggle on the equivalent in SelfAndPartyBuffs (when it
exists), or live without the buff in the calculation.

**Why deferred.** Significant feature work:
- New build-state field for active self-cast spell list
- Build-editor UI to toggle which self-cast buffs are "up"
- Duration / charge tracking is out of scope, but the active/inactive
  toggle is the entry point
- The architecture choice between extending `activePartyBuffs` to
  cover self-buffs vs. adding a parallel `activeSelfBuffs` field

The SelfAndPartyBuffs.xml infrastructure already handles 34 of
these for free — the right move when this lands is probably to
unify under one buff list and let the source XML (Spells vs.
SelfAndPartyBuffs) determine the activation UX without affecting
the engine plumbing.

**Recommended later.** Single field on `Build`: `activeSpellBuffs:
string[]`. `collectEffects` walks the list, looks each name up in
the spell catalog, fires the effects (with the spell's own
requirements still gated through `evaluateEffect`). UI is a
checkbox list under the SpellsTab matching the player's known
spells with `effects[].length > 0`.

## Sample verification

- **Magic Missile (kemton's main rotation):** 1d4+1 force damage per
  missile, BonusDice +1d4 per 2 caster levels (cap 5 extra), Force
  spellpower. Catalog provides all of this; DPS calc applies CL
  capping at `maxCasterLevel = 5` → 5 missiles at CL ≥ 9. ✅
- **Reconstruct (kemton SLA via Arcane Trickster):** 1d6 + 18 per
  caster level Repair, capped at CL 20. Listed as SLA in the engine
  via `runEngine.ts:296` SLA pathway, not as a generic damage spell.
  Catalog `damages[]` correctly resolves Repair damage type. ✅
- **Fireball (Wizard / Sorc / etc.):** 1d6 fire per CL, Evocation
  Reflex save, Empower / Maximize / Intensify metamagic. Damage
  routes through `damages[0].spellPower = 'Fire'` →
  `engine.spellPowers.Fire.total`. ✅ Per-spell DC info present
  (`dcs[0] = { dcType: 'Reflex', dcVersus: 'DEX', schools:
  ['Evocation'] }`) but not surfaced to UI or used in any
  calculation — Issue 1.
- **Bull's Strength (catalog has effects[] for +4 STR):** A wizard
  build with Bull's Strength trained doesn't gain STR. Issue 2.

## What changed during the audit

Nothing — this slice is read-only. The catalog is fully parsed and
the active consumers handle their hot paths correctly. Both surfaced
gaps require design choices and are logged to
`docs/audits/deferred.md`.

## Audit complete

This is the final slice. The 8-slice pass covered:

1. Core stats (ability / save / HP / SP / skill bonuses)
2. Weapon mechanics (damage / alacrity / favored-weapon / weapon-class)
3. Spell mechanics (power / crit / DC stacking, casting-stat plumbing)
4. Defenses (PRR / MRR / AC / Dodge / amps / energy resists)
5. Combat tactics (TacticalDC / SneakAttack / BAB / threat)
6. Granted abilities (SLA / GrantFeat / GrantSpell)
7. Stances & exclusions (Stance / GroupMember / ExclusionGroup)
8. Spells.xml catalog (this slice)

Cumulative fixes (across all 8 slices): 6 inline correctness fixes
(`<Type>Skill</Type>` gate, alacrity routing, `Weapon_AttackAndDamage`
damage half, `ArmorACBonus` inclusion, `<Type>BAB</Type>` gate,
GrantFeat expansion, GroupMember/GroupMember2 gating). Test count
went from a pre-audit baseline of ~378 to 407. Lint clean throughout.

Deferred items logged centrally in `docs/audits/deferred.md` so a
future you can pick any one up without re-reading the slice docs.
