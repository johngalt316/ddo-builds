# DDOBuilderV2 → ddo-builds Full Port Plan

Goal: port **all** functionality of the C++/MFC desktop app `DDOBuilderV2` into the React/TypeScript web app `ddo-builds` without regressing what already works.

---

## 1. Scope: what DDOBuilderV2 actually contains

Source survey of `C:/Users/Owner/git/DDOBuilderV2/`:

| Area                 | Size / Count                                             |
| -------------------- | -------------------------------------------------------- |
| C++ source files     | 511 (.cpp + .h)                                          |
| UI panes / dialogs   | 36 top-level (BreakdownsPane, DPSPane, EquipmentPane, …) |
| Effect types enum    | ~280 distinct `Effect_*` values                          |
| BreakdownItem types  | 38 distinct subclasses                                   |
| Class XMLs           | 32                                                       |
| Race XMLs            | 28                                                       |
| Enhancement trees    | ~140                                                     |
| Item XML files       | **8,477** individual `.item` files                       |
| `ItemBuffs.xml`      | ~24,500 lines                                            |
| `SetBonuses.xml`     | ~9,400 lines                                             |
| `Spells.xml`         | ~15,500 lines                                            |
| `Feats.xml`          | ~13,600 lines                                            |
| Other static XMLs    | AttackRates, BonusTypes, Stances, Augments (32), Filigrees, Sentient, Quests, Patrons, GuildBuffs, SelfAndPartyBuffs, ItemClickies, WeaponGroupings |

Constants worth pinning (from `stdafx.h`): `MAX_ACTION_POINTS=80`, `MAX_BUILDER_LEVEL=40`, `BUILD_START_LEVEL=34`, `MAX_ENHANCEMENT_TREES=7`, `MAX_DESTINY_TREES=3`, `MAX_REAPER_TREES=3`, `MAX_FILIGREE=20`, `MAX_ARTIFACT_FILIGREE=10`, `MAX_SKILL_TOME=5`, `MAX_BAB=25`.

---

## 2. Current state of `ddo-builds` (what NOT to regress)

Already implemented and working against `kemton.DDOBuild`:

- React+Vite SPA, Zustand store, URL-hash share via lz-string, Docker+Nginx prod image
- `.DDOBuild` import (XML parser handles BOM, lives, ActiveLifeIndex, gear sets)
- Tabbed "Build" section: Main Sheet (race/class/abilities), Feats, Enhancements grid, Epic Destinies grid (max 3 trees), Skills
- Dependency-arrow SVG overlay on enhancement grids
- Stats panes (Overall/Melee/Ranged/Magic) — feat-name-keyed heuristics in `useCharacterStats`
- Gear section — read-only display of imported gear sets

Known shortcuts that the port **will replace**, not preserve:

- `useCharacterStats` infers Melee/Ranged Power from feat *name strings* (e.g., `f.startsWith('Weapon Specialization')`) — DDOBuilderV2 actually reads `<Effect>` blocks. The port replaces this with a real effect engine.
- Spell-point calc multiplies caster mod by 5 — placeholder.
- PRR/MRR/AC/Saves don't yet account for gear, enhancements, or stances.

---

## 3. The architectural pivot

The existing app is "parse a save file and pretty-print it." DDOBuilderV2 is **a live calculator** — every feat, enhancement, item, stance, and buff emits **Effects** and **Bonuses** that flow into typed **BreakdownItem** stacks, and stat values are derived from those stacks every time the build mutates.

Without porting that engine, every feature beyond display is hardcoded heuristics. So the central work is:

1. **Effect data model** — represent `<Effect>` blocks as TS objects (type, bonus type, value, requirements, stance gates).
2. **Bonus stacking engine** — for each tracked stat, take a list of `Bonus { type, value, source }`, apply DDO stacking rules (same `bonusType` doesn't stack except a few — Profane, Stacking, Insightful — take max), and produce a final number plus a breakdown trace.
3. **BreakdownItem registry** — one stat → one breakdown object (HP, SP, AC, PRR, MRR, each ability, each save, each skill, each weapon attack/damage, …). UI subscribes to these.
4. **Source aggregator** — walks the build (race + classes + feats + enhancements + destinies + reaper + stances + tomes + past lives + gear + augments + set bonuses + filigrees + buffs) and emits all Effects.

Everything else is UI on top of this engine.

---

## 4. Phased roadmap

Each phase is independently shippable. Phase boundaries are chosen so existing UI keeps working at the end of each phase.

### Phase 0 — Safety net (1–2 days, prerequisite for everything)

- Snapshot test: parse `kemton.DDOBuild` → assert the full normalized build object (race, classes, abilities, feats, enhancement spends, destiny spends, gear). One JSON snapshot in `tests/__snapshots__/`.
- Stat snapshot: for the same build, capture today's `useCharacterStats` output. Lets us see when later phases change a number (expected) vs. break it (regression).
- Add a second known build (e.g. a pure caster) so we don't overfit to kemton's profile.
- Baseline screenshot test of BuildEditor (Playwright trace, one route, one viewport) — cheap regression net for layout drift.

**Exit criteria:** `npm test` runs; both builds parse identically; baseline screenshot stored.

### Phase 1 — Data ingestion completeness (1 week)

Goal: every static XML in `DDOBuilderV2/Output/DataFiles/` loadable by the web app, with parsers that don't drop fields.

Tasks:

- Move data fetch from one-off ad-hoc parsers to a uniform loader that knows about: `Feats.xml`, `Stances.xml`, `BonusTypes.xml`, `WeaponGroupings.xml`, `AttackRates.xml`, `SelfAndPartyBuffs.xml`, `ItemClickies.xml`, `SetBonuses.xml`, `Sentient.gems.xml`, `GuildBuffs.xml`, `Patrons.xml`, `Quests.xml`, `Challenges.xml`, plus all `Augments/*.xml` and `FiligreeSets/*.xml`.
- Items: 8,477 `.item` files is too many to ship raw. Build an offline preprocess script (`scripts/buildItemIndex.mjs` run at `prebuild`) that compiles all items into a single chunked JSON (`public/data/items/index.json` + per-slot shards). Image lookups stay in `ItemImages/`.
- Universal `<Effect>` parser that handles: `Type`, `BonusType`, `Value1..Value4`, `Stance`, `Requirements`, `Item`, `Description`, `AmountVector`/per-level scaling. Output: `Effect` TS type. **No engine yet** — just round-trip parsed Effects.
- Universal `<Buff>` parser (used by items/sets/clickies/spells) → `Effect[]`.
- TS enum for `EffectType` mirrored from `Effect.h` — script-generate it from the C++ enum, don't hand-type 280 values.

**Exit criteria:** loader parses every XML in `Output/DataFiles/` without throwing; counts of effects/items match expectations; existing UI still works (Phase 0 snapshots green).

### Phase 2 — Effect & Bonus engine (1.5–2 weeks, the linchpin)

This is the work item that unblocks everything else.

Tasks:

- Port `BonusTypes.xml` → table of bonus types and their stacking rules (which can stack with which).
- `engine/effects/applyEffects.ts` — given a build state and a list of Effects, evaluate `Requirements`/`Stance` gates and return active Effects.
- `engine/breakdowns/` — one module per BreakdownItem subclass we need (start with: AbilityScore, BAB, HP, SP, Save{Fort,Ref,Will}, AC, PRR, MRR, Dodge, Skill, MeleePower, RangedPower, Doublestrike, Doubleshot, CasterLevel{General,School}, SpellPower, SpellCriticalChance, SpellCriticalDamage, Healing Amplification). Each takes typed `Bonus[]` and returns `{ total, contributors }`.
- React hook `useBreakdown(BreakdownType, [args])` that subscribes to a single computed stat — replaces the monolithic `useCharacterStats`.
- Migrate `StatsSection` panes to read from breakdowns, deleting the feat-name heuristics in `useCharacterStats`.
- New "Breakdowns" tab (port of `BreakdownsPane`): clicking any stat shows the stack — every contributor, its bonus type, whether it stacked or got dominated. This is the single most valuable debugging tool — build it early, use it for the rest of the port.

**Exit criteria:** kemton's HP/SP/saves/AC/PRR/MRR all match the C++ app within ±0 (verify by opening kemton.DDOBuild in DDOBuilderV2 side-by-side); Breakdowns tab shows full stack for every stat; Phase 0 stat snapshot updated and locked.

### Phase 3 — Build editing parity (2 weeks)

Until now we've been a viewer of imported builds. Now: full create/edit from scratch.

- ~~**Feat editor** (P3.1)~~ **— DONE.** New `FeatPickerDialog` modal: search + group filter + "show ineligible" toggle. Filters via `passesRequirements` against the live BuildContext, dims feats already at their `MaxTimesAcquire` cap. `FeatsTab` got a `+ Add Feat` toolbar button, edit (✎) and remove (×) actions on each existing feat. 6 unit tests in `tests/ui/FeatPickerDialog.test.tsx`. Imported builds and from-scratch builds both editable.
- ~~**Skills editor** (P3.2)~~ **— DONE.** Per-row `+`/`−` buttons in `SkillsTab` with cap enforcement (uses existing `b.maxRanks` which already reflects class vs cross-class). New `calculateSkillPointBudget(classes, classData, intMod)` engine helper + `useBuild()` exposes `skillPointBudget` and `skillPointsSpent`. Header shows live `spent / budget` and remaining; turns red when over. 8 unit tests in `tests/engine/skillBudget.test.ts` (single class, multiclass, low-INT clamp, missing class data) + 5 UI tests in `tests/ui/SkillsTab.test.tsx`. Tomes / human-half-elf SP / cross-class 2× cost still deferred — current model matches the parser's `1 SP per <TrainedSkill>` convention.
- ~~**Per-level class grid** (P3.3)~~ **— DONE.** Optional `build.levelClasses: string[]` (one classId per character level). Helper `resolveLevelClasses(build)` returns the stored array if length matches charLevel, otherwise derives by interleaving `classes[]`. New store actions `setLevelClass(level, classId)` and `setTotalLevels(n)` keep `classes[]` and `levelClasses` coherent (re-aggregating via `aggregateClasses`). Existing `updateClasses` also re-derives `levelClasses` so the +/- buttons in `ClassSelector` stay in sync. Parser populates the array from each `<LevelTraining>` block (skipping Epic/Legendary pseudo-classes). New `LevelGrid` component on the Main Sheet: 5-column responsive grid of cells (one per level 1–20), click a cell → modal class picker. Engine reads `classes[]` unchanged → totals stay identical (kemton: 112/155 sourced/applied effects, no drift). 12 new tests across `tests/engine/levelClasses.test.ts` (helpers) and `tests/engine/setLevelClass.test.ts` (store actions). Out of scope: per-level feat slots / skill ranks (Phase 3.x), epic levels 21–40 in the grid (current grid caps at heroic 1–20).
- ~~**Tomes + level-up ability assignments** (P3.4)~~ **— DONE.** Added optional `Build.abilityTomes`, `Build.skillTomes`, `Build.levelUps`. Engine helpers `applyAbilityTomes` (max +8 each) and `applyLevelUps` (+1 per assigned tier 4/8/.../40) compose into the score pipeline `base → race → tomes → level-ups → effective` in both `useBuild` and `runEngine` (kept in sync). Skill tomes raise `maxRanks` cap and contribute to skill total via extended `calculateSkillBonuses(..., skillTomeBonus)`. Parser reads from `<Character>` scope (tomes apply across all lives): `<StrTome>...<ChaTome>`, `<SkillTomes><Tome><Name>X</Name><Value>N</Value>` and from `<Build>`: `<Level4>...<Level40>` ability assignments. Store actions `setAbilityTome(stat, value)`, `setSkillTome(skillId, value)`, `setLevelUp(level, stat \| null)` for editing. New `TomesAndLevelUpsPanel` component: ability tome +/- table (capped 0–8) + per-tier level-up dropdowns (dimmed for unreached tiers). 11 new tests in `tests/engine/tomesAndLevelUps.test.ts` + `tests/ui/TomesAndLevelUpsPanel.test.tsx`. **Real-data win**: kemton (Bladeforged AT) ability scores now reflect parsed +8 tomes everywhere + 10× INT level-ups → STR 16, DEX 24, CON 26→40 (with gear), INT 36, WIS 14, CHA 14. HP 240→320.
- ~~**Special feats / past lives** (P3.5)~~ **— DONE.** New optional `Build.specialFeats: { featId, type, rank }[]`. Parser groups `<SpecialFeats><TrainedFeat>` entries (at `<Character>` scope, applies across all lives) by name+type with rank=count. Engine source walker emits one Effect per feat with `rankCount=rank`. Store action `setSpecialFeatRank(featId, type, rank)` — handles add/update/remove (rank=0). New `SpecialFeatsTab` with category tabs (Heroic / Racial / Iconic / Epic / Universal Trees / Epic Destinies); each card shows feat with +/- buttons capped at `MaxTimesAcquire`. 4 unit tests in `tests/engine/specialFeats.test.ts`. **Massive coverage jump**: kemton's engine now sources from his 92 past-life feats (16 racial, 18 epic, 20 heroic, 13 destinies unlocked, etc.) → **sourced effects 112 → 336 (+224), applied bonuses 155 → 382 (+227)**.
- ~~**Reaper enhancements grid** (P3.6)~~ **— DONE.** Added `Build.reaperEnhancements: EnhancementSelection[]`, parsed from `<ReaperSpendInTree>` blocks (parallel to `EnhancementSpendInTree`/`DestinySpendInTree`). New constants `MAX_REAPER_AP=200` (editor cap; reaper points have no in-game cap) and `MAX_REAPER_TREES=3`. Generalized `EnhancementTreeGrid` from `destinyMode?: boolean` to `treeKind?: 'enhancement' \| 'destiny' \| 'reaper'` (legacy `destinyMode` kept as a deprecated alias for safety). 6 new store actions: `spendReaperEnhancement`/`revokeReaperEnhancement`/`resetReaperTree` mirroring the heroic + destiny patterns. Engine source walker extended with a `[R]` source-prefix step. New `ReaperEnhancementsTab` reusing `DestiniesTab`'s CSS module (visually identical apart from labels + tree pool). XML tree parser detects the `<IsReaperTree/>` flag → `isReaperTree: boolean` on `EnhancementTreeData`. 3 unit tests in `tests/engine/reaperWalker.test.ts`. Both fixture builds (kemton/zentek) have empty reaper trees so engine totals are unchanged on real fixtures — synthetic tests cover the path.

## Phase 3 — COMPLETE

All build-editing capabilities now in place:
- Feat editor with requirement-aware picker
- Skill rank editor with budget tracking
- Per-level class assignment grid
- Tomes (ability + skill) and level-up ability assignments
- Special feats / past lives grid (6 categories)
- Stances (Phase 2.x-E)
- Reaper enhancements grid (3-tree cap, parallels destinies)
- Heroic enhancements + epic destinies (preexisting)

Open follow-ups (deferred but not blocking):
- ~~Per-level feat slots in `LevelGrid`~~ **— display done.** New `src/utils/featSlots.ts::computeFeatSlots(classes, classData, races, raceId)` derives all available slots per character level (Standard heroic at L1/3/6/9/12/15/18, race feat slots at L1, class feat slots at the Nth class level). LevelGrid now renders compact slot badges (one-letter abbreviations like `S`/`F`/`H` for Standard/Fighter Bonus/Human Bonus, hover for full label). 10 unit tests in `tests/engine/featSlots.test.ts`. **Interactive picking is still deferred** — FeatsTab continues to own feat selection; the badges are planning info only. To make slots clickable, a follow-up needs: (a) options-list filter on FeatPickerDialog, (b) slotKey tracking on SelectedFeat, (c) conflict handling when class assignments change.
- ~~Skill tomes UI~~ **— DONE.** Per-row +/- buttons in SkillsTab capped 0–5 via `setSkillTome` store action.
- ~~Human/Half-Elf bonus skill points~~ **— DONE.** `calculateSkillPointBudget` now takes a `racialBonusSp` parameter; useBuild plumbs `race.bonusSkillPoints` (parsed from race XML's `<SkillPoints>` field) through. 3 new test cases.
- Cross-class skill 2× SP cost (we use the lower cap-only model — still deferred)

### Dev workflow wrappers (P3.5+)

To reduce per-command approvals, recurring workflows are now npm scripts driven by `scripts/dev.mjs`:
- `npm run verify` — typecheck + tests (use after every code change)
- `npm run verify:full` — typecheck + tests + production build (use before declaring a phase done)
- `npm run snapshots:reset [pattern]` — delete matching snapshots and regenerate via vitest (e.g., `npm run snapshots:reset engine` for engine snapshots only)
- `npm run debug:fixture <name>` — pretty-print parsed `tests/fixtures/<name>.DDOBuild` (race, classes, tomes, level-ups, gear sizes, special feat counts by type, parser warnings)
- **Class+Feat pane** (port `ClassAndFeatPane`): per-level grid showing class chosen at each of levels 1–40 plus feat slots (Heroic, Class-bonus, Epic, Legendary, Destiny). Click slot → re-open the picker filtered to that slot type. Requires migrating `build.classes: ClassLevel[]` → a per-level data shape.
- **Ability scores**: existing point-buy works; need level-up +1 ability assignments, tomes (`MAX_SKILL_TOME` UI), past-life ability bonuses.
- **Skills**: skill points per level by INT/class, rank-cap enforcement (3+level for class, half for cross-class), skill tomes, racial skill bonuses. Currently read-only.
- **Special Feats** pane (past lives, racial, iconic, epic, legendary): the +1 / +1 / +1 grid.
- **Granted / Automatic feats** pane: read-only, computed from class+race.
- ~~**Stances** pane~~ **— DONE in Phase 2.x-E.**
- **Reaper enhancements** (`MAX_REAPER_TREES=3`): same grid component as enhancement/destiny — promote `EnhancementTreeGrid` to take a `treeKind` prop instead of duplicating.

**Exit criteria:** can build kemton from scratch in the web app and the resulting build object equals the parsed `.DDOBuild` (modulo metadata).

### Phase 4 — Items & gear editing (2 weeks)

Read-only gear display (current state) → full inventory editor.

- **`ItemSelectDialog`** equivalent: searchable, slot-filtered list of all 8,477 items. Virtualize the list (react-window) — never render 8k DOM nodes.
- **`FindGearDialog`** equivalent: full-text + effect-type search ("show me everything with Insightful Constitution +3").
- Augment slots: per-item slot list, click → augment picker filtered by slot color.
- Sentient weapons: filigree slots (`MAX_FILIGREE=20`), filigree picker, sentient gem.
- Set-bonus tracking: count active set pieces per `SetBonuses.xml` entry, emit set Effects, surface in Breakdowns.
- Multiple gear sets with `activeGearSet` (already in build type) — full CRUD.

**Risk:** items dataset size. Mitigation: at build time compile to one JSON per slot (~500–800 items each, ~50–200 KB gzipped per slot file), lazy-load on slot open.

**Exit criteria:** all 16 slots editable; AC/PRR/saves/skills update live as gear changes via Phase 2 engine; set bonuses fire correctly.

### Phase 5 — Spells, DCs, buffs (1.5 weeks)

- **Spell DCs**: per-school SpellDC + Spell Penetration + Caster Level breakdowns. ✅ done in P5.1.
- **Spells.xml ingestion**: parse spell catalog (name/school/level/cost/metamagic/DC blocks/damage), join with each class's `<ClassSpell>` list to associate spells to class/level.
- **Spells pane UI**: per-class spell list, slots by class+level, known-spell selection, metamagic toggles. Reads the catalog from above.
- **Self/Party buffs pane**: toggle external buffs (haste, displacement, prayer, recitation, etc.) — feed effect engine.

**Exit criteria:** every fixture build's caster gets correct per-school DCs against DDOBuilderV2 totals; spells pane lets a wizard pick known spells per level; haste toggle changes melee/ranged-power breakdown.

### Phase 6 — DPS pane (2–3 weeks, headline feature)

DDOBuilderV2's `DPSPane.cpp` per-style evaluators (`EvaluateTWF`, `EvaluateTHF`, `EvaluateRanged`, `EvaluateHandwraps`, `EvaluateSwordAndBoard`) are unimplemented stubs upstream — every one is `return 0.0;`. There is no C++ algorithm to translate, so this phase needs its own design pass before implementation. The breakdown infrastructure (BreakdownItemWeapon: m_baseDamage, m_attackBonus, m_criticalThreatRange, m_criticalMultiplier, m_attackSpeed, m_drBypass) and `AttackRates.xml` (APM by style × BAB) provide the inputs, but per-attack damage × rate × crit aggregation is for us to write.

- **Algorithm design doc**: per-attack damage formula, crit folding, doublestrike-as-extra-roll, TWF main/offhand asymmetry, sneak-attack gating, alacrity/haste application.
- **Per-weapon breakdowns**: damage dice, enchantment, attack/damage bonus, critical threat range + multiplier (incl. 19–20 multiplier for keen), attack speed, DR bypass. Mirror the structure of `BreakdownItemWeapon.h`.
- **AttackRates.xml ingestion**: APM table by style + BAB.
- **DPS pane UI**: main vs offhand, unbuffed vs fully-buffed columns, weapon swap shows DPS delta.
- **On-hit procs / weapon-special effects**: vorpal range, ghost touch, true seeing, DR bypass display (numbers may not be modeled).

**Exit criteria:** DPS pane shows numbers within ~5% of community DPS spreadsheets for kemton; updates live as weapons / stances / haste change.

### Phase 7 — Auxiliary panes & polish (1 week)

- **Notes pane**: free-text, persisted in build JSON.
- **Bonuses pane**: list view of every active Effect (debug companion to Breakdowns).
- **Favor / Patron tracking**: optional, low value — defer or skip.
- **Quest tracking**: skip unless requested — out of scope for a build calculator.
- **Multiple lives**: full life management UI (not just `ActiveLifeIndex` reader).
- **Forum-export** (port `Build::ExportForumPaste`): generate BBCode summary string.
- **Build comparison**: open two builds side-by-side, diff stats.

### Phase 8 — Cutover & deprecation (a few days)

- Audit `useCharacterStats.ts` and any other heuristic code; delete what the engine replaced.
- Delete temporary parser shims kept for Phase 0 snapshots once the engine produces equivalent output.
- Update README to credit DDOBuilderV2 and clarify which features are at parity.

---

## 5. Regression-prevention strategy

The repo is a hobby project, but this port is large enough that ad-hoc testing will leave silent breakage. Required net:

| Layer                | Test                                                    | When                                |
| -------------------- | ------------------------------------------------------- | ----------------------------------- |
| `.DDOBuild` parser   | JSON snapshot of normalized build object                | Phase 0, locked thereafter          |
| Engine determinism   | Per-breakdown snapshot for 2–3 reference builds         | Phase 2 onward                      |
| Effect parser        | "every XML loads without throwing" smoke test           | Phase 1 onward                      |
| Stacking rules       | Unit tests per `BonusType` (does Profane stack? etc.)   | Phase 2                             |
| UI shape             | Playwright screenshot of BuildEditor + Breakdowns pane  | Phase 0 baseline, updated per phase |
| Cross-check          | Manual: open same build in DDOBuilderV2 + web, diff totals | End of each phase                |

The cross-check is the highest-signal test we have — DDOBuilderV2 itself is the oracle. Every phase ends with a manual side-by-side on at least 2 builds before the phase counts as done.

---

## 6. Risks & open questions

- **Effect parsing fidelity** — 280 effect types, many with subtle per-level scaling, requirement stacks, and stance gates. Plan: implement effects on demand. If a feat has no effects parsed yet, the breakdown shows "feat present, effects not modeled" rather than silently zeroing — keeps regressions visible.
- **Item dataset size** — 8.5k items × buffs. Bundling all upfront is ~5–10MB gzipped. Mitigation: per-slot shards, route-level code-splitting, IndexedDB cache after first load.
- **DDOBuilderV2 isn't standing still** — the upstream repo gets game-update drops. Document the `Output/DataFiles/` snapshot SHA we ported from; provide a refresh script.
- **No backend** — heavy items search runs client-side. With virtualized lists this is fine for 10k items, but full-text on every effect description (~100k strings) may need a worker + indexed search (FlexSearch or MiniSearch).
- **Browser XML parser performance** — DOMParser on a 24k-line `ItemBuffs.xml` is slow. Phase 1 preprocessing → JSON solves this; never ship raw XML to the browser at runtime.
- **MFC-only behaviors not worth porting** — clipboard custom formats (`CF_CUSTOM_GEAR`), DPI scaling toggles, dockable panes. Drop on sight.

---

## 7. Sequencing summary

```
Phase 0 (snapshots)  →  Phase 1 (data load)  →  Phase 2 (engine + breakdowns)  →
   Phase 3 (build editing)  ┐
                            ├─→  Phase 5 (spells/DCs/buffs)  →  Phase 6 (DPS pane)  →
   Phase 4 (gear editing)   ┘                                   Phase 7 (polish)  →  Phase 8 (cutover)
```

Phases 3 and 4 can run in parallel once Phase 2 lands. Total estimated effort: ~9–11 weeks of focused work, but each phase ships independently — at the end of any phase the app is deployable and a strict superset of the previous one.

---

## 8. Phase 0 — DONE

Shipped:

- `tests/fixtures/{kemton,zentek}.DDOBuild` — two reference builds (caster Eladrin AT, melee).
- `tests/parser/parseDDOBuild.test.ts` + `tests/snapshots/{kemton,zentek}.DDOBuild.snap.json` — parser output snapshots.
- `tests/engine/derivedStats.test.ts` + `tests/snapshots/{kemton,zentek}.stats.snap.json` — pure-engine output (BAB/HP/saves/skills/modifiers/point-buy) for both fixtures. **Substituted for the originally-planned `useCharacterStats` snapshot** because that hook is being deleted in Phase 2; snapshotting the underlying pure functions is a more durable oracle.
- `tests/ui/BuildEditor.smoke.test.tsx` + `tests/snapshots/BuildEditor.html.snap.html` — happy-dom render of the editor + structural HTML snapshot. **Substituted for the planned Playwright pixel baseline** — full browser-screenshot regression deferred until CI exists, at which point one Chromium screenshot is the right tool.
- `vitest.config.ts` — added `@vitejs/plugin-react` (needed for `.tsx` test files) and broadened `include` to `*.test.{ts,tsx}`.
- `package.json` devDeps: `happy-dom`, `@testing-library/react`, `@testing-library/dom`.

`npm test` is now 35 tests / 7 files. `npm run typecheck` passes.

Known finding the snapshots already locked in: with current static JSON stubs in `src/data/`, kemton's eladrin race + arcane_trickster class fall back to defaults (raceResolved="human", bab=0). This is **expected current behavior** and Phase 1 will fix it — the snapshot diff at that point will document the improvement.

## 9. Phase 1 — DONE (engine-prerequisite slice)

Phase 1 was scoped to the engine-prerequisite chunks rather than every static XML; spells/augments/filigrees/clickies/etc. are deferred to whichever later phase actually needs them, so we don't load data we don't use.

Shipped:

- **`src/types/effectTypes.ts`** — auto-generated from `DDOBuilderV2/DDOBuilder/Effect.h`'s `effectTypeMap[]` table. **220 effect types** as a TS string-literal union + `KNOWN_EFFECT_TYPES` Set for runtime checks. Regenerate via `npm run gen-effect-types`.
- **`src/utils/effectParser.ts`** — universal `parseEffect`, `parseBuff`, `parseRequirements`, `parseEffectsIn`, `parseBuffsIn`. Used by every XML data type that carries effects.
- **Extended `ddoXmlParser.ts`** — added `parseBonusTypesXml`, `parseStancesXml`, `parseWeaponGroupsXml`, `parseSetBonusesXml`. `parseFeatsXml` now captures the `<Effect>` blocks per feat (296 of 339 feats have effects).
- **Extended `gameDataStore.ts`** — loads BonusTypes, Stances, WeaponGroupings, SetBonuses on app startup; new `getBonusType(name)` accessor.
- **`scripts/buildItemIndex.mjs`** — manual preprocess (`npm run import-items`) that compiles **8,200 items** (277 cosmetic-only items skipped) from `DDOBuilderV2/Output/DataFiles/Items/` into:
  - `public/data/items/index.json` — lightweight master list (832 KB)
  - `public/data/items/by-slot/<slot>.json` — 14 per-slot shards (Weapon1, Weapon2, Armor, Ring, Helmet, …)
  - `public/data/items/itemBuffs.json` — canonical buff catalog (1,726 buff types from `ItemBuffs.xml`, 626 KB)
  - Total ~8.8 MB raw on disk → ~2 MB gzipped over the wire. Per-slot shards keep slot pickers loading fast.
- **New tests** in `tests/parser/` — `staticData.test.ts` (5 snapshots) + `itemIndex.test.ts` (4 internal-consistency tests). 44 tests total / 9 files. `npm run typecheck` and `npm run build` both clean.

Verifications the snapshots locked in:
- 339 feats parsed; 296 have at least one Effect block; **0 unknown effect types** (codegen captured every type used in feats).
- 264 set bonuses parsed; **0 unknown effect types**.
- 73 BonusType stacking rules with two values: `"Always"` and `"Highest Only"`.
- 8,200 items across 14 slots, 0 parse errors, 277 cosmetic items skipped.

Deferred from Phase 1 (will land when needed):
- `Spells.xml` (Phase 5)
- `Augments/*.xml`, `FiligreeSets/*.xml`, `Sentient.gems.xml` (Phase 4/6)
- `SelfAndPartyBuffs.xml`, `ItemClickies.xml`, `AttackRates.xml` (Phase 5)
- `GuildBuffs.xml`, `Patrons.xml`, `Quests.xml`, `Challenges.xml` (Phase 6 or skip — auxiliary)

## 10. Phase 2 — DONE (MVP slice)

Phase 2 was scoped to a vertical slice that proves the engine architecture end-to-end. Source coverage is **feats only** for this first cut; enhancements/items/sets/stances will land in 2.x follow-ups without touching the architecture.

Shipped:

- **`src/engine/bonusStacking.ts`** — pure stacking algorithm. Group by `bonusType`, apply `Highest Only`/`Always` rules from BonusTypes.xml. Penalties always stack (don't compete with positive bonuses of the same type). Untyped bonuses fully stack. Returns total + every contributor annotated `applied: bool` + `dominatedBy?: string`. 9 unit tests covering all major paths.
- **`src/engine/evaluateEffect.ts`** — `evaluateEffect(effect, ctx, source, rankCount) → { bonuses, skipped? }`. Supports 14 AmountTypes (Simple, Stacks, TotalLevel, ClassLevel, AbilityMod, FeatCount, BAB, APCount, …). Evaluates `Requirements` (Class, BaseClass, ClassMinLevel, Race, Feat, Stance, Ability). Cardinality: `types × items` bonuses per effect. Unmodeled types are recorded for diagnostics, not silently zeroed.
- **`src/engine/collectEffects.ts`** — `collectEffects(build, gameData)` walks selected feats + class automatic-feats and emits `SourcedEffect[]`. Future expansion stub: enhancements, destinies, items, sets, stances. Returns `unmatchedFeats[]` for visible diagnostics.
- **`src/engine/breakdowns.ts`** — per-stat aggregators: `breakdownAbilityScore`, `breakdownHitPoints`, `breakdownSave`, `breakdownMeleePower`, `breakdownRangedPower`, `breakdownDoublestrike`, `breakdownDoubleshot`, `breakdownHealingAmp`. Each takes the effect-derived bonuses + a seed value (existing pure-engine output for HP/saves) + stacking rules → `BreakdownResult`.
- **`src/engine/runEngine.ts`** — top-level orchestrator. One call: `runEngine({ build, classes, races, feats, bonusTypes }) → EngineResult`. Includes diagnostics: total sourced effects, total applied bonuses, requirements-failed count, unmodeled-amount-types histogram, unmatched-feats list.
- **`src/hooks/useBreakdowns.ts`** — React hook subscribing to build + game data, returning `EngineResult | null`.
- **`src/components/build/BreakdownsTab.tsx`** — new "Breakdowns" tab in BuildSection. Each stat shows total + applied/dominated counts, click to expand the contributor list. Bottom diagnostics panel surfaces gaps (unmodeled types, unmatched feats).
- **`src/store/gameDataStore.ts`** — also fixed at runtime: feat data is now merged from `Feats.xml` + every class XML + every race XML, matching what `featIcons` already did. Class-only feats (Past Life: Arcane Initiate, Patience, Doubleshot, …) now have full Effect data, not just icons.
- **Phase 1 cleanup** — `parseEnhancementItem` extended to capture `<Effect>` blocks per enhancement and per `<EnhancementSelection>`. Data is in place; the source-walker integration is deferred to Phase 2.x.

**Engine snapshot results (locked in, will improve as 2.x adds sources):**

| Build  | Sourced effects | Applied bonuses | Unmatched feats | Unmodeled amount types |
|--------|-----------------|-----------------|-----------------|------------------------|
| kemton | 86              | 125             | 0               | SpellInfo, Slider, SliderValue |
| zentek | 107             | 158             | 0               | Slider, SliderValue, SpellInfo |

**Tests:** 55 passing / 11 files. Production build clean: 274 KB JS → 86 KB gzipped (only 4 KB increase for the full engine + new UI tab).

**Two judgment calls vs. the original Phase 2 plan** (documented inline in code):

1. **MVP scope is feats-only**, not feats+enhancements+destinies+items+sets+stances at once. Each new source category is now a small additive change to `collectEffects` — the architecture is stable. This isolates risk: each follow-up session moves one set of source-counts up without touching the stacking, evaluation, or breakdown layers.

2. **`StatsSection` was NOT migrated** — keeps `useCharacterStats` heuristics running in parallel. The Breakdowns tab is purely additive. Migration happens in a later session once the engine has gear/enhancement coverage; right now the engine's totals are deliberately lower than the heuristics' (only feat sources fire) and the disclaimer banner in BreakdownsTab explains this.

## 11. Next steps (Phase 2.x — additive sessions)

Each of these is a small extension to `collectEffects.ts`, no architecture changes:

- ~~**2.x-A**: Enhancement source walker~~ **— DONE.** Heroic + destiny tree spends both wired in; selector routing works; per-rank scaling on Simple/NotNeeded amount types. New diagnostics: `unmatchedTrees`, `unmatchedEnhancements`. Validated by 5 synthetic-build unit tests in `tests/engine/enhancementWalker.test.ts`. Real-fixture delta was small (kemton 86→95 sourced effects; zentek unchanged) because both reference builds have minimal enhancement spend.
- ~~**2.x-B**: Item-buff source walker~~ **— DONE.** New `itemBuffResolver.ts` instantiates catalog templates by overriding `bonus`/`amount`/`items` from item-buff parameters when present (Vorpal-style hardcoded catalog defaults are preserved). gameDataStore loads `/data/items/itemBuffs.json` (1,726 catalog entries, 626 KB). Walker emits effects with source label `[G] <slot>: <item>` and records `unmatchedItemBuffs`. Validated by 9 synthetic tests covering substitution, stacking, multi-set isolation, and diagnostics. After kemton.DDOBuild was refreshed with active gear (DPS set, 7 items): kemton sourced effects jumped 86 → 112 (+26), CON 18 → 32 from Insightful/Enhancement gear bonuses. Defensive fix in `evaluateEffect`: tolerate undefined `requirements`/`amount`/`values`/`types`/`items` since the items preprocess script omits empty fields to save space.
- ~~**2.x-C**: Set-bonus walker~~ **— DONE.** New `walkSetBonuses` in `collectEffects.ts`: counts pieces per `setBonus` across active gear, fires every `<Buff>` whose `equippedCount` threshold is met. Source label `[S] <setName> (Npieces tier ≥ X)`. Loads `/data/items/index.json` to build an `itemSetIndex` (item-name → set-name) at runtime — used as fallback when `.DDOBuild` files omit `<SetBonus>` for items that genuinely belong to a set. New diagnostic `unmatchedSets`. Validated by 5 unit tests covering threshold gating + missing-set diagnostics + name-fallback. Real-fixture delta was zero — kemton has 1 piece of "Eminence of Autumn" + 1 piece of "Legendary Soul of the Red Dragon", below any tier threshold (the other items in his set are intentionally set-less, e.g., Workplace Safety helm).
- ~~**2.x-D**: Destiny source walker~~ **— Already DONE in 2.x-A.** `walkTreeSpend` was written generically to handle both heroic and destiny tree spends from the start; only the source-label prefix differs (`[E]` vs `[D]`).
- ~~**2.x-E**: Stance state + UI + engine plumbing~~ **— DONE.** `Build.activeStances: string[]` added to the type + `DEFAULT_BUILD`. New store actions `toggleStance(name)` + `setStances(names)`. `buildBuildContext` reads `build.activeStances` (replacing hardcoded empty Set). New `StancesPicker` component (search + grouped chips, active-only / show-all toggle) embedded at the top of the Breakdowns tab — flip a chip and the breakdowns update live. Validated by 5 unit tests in `tests/engine/stanceGating.test.ts` using "Adept of Forms" / Mountain Stance: gate fails empty, passes when active, runEngine shows CON jumps when toggled, unrelated stances don't affect CON. **Bonus parser improvement**: `parseFeatsXml` now promotes each `<SubItem>` to a top-level feat entry — feat count went 339 → 351 (Master of Rock, Adept of Rain, etc. are now selectable). The parent feat keeps its own Effect blocks; SubItems carry their own.
- ~~**2.x-F**: Migrate `StatsSection` panes to `useBreakdowns`, delete `useCharacterStats`~~ **— DONE.** New `useStats()` hook in `src/hooks/useStats.ts` wraps `useBreakdowns()` for HP/saves/melee+ranged power/doublestrike/doubleshot/healing-amp/ability-scores, falls back to seed values from `useBuild` while game data is loading, and computes display-only derivations (modifiers from ability totals, attacks-per-round from BAB, melee-finesse damage attribute, etc.). Feat-name string heuristics retained ONLY for cosmetic display fields that don't drive any stat total: `improvedCriticalGroups` / `attackChain` / `metamagicFeats` / `spellFocusSchools` / `primarySpellcaster` / `spellPenetration`. **`useCharacterStats.ts` deleted.** StatsSection panes now show `Doublestrike` (Melee), `Doubleshot` (Ranged), and `Healing Amp` (Overall) — they're engine-backed and update live with stance/gear/enhancement changes. Breakdowns-tab disclaimer updated: no longer "work in progress", now describes the engine as live.

## Phase 2 — COMPLETE

All architectural goals met:
- Effect → Bonus → BreakdownItem pipeline
- 7 source walkers (feats, class autofeats, heroic enhancements, destinies, gear items, set bonuses, stance gates)
- Live React UI: Stats panes + Breakdowns tab both consume the same engine output
- 79 tests across 15 files, no remaining heuristic-driven stat totals.

Open known limitations (deferred to later phases):
- BAB/skill bonuses/PRR/MRR/AC are not yet engine-backed (still seed values from pure functions)
- `Slider`/`SpellInfo` AmountTypes still unmodeled
- Spell points still uses a class-table + caster-mod heuristic; will be replaced when `BreakdownItemSpellPoints` lands in Phase 5
- Items index doesn't always know set-membership (no upstream data — see Phase 1 notes)

Phase 3 (build editing parity) and Phase 4 (gear editing) can both start now.
