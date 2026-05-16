# Data Patches Ledger

> **Ownership model (2026-05):** `public/data/` is now our authoritative
> data source. We pull upstream DDOBuilderV2 changes in selectively via
> `external/ddobuilderv2/` (see `external/README.md`) instead of
> mirroring blindly. Many entries below describe the **historical
> reason** an override was needed; the actual fix lives directly in
> `public/data/` now. They're kept for context so future syncs know not
> to silently revert them.

Tracks places where our data deliberately diverges from upstream
DDOBuilderV2 / wiki because the source values don't match observed
in-game behavior. Each entry should eventually be filed upstream so
the divergence narrows over time.

Each row describes:
- **Patch site** – the file + symbol where the override lives.
- **Symptom** – what the unpatched data produced.
- **Override** – what we apply instead.
- **Why** – the source of truth (in-game observation, wiki, etc.).
- **Upstream** – link or note for filing the bug; `—` if not yet filed.

---

## Items (`src/utils/ddoBuildParser.ts::ITEM_BUFF_PATCHES`)

Applied at `.DDOBuild` parse time when an item with the keyed name is loaded
into a gear set. Mutates the parsed `GearBuff[]` in place.

| Item | Symptom | Override | Why | Upstream |
|---|---|---|---|---|
| Driftwood (off-hand Rune Arm) | `Impulse` Quality reads as `+36` from the data. | Force Quality Impulse to `+31`. | In-game tooltip / character sheet shows `+31`. | — |

---

## Augments (baked into `public/data/Augments/`)

Historical override that lived in `src/utils/ddoXmlParser.ts::AUGMENT_EFFECT_PATCHES`.
Retired 2026-05-04 — the fix is now inline in the XML, marked with a
`<!-- ddo-builds patch: ... -->` comment.

| Augment | Symptom | Fix in XML | Why |
|---|---|---|---|
| Solar Gem of Spell Critical Damage (Legendary) (`SunAndMoon.Augments.xml`) | Upstream codes the effect as `SpellCriticalDamage` with `<Item>All</Item>`, which our breakdown engine routes per-element. | Promoted `<Type>` to `UniversalSpellCriticalDamage`; removed the per-element `<Item>` filter. | In-game it acts as a true universal-pool bonus (shows under Universal Spell Critical Damage on the character sheet). |

---

## SLA charges (baked into class XML)

Historical override that lived in `src/engine/dps/slaCharges.ts::SLA_CHARGE_PATCHES`.
Retired 2026-05-04 — the per-rest charge count is now stored directly in
the SLA effect's `<Amount>` table (slot 0). The engine reads
`effect.amount?.[0]` with no patch table.

| Source | Spell | Charges/rest | Where it lives now |
|---|---|---|---|
| Past Life: Arcane Initiate | Magic Missile | 10 | `Wizard.class.xml` — `<Amount size="4">10 0 0 0</Amount>` on the matching `SpellLikeAbility` effect. |

`charges = 0` still means unlimited; the timeline only enforces a cap when this
value is > 0.

---

## Spell cooldowns (baked into `Spells.xml`)

Upstream `Spells.xml` never carries `<Cooldown>` on damaging spells — values
only appear (sometimes) in description prose. Historically we maintained
cooldowns in a JSON overlay (`scripts/spell-cooldowns.json` +
`spell-cooldown-overrides.json`) and re-injected them via merge scripts
on every refresh.

Retired 2026-05-04. Cooldowns now live directly inside each `<Spell>`
block (202 entries) and are read like any other field. To change a value,
edit `public/data/Spells.xml` directly.

> ⚠ Most non-overridden values were originally LEVEL-BASED DEFAULTS —
> guesses, not verified. Treat them as starting points. When you confirm
> a value in-game, edit `Spells.xml` directly and add a
> `<!-- ddo-builds patch: ... verified ... -->` comment so future syncs
> know it's intentional.

---

## Enhancement trees (baked into `public/data/EnhancementTrees/`)

Historical override that lived in `src/utils/ddoXmlParser.ts::ENHANCEMENT_TREE_PATCHES`.
Retired 2026-05-04 — the fix is now inline in the XML, marked with a
`<!-- ddo-builds patch: ... -->` comment.

| Tree | Symptom | Fix in XML | Why |
|---|---|---|---|
| Shiradi Champion (`ShiradiChampion.tree.xml`) | Every core's `SpellPower` effect lists `Force / Physical / Untyped` as `<Item>` but omits `Chaos`. | Added `<Item>Chaos</Item>` to each of the 7 affected `SpellPower` effects (5 cores + 1 selector child + 1 stacks variant). | In-game cores apply Chaos spell power alongside Force. |

---

## Inline XML edits

Direct mutations to `public/data/EnhancementTrees/*.tree.xml`. Used when
the upstream encoding requires engine support we don't have yet — easier
to reshape the data into a form the existing engine handles than to add
a new evaluator path. Restore the original block on each upstream XML
refresh.

| File | Site | Symptom | Override | Why |
|---|---|---|---|---|
| `Rogue_ArcaneTrickster.tree.xml` | `Arcane Trickster: Sharp Magic` effect | Single `AType=Stacks` effect with `<Amount size="31">0 0 1 0 2 0 …</Amount>` indexed by metamagic-feat count — our engine looks up `amount[rankCount-1]=amount[0]=0` instead of `amount[2 × metamagicCount]`. | Replaced with 11 `AType=FeatCount` effects, one per metamagic feat (`Empower Spell`, `Maximize Spell`, …, `Eschew Materials`), each granting `+1 SneakAttackDice` when its feat is trained. Net behavior matches "+1 sneak die per metamagic feat trained" without needing a new evaluator. | The description says "+1 Sneak Attack dice for every Metamagic feat you've trained." Enhancement is unique enough that a one-off XML reshape is cheaper than implementing generic stack-source counting. |
| `Rogue_Mechanic.tree.xml` | `Mechanic: Improved Detection` (`MechCore4`) `SneakAttackDice` effect | The `<Requirement><Type>Stance</Type><Item>Ranged</Item></Requirement>` references a stance named `Ranged`, which doesn't exist in `Stances.xml` (the auto-stance for using a ranged weapon is `Ranged Combat`). Effect never fires. | Rename `<Item>Ranged</Item>` → `<Item>Ranged Combat</Item>` so the requirement matches the actual auto-stance name. | Description says "1 extra Sneak Attack die with bows, crossbows, and thrown weapons" — gating on ranged combat is correct; only the stance label was wrong. Likely an upstream typo. |
| `Spells.xml` Epic Strike spells | Almost every Epic Strike (Nightmare Lance, all six Dragon Breaths, Galvanic Blast, Sonic Boom, Carrion Swarm, Spring to Summer, Storm Catcher, Drifting Lotus, Orchid Blossom, Strike a Chord, The Pluck of a String, The Sword Sings, Fey Lights) has no `<Spell>` entry in `Spells.xml`. Pillars (Flame, Sun) and Magus eclipse strikes (Gloomspear, Moon Lance) had stub entries with no `<SpellDamage>`. Net: ~20 Epic Strikes never surfaced in the rotation palette (`if (data.damages.length === 0) continue` drops them). | Added 21 full `<Spell>` entries with damage dice / element / school / metamagic flags / cooldown / MaxCasterLevel pulled from each enhancement's description prose. Each is marked with a `<!-- ddo-builds patch: Epic Strike spell wiring -->` comment. Damage-only — heals / buffs (Healing Pillar, Mending Burst, Consecration, Adrenaline, Guard Up, etc.) and pure physical strikes (Dire Charge, Pin, Shadowstrike, …) are intentionally not wired since they don't fit the spell-damage model. | DDOBuilderV2 doesn't track Epic Strike damage at all (their UI only displays enhancements as enhancements). Our DPS calculator needs proper `<SpellDamage>` data on each strike to surface them in the rotation. |
| All Epic Strike clickies + an explicit allowlist (Hunt's End, Boulder's Might, Conjure Stone, Beguiling Charm) — `scripts/patchEpicStrikes.mjs` | Same shape as Nightmare Lance: `<Clickie/>` enhancement, no upstream `SpellLikeAbility>` wiring. | Run `node scripts/patchEpicStrikes.mjs` after each upstream tree refresh. The script walks every EnhancementSelection / EnhancementTreeItem and inserts a SpellLikeAbility effect when the description contains "Epic Strike" or the name is in `EXTRA_NAMES`. Cost + cooldown are parsed from description prose. | Idempotent (skips entries already wired). Tightly scoped on purpose: blanket-wiring every `<Clickie/>` would inflate the SLA list with passive feature toggles, weapon-attack augments, action boosts (which are charge-limited SLAs to be modeled later), summons, etc. that don't belong in the magic rotation palette. Add new names to `EXTRA_NAMES` as users surface them. |
| `Spells.xml` + `Wizard.class.xml` Past Life: Arcane Initiate | The Past Life: Arcane Initiate feat grants a Magic Missile SLA that caps at **10 missiles** (vs the regular spell's 5) per the feat description. With both wired as the same "Magic Missile" spell, our engine + spell rules conflated them — 5-missile cap, half the projectile count, half the per-cast Magical Ambush triggers. | (1) Add a distinct `<Spell><Name>Arcane Initiate</Name>` entry in `Spells.xml` with the same per-missile dice as Magic Missile. (2) Repoint the `<SpellLikeAbility>` effect in `Wizard.class.xml` from `<Item>Magic Missile</Item>` → `<Item>Arcane Initiate</Item>`. (3) Register a spell rule in `spellRules.ts` for "Arcane Initiate" with the 10-missile cap. | Reference spreadsheet's "Arcane Initiate (base)" row shows 10 hits at CL 20 (vs Magic Missile's 5). The feat description: "For every 2 caster levels beyond first you gain an additional missile, maximum 10 missiles." Per-missile dice match regular MM (1d2+B, B = 3 + floor(CL/2)) — only the cap differs. |
| Engine-side cooldown grouping for Epic Strikes | Epic Strikes share a cooldown pool: firing any one puts every other Epic Strike onto its cooldown. Without grouping the engine treats them as independent CDs and a rotation can spam them in parallel. | `MagicAbility.cooldownGroup = 'epic-strike'` is set in `getMagicAbilities` whenever the SLA's source label matches `Epic Strike\s*→`. `resolveTimeline` and `findFirstAvailableSlot` in `src/engine/dps/timing.ts` track a `groupReady` map and clamp each cast's start time to `max(ownReady, groupReady)`. | Implemented in code, no XML patch required — the destiny trees use a uniform "Epic Strike → ChosenStrike" source pattern that's stable to detect against. |
| `Machrotechnic.tree.xml` (Efficiency Drive), `Alchemist_Apothecary.tree.xml` (Apothecary's Satchel), `Augments/Reaper.Augments.xml` (+3% SP cost reduction reaper ring augment), `Races/DarkBargainer.race.xml` (Form of Pain — 2 sites) | Upstream emits these as `<Type>SpellCostReduction</Type>` (some with a `<Percent/>` flag, some without). The rest of DDOBuilderV2's data uses `<Type>SpellPointCostPercent</Type>` for the same effect — net result: our SP-cost aggregator (which keys off effect type by name) silently ignored these reductions, undercounting the user's effective SP-cost percent. | Renamed `<Type>SpellCostReduction</Type>` → `<Type>SpellPointCostPercent</Type>` and dropped the now-redundant `<Percent/>` flag where present. All five sites are semantically percent reductions per their in-game tooltips, so the rename is safe. | All five descriptions read like percent reductions (e.g. "Spells you cast cost 5% less Spell Points", "+3/6/9% Spell Cost Reduction"). Standardizing on the dominant type name lets the existing aggregator pick them all up via the canonical path. |
| `Spells.xml` Force Missiles `<MaxCasterLevel>` | Upstream catalog had MCL 12 — the legacy DDO cap before the post-Update-78 caster-level expansions. Pure caster classes have CL/MCL 20 baseline in modern DDO; with Epic Knowledge (+5) and Legendary Knowledge (+5) feats this lifts the per-missile dice scaling to CL 30. Engine clamped per-missile dice growth at CL 12, so kemton's Force Missiles cast at CL 27 was using CL 12's dice (8% damage low). | Bumped `<MaxCasterLevel>` from 12 → 20 to match the modern arcane-spell baseline. | In-game observation that arcane spells continue scaling per-missile dice past CL 12 with feat MCL boosts. Missile count is capped at 4 by the spell-rule formula (`1 + floor(CL/4)`, clamped to 4) which already plateaus at CL 12 — so this patch only affects per-missile dice growth, not projectile count. There are ~140 other spells in the catalog with MCL < 20 (cantrips, lower-tier spells); only Force Missiles is patched here since it's the only one verified against in-game behavior so far. |
| `Spells.xml` Death Aura `<MaxCasterLevel>` | Upstream MCL=1 is a stub/typo — the spell scales 2d4 + 1/CL with no nuance noted on the wiki. ddowiki.com/page/Death_Aura confirms "max 2d4+10 at caster level 20" and the Maximum-caster-level table lists Death Aura at MCL 20 (Sorc/Wiz, 4th level, Negative). | Bumped `<MaxCasterLevel>` from 1 → 20. | Wiki cross-checked against the dedicated Death Aura page + the MCL summary table; both agree on 20. The "1" in the upstream catalog is the only outlier. |
| `Spells.xml` Greater Death Aura `<MaxCasterLevel>` | Upstream MCL=10. The description's "max 10" refers to the per-CL bonus damage cap (3d4 + 1/CL up to +10), not the spell-level MCL. ddowiki.com/page/Greater_Death_Aura confirms "max 3d4+10 at caster level 20". | Bumped `<MaxCasterLevel>` from 10 → 20 so per-CL bonus damage continues scaling up to its +10 cap. | The spell description itself indicates the +10 cap is reached at CL 20, not CL 10 — the upstream MCL was conflating the two caps. |
| `Shadowdancer.tree.xml` Dark Imbuement selection (Epic Strike Upgrade I) | Upstream encodes Dark Imbuement with no Doubleshot / Doublestrike effect — only the sibling "Meld into Darkness" selection has the +2% Destiny-typed effect. In-game both selections grant the +2% bonus; only Meld documents it. Verified against the user's zentek build: in-game Doubleshot was 132 with Dark Imbuement picked vs. our 129 (+2 missing on each axis). | Added a `<Effect>` block to the Dark Imbuement `<EnhancementSelection>` matching Meld into Darkness: `<Type>Doublestrike</Type><Type>Doubleshot</Type><Bonus>Destiny</Bonus><Amount>2</Amount>`. The +1 rounding-axis delta the user noted is independent. | Wiki notes the hidden +2% on the Shadowdancer page; DDOBuilderV2's XML only captures it on Meld into Darkness. Both selections share the Epic Strike Upgrade I node so they should have identical passive deltas — only the active proc differs (untyped sneak damage vs dodge cap bypass). |

---

## How to add a new patch

The default is to **edit the XML in `public/data/` directly** and mark
the edit with an inline `<!-- ddo-builds patch: see docs/DATA_PATCHES.md
"<title>" -->` comment so the next person can find context. Then add a
row to the matching table above.

1. Make the change in the appropriate `public/data/` file.
2. Add a `<!-- ddo-builds patch: ... -->` comment immediately above the
   edit. Reference the table heading in `DATA_PATCHES.md`.
3. Add (or update) a table row above. Fill in the Why with whatever
   evidence you have (screenshot path, wiki link, in-game observation).
4. Update snapshots: `npm test -- --run -u`.
5. When upstream fixes the same issue, drop the patch comment + the
   table row and re-snapshot.

### When XML can't express it

A handful of patches still live in code because the engine doesn't
support the upstream encoding directly (e.g. `ITEM_BUFF_PATCHES` for
`.DDOBuild` files we don't own, or the Epic Strike cooldown grouping in
`src/engine/dps/timing.ts`). Keep those tightly scoped and document them
in the table above.
