# Data Schema

This document describes the XML schema in `public/data/` — the
**authoritative** data the engine reads. Started as a verbatim mirror
of [DDOBuilderV2](https://github.com/Maetrim/DDOBuilderV2)'s
`Output/DataFiles/` and has since diverged in specific ways
documented below.

For the overall ownership model see [`external/README.md`](../external/README.md).
For history of *why* each divergence exists see
[`docs/DATA_PATCHES.md`](./DATA_PATCHES.md).

---

## File map

| File / dir | Aggregates | Identifying tag | Engine entry point |
|---|---|---|---|
| `Spells.xml` | `<Spell>` blocks | `<Name>` | `parseSpellsXml` (in `ddoXmlParser.ts`) |
| `Feats.xml` | `<Feat>` blocks | `<Name>` | `parseFeatsXml` |
| `BonusTypes.xml` | `<BonusType>` blocks | `<Name>` | `parseBonusTypesXml` |
| `Stances.xml` | `<Stance>` blocks | `<Name>` | `parseStancesXml` |
| `SetBonuses.xml` | `<SetBonus>` blocks | `<Name>` | `parseSetBonusesXml` |
| `ItemBuffs.xml` | `<Buff>` blocks | `<Type>` | item-buff catalog (consumed at gear-resolve time) |
| `GuildBuffs.xml` / `SelfAndPartyBuffs.xml` | `<GuildBuff>` / `<Buff>` | `<Name>` | parsed by their own walkers |
| `AttackRates.xml`, `WeaponGroupings.xml` | (small, single-purpose) | — | parsed once at load |
| `Classes/*.class.xml` | one `<Class>` per file | `<Name>` | `parseClassXml` |
| `Races/*.race.xml` | one `<Race>` per file | `<Name>` | `parseRaceXml` |
| `EnhancementTrees/*.tree.xml` | one `<EnhancementTree>` per file | `<Name>` | `parseEnhancementTreeXml` |
| `Augments/*.Augments.xml` | many `<Augment>` per file | `<Name>` | `parseAugmentsXml` |
| `FiligreeSets/*.FiligreeSet.xml` | one set + filigrees per file | `<Name>` | `parseFiligreeSetXml` |

---

## Common building blocks

### `<Effect>`

The most common block: declares one stat / behavior change. Same shape
across feats, enhancements, item buffs, augments, filigrees.

```xml
<Effect>
  <DisplayName>Optional pretty name for breakdowns</DisplayName>
  <Type>HealingAmplification</Type>     <!-- effect kind -->
  <Type>UniversalSpellCriticalDamage</Type><!-- multiple Type tags = same value applied to each kind -->
  <Bonus>Equipment</Bonus>              <!-- bonus type, drives stacking competition -->
  <Item>All</Item>                      <!-- subtarget (skill name, ability, weapon group, …) -->
  <AType>Simple</AType>                 <!-- amount-evaluation mode -->
  <Amount size="1">12</Amount>          <!-- table sized to N (rank or class-level scaling) -->
  <ApplyAsItemEffect />                 <!-- gear-effect flag — competes only with other gear effects -->
  <Requirements> … </Requirements>      <!-- optional gating -->
</Effect>
```

**`<AType>` values the engine evaluates** (canonical list lives in
`src/types/effectTypes.ts` — auto-generated from DDOBuilderV2's
`Effect.h` via `npm run gen-effect-types`):

| AType | `Amount` semantics | Notes |
|---|---|---|
| `Simple` | `amount[0]` is the value | Most common. |
| `Stacks` | `amount[rankCount-1]` | For multi-rank enhancements. |
| `NotNeeded` | (no amount used) | Effects that just toggle a feat / proficiency. |
| `FeatCount` | `amount[0]` if `feats.has(items[0])`, else 0 | Per-feat conditional. Used for our Sharp Magic patch. |
| `ClassLevel` / `BaseClassLevel` / `TotalLevel` | `amount[level-1]` | Indexed by character/class level. |
| `AbilityValue` / `AbilityTotal` / `AbilityMod` / `HalfAbilityMod` / `ThirdAbilityMod` | derived from one ability score | `items[0]` names the ability. |
| `BAB` | the build's BAB | — |
| `APCount` | `amount[apSpentInTree-1]` | Indexed by AP poured into a named tree. |
| `SpellInfo` | **see SpellLikeAbility section** | Special — Amount is metadata, not a value. |
| `SliderValue` | user-toggled | Slider clickies. |

### `SpellLikeAbility` effect (SLA wiring)

An `<Effect>` whose `<Type>` is `SpellLikeAbility` encodes "this
enhancement / feat grants the ability to cast {spell name}." `Amount`
is repurposed as a 4-slot metadata table:

```xml
<Effect>
  <Type>SpellLikeAbility</Type>
  <Bonus>Enhancement</Bonus>
  <Item>Magic Missile</Item>           <!-- spell name (must match <Spell><Name>) -->
  <Item>Arcane Trickster</Item>        <!-- casting class — "None" for Character/destiny SLAs -->
  <AType>SpellInfo</AType>
  <Amount size="4">0 2 5 4</Amount>    <!-- [0]=charges/rest [1]=SP cost [2]=maxCL [3]=cooldown(s) -->
</Effect>
```

`charges=0` means **unlimited** (the SLA can fire freely between rests).

### `<Requirements>`

Gates effects on build state. Branches the engine evaluates:

```xml
<Requirements>
  <Requirement>
    <Type>Stance</Type>           <!-- Class / BaseClass / Stance / Feat / Race / Level / Ability / Enhancement / … -->
    <Item>Ranged Combat</Item>
  </Requirement>
  <RequiresOneOf> … </RequiresOneOf>   <!-- any of the listed requirements -->
  <RequiresNoneOf> … </RequiresNoneOf> <!-- none may match -->
</Requirements>
```

Unknown requirement types pass through (permissive) — by design, so
we don't drop effects when DDOBuilderV2 introduces new requirement
flavors before our parser catches up.

---

## `<Spell>` schema

```xml
<Spell>
  <Name>Magic Missile</Name>            <!-- unique key -->
  <Description>…</Description>          <!-- prose; UI only -->
  <Icon>MagicMissile</Icon>             <!-- → /assets/images/SpellImages/MagicMissile.png -->
  <School>Evocation</School>
  <!-- metamagic feat applicability flags — presence = applies -->
  <Empower/>
  <Maximize/>
  <Quicken/>
  <Heighten/>
  <Intensify/>
  <Embolden/>
  <Enlarge/>
  <Extend/>
  <MaxCasterLevel>20</MaxCasterLevel>   <!-- cap on caster-level scaling -->
  <SpellDamage>
    <SpellDice>
      <PerCasterLevels>2</PerCasterLevels>   <!-- 1 set per N caster levels -->
      <Cap>5</Cap>                            <!-- max number of sets (optional) -->
      <BaseDice>                              <!-- … OR <BonusDice> (same shape) -->
        <Number>1</Number>
        <Sides>2</Sides>
        <Bonus>3</Bonus>
      </BaseDice>
    </SpellDice>
    <Damage>Force</Damage>                   <!-- damage element -->
    <SpellPower>Force</SpellPower>           <!-- which spell-power pool scales it -->
  </SpellDamage>
  <SpellDC>…</SpellDC>                       <!-- save profile -->
  <Cooldown>2</Cooldown>                     <!-- ★ ours-added: see "Cooldown" below -->
</Spell>
```

### Our extensions on `<Spell>`

#### `<Cooldown>` — always inline

DDOBuilderV2 doesn't carry `<Cooldown>` on damaging spells; cooldown
information lives in the description prose. We bake the value
directly onto the `<Spell>` so the engine can read it like any other
field.

#### `BaseDice` vs `BonusDice`

Upstream uses both interchangeably. Our parser reads either one — see
`parseSpellDamage` in `ddoXmlParser.ts`. New entries should pick
whichever the upstream pattern uses for the same spell category.

#### Multi-projectile spells (Magic Missile, Force Missiles, Scorching Ray)

The XML shape isn't sufficient to model the missile-count progression
or the per-missile bonus growth. These are handled in code via
`src/engine/dps/spellRules.ts` overrides keyed by spell name; the
XML's dice block is ignored for those names. See SCHEMA-relevant
note in that file's header.

---

## `<Feat>` schema

```xml
<Feat>
  <Name>Magical Ambush</Name>
  <Description>…</Description>
  <Icon>MagicalAmbush</Icon>
  <Acquire>Automatic</Acquire>           <!-- Standard / Automatic / past-life / etc. -->
  <Group>…</Group>                       <!-- optional category for filtering -->
  <Effect>…</Effect>                     <!-- one or many; same shape as common -->
  <Requirements>…</Requirements>         <!-- prereqs to take -->
</Feat>
```

Past-life feats (`Past Life: …`, `Inherent …`) live in `Feats.xml`
or per-class XMLs alongside regular feats; the engine retags their
`<Bonus>Feat</Bonus>` as `Stacking` automatically so multiple lives
of the same past life sum (see `collectEffects.ts` step 7).

---

## Enhancement-tree schema

```xml
<EnhancementTree>
  <Name>Shadowdancer</Name>
  <IsEpicDestiny />          <!-- presence = epic destiny tree -->
  <Background>DestinyMartial</Background>
  <Icon>Shadowdancer</Icon>
  <Requirements>…</Requirements>

  <EnhancementTreeItem>
    <Name>Shadowdancer: Shadow Training</Name>
    <InternalName>U51ShadowdancerCore1</InternalName>
    <Description>…</Description>
    <Icon>ShadowTrainingI</Icon>
    <XPosition>0</XPosition>
    <YPosition>0</YPosition>
    <CostPerRank size="1">1</CostPerRank>
    <Ranks>1</Ranks>
    <MinSpent>0</MinSpent>
    <Clickie />              <!-- presence = active ability with cooldown -->
    <Tier5 />                <!-- presence = max-tier capstone -->
    <Selector>               <!-- optional: user picks one EnhancementSelection -->
      <EnhancementSelection>
        <Name>Nightmare Lance</Name>
        <Description>…</Description>
        <Icon>NightmareLance</Icon>
        <CostPerRank size="1">2</CostPerRank>
        <Clickie />
        <Effect>…</Effect>
      </EnhancementSelection>
      <EnhancementSelection>…</EnhancementSelection>
    </Selector>
    <Requirements>…</Requirements>
    <Effect>…</Effect>       <!-- effects that fire whenever this enhancement is taken -->
  </EnhancementTreeItem>
</EnhancementTree>
```

### Our conventions for enhancement trees

- **`<Clickie/>` enhancements that are SLAs** must carry a
  `<Type>SpellLikeAbility</Type>` effect with the four-slot
  `<Amount>charges cost maxCL cooldown</Amount>` table. Upstream
  doesn't always wire this — see `scripts/patchEpicStrikes.mjs` for
  the catch-up patcher.
- **Selector children** carry their own `<Effect>` blocks: the engine
  fires only the chosen child's effects, never the parent's. The
  parent's `<Effect>` siblings (outside the `<Selector>`) fire whenever
  ANY child is chosen.
- **Stance-gated effects** must reference an actual `<Stance><Name>`
  from `Stances.xml`. The auto-stance for ranged combat is named
  `Ranged Combat`, not `Ranged` (upstream typo we patched).

---

## Augment schema

```xml
<Augment>
  <Name>Solar Gem of Spell Critical Damage (Legendary)</Name>
  <Description>…</Description>
  <MinLevel>34</MinLevel>
  <Type>Solar Slot (Helmet)</Type>             <!-- slot category that accepts this augment -->
  <Icon>Solar</Icon>
  <Effect>…</Effect>
</Augment>
```

### Our convention for Universal-routing augments

Some upstream augments encode universal effects with a per-element
shape (e.g. `<Type>SpellCriticalDamage</Type>` plus
`<Item>All</Item>`). Our breakdown engine routes per-element
effects per element, not into the universal pool — so for these,
edit the augment's `<Effect>` to use the explicit universal type
(`UniversalSpellCriticalDamage`) and remove the `<Item>` filter.

---

## Inline patch comment convention

Wherever we deliberately diverge from upstream, mark the edit with a
short comment so the next person reading the XML knows it's
intentional and where to find context:

```xml
<!-- ddo-builds patch: see docs/DATA_PATCHES.md "Sharp Magic". -->
<Effect>
  <Type>SneakAttackDice</Type>
  …
</Effect>
```

`sync-upstream` doesn't strip these because it never overwrites
`public/data/`; only `external/ddobuilderv2/` is refreshed on sync.
`git diff external/ddobuilderv2/ public/data/` is the canonical
"what's our delta from upstream" view.

---

## Schema evolution

When adding a new tag or repurposing an existing one:

1. **Document it here** under the relevant file's section. Be explicit
   about whether it's an addition or a reinterpretation.
2. **Update the parser** in `src/utils/ddoXmlParser.ts` (or the
   relevant walker) — types live in `src/types/ddoData.ts` and
   `src/types/gameData.ts`.
3. **If it's user-visible**, surface it in the engine result and the
   relevant breakdown / hook.
4. **Backfill existing entries** in `public/data/` rather than gating
   on presence at parse time when feasible — keeps the schema
   regular.
5. **Snapshot tests** in `tests/snapshots/` will fail loudly if a
   silently-meaningful field changes; treat snapshot diffs as
   intentional and refresh deliberately.
