# DDO Builds

A hobby build calculator for **Dungeons and Dragons Online** (DDO). Plan a character — race, multiclass splits, ability scores, feats, skills, enhancement trees, epic destinies, reaper points, gear, augments, filigrees, stances, party buffs — then share the result with a URL or import a `.DDOBuild` file from the desktop tool.

It's a TypeScript port of [Maetrim's DDOBuilderV2](https://github.com/Maetrim/DDOBuilderV2) (C++/MFC desktop app), running in the browser.

**Live site:** [https://ddo-builds.com](https://ddo-builds.com) — deployed on Cloudflare Workers, auto-redeploys on push to `master`.

---

## What it does

- **Character editor** — race, alignment, per-level class assignment (3-class heroic split + Epic / Legendary post-20 levels), 32-point buy, tomes, level-ups, heroic / racial / iconic / epic past-life ranks, completionist eligibility.
- **Trees** — heroic enhancements, epic destinies, reaper points, racial trees, universal trees. Selector enhancements, multi-rank costs, and AP-pool overflow (racial → universal → standard) all modeled.
- **Feats & skills** — slot-aware feat picker, class-skill detection, skill-point budget calculator, automatic-acquisition feats (Heroic Durability, IHD per heroic class).
- **Gear** — multiple gear sets, slot-by-slot item picker (8,200+ items), augment slots, filigree slots, set-bonus tier tracking, sentient-weapon set bonuses.
- **Stances & buffs** — stance picker, self/party buff list, guild-level-gated guild buffs, spell mantles.
- **Spells & SLAs** — per-class spell-slot allocation, feat- / enhancement- / destiny-granted spell-like abilities.
- **Live breakdowns** — every stat shows source-by-source contributors with applied/dominated stacking; percent buffs render as `+X% (+Y)` so the actual flat delta is visible.
- **Build sharing & import** — full state encoded in the URL via lz-string; or drag-drop a `.DDOBuild` file from the desktop app.
- **Self-hostable** — Cloudflare Workers in production, Docker Compose for local prod preview.

---

## Architecture

The codebase is three layers: **data** (XML on disk, parsed into Zustand catalogs), **engine** (pure TypeScript that turns a build state + the catalogs into per-stat breakdowns), and **UI** (React, reads engine output via hooks, writes build state through Zustand actions). Routing is React Router; the build editor is a single page with tabs.

```
                     ┌──────────────────────────┐
public/data/*.xml ──▶│ src/utils/ddoXmlParser   │──▶ gameDataStore (Zustand)
                     └──────────────────────────┘            │
                                                             │
                     ┌──────────────────────────┐            │
.DDOBuild file    ──▶│ src/utils/ddoBuildParser │──▶ buildStore (Zustand)
                     └──────────────────────────┘            │
                                                             ▼
                                              ┌──────────────────────────┐
                                              │   src/engine/runEngine   │
                                              │  (pure-TS calculation)   │
                                              └──────────────────────────┘
                                                             │
                                                             ▼
                                              ┌──────────────────────────┐
                                              │  hooks: useBreakdowns,   │
                                              │   useStats, useBuild     │
                                              └──────────────────────────┘
                                                             │
                                                             ▼
                                              ┌──────────────────────────┐
                                              │   React UI (build/,      │
                                              │   gear/, stats/, ui/)    │
                                              └──────────────────────────┘
```

### Data layer — `public/data/` + `src/utils/`

The XML files in `public/data/` come straight from DDOBuilderV2's `Output/DataFiles/`. They cover feats, classes, races, enhancement trees, augments, filigrees, set bonuses, item buffs, stances, spells, guild buffs, and party buffs. Items (8,477 `.item` files, too big to ship raw) are preprocessed into per-slot JSON shards by `scripts/buildItemIndex.mjs`.

| File | What it does |
|---|---|
| `src/utils/ddoXmlParser.ts` | Parses every catalog XML (classes, races, feats, trees, augments, filigrees, set bonuses, stances, spells, guild buffs, party buffs) into typed shapes. |
| `src/utils/ddoBuildParser.ts` | Parses a `.DDOBuild` save file into a `Build` — picks the active life / build, reads classes, ability scores, tomes, level-ups, feats, special feats / past lives, all enhancement spends, gear sets, augments, filigrees, active stances, guild level. |
| `src/utils/effectParser.ts` | The one canonical `<Effect>` parser — every walker in the engine routes through this so XML-level changes (e.g. `<Percent/>`, `<ApplyAsItemEffect/>`) stay consistent. |
| `src/utils/itemCatalog.ts` | Loads / queries the preprocessed item index. |
| `src/utils/classAdapter.ts` | Adapts catalog `DDOClassData` / `DDORaceData` to the simpler shapes the engine consumes. |
| `src/utils/featSlots.ts` | Computes feat-slot grants per character level (used for display badges). |
| `src/utils/levelClasses.ts` | Aggregates `levelClasses[]` (per-level classId) into `classes[]` (totals). |
| `src/utils/defaultEnhancementTrees.ts` | Picks reasonable starting enhancement trees from race + top class. |
| `src/utils/compression.ts` | lz-string wrappers for URL-hash build sharing. |

Type definitions live in `src/types/`:
- `build.ts` — the editable `Build` shape (what the user is constructing).
- `ddoData.ts` — catalog types (`DDOClassData`, `DDOFeatData`, `EnhancementTreeData`, `DDOAugmentData`, …).
- `gameData.ts` — engine-side simplified types.
- `effectTypes.ts` — auto-generated TS string union of 220 EffectType names from DDOBuilderV2's `Effect.h` (regenerate via `npm run gen-effect-types`).

### State layer — `src/store/`

Two Zustand stores:

| Store | Holds | Notes |
|---|---|---|
| `gameDataStore.ts` | The parsed XML catalogs (classes, races, feats, trees, item buffs, set bonuses, augments, filigrees, stances, spells, guild buffs, party buffs, item-set index, feat-icon map). | Loaded once on app boot via `useGameData`; status flips `idle → loading → ready`. |
| `buildStore.ts` | The user's `Build` plus all mutator actions (`updateRace`, `setLevelClass`, `addFeat`, `spendEnhancement`, `equipItem`, `togglePartyBuff`, `setGuildLevel`, …). | Source of truth. URL hash is the persistence boundary — load via `useShareUrl.loadBuildFromHash`, save via `useShareUrl.copyShareUrl`. |

### Engine layer — `src/engine/`

A pure-function pipeline. No React, no Zustand. Given a build + the catalogs, it produces an `EngineResult` with per-stat `BreakdownResult`s.

```
build + catalogs ─▶ collectEffects ─▶ SourcedEffect[]
                                        │
                                        ▼
                                  evaluateEffect (one at a time)
                                        │
                                        ▼
                                    Bonus[]
                                        │
                                        ▼
                                   stackBonuses (per stat)
                                        │
                                        ▼
                                  BreakdownResult[]
```

| File | Responsibility |
|---|---|
| `collectEffects.ts` | Walks every source on the build (selected feats, class auto-feats, Epic/Legendary auto-feats, IHD-per-heroic-class, global Automatic feats with eligibility checks, heroic / destiny / reaper enhancements, gear item buffs, set bonuses, augments, filigrees, party buffs, guild buffs, special-feat past lives) and emits one `SourcedEffect` per Effect block with a human-readable label. **All new effect sources go here.** |
| `evaluateEffect.ts` | Turns a single `<Effect>` into 0..N `Bonus` records. Handles every supported `<AType>` (Simple, Stacks, NotNeeded, TotalLevel, AbilityMod, BAB, ClassLevel, …) and every `<Requirement>` (Class, BaseClass, Stance, Feat, Race, Level, Ability, …). Unknown requirements pass-through (permissive). |
| `bonusStacking.ts` | Stacks `Bonus[]` into a `BreakdownResult`. Two-pass: flat bonuses first (grouped by `Bonus` type, Highest-Only competition only applied to gear-derived bonuses), then percentage bonuses layered on top of the flat subtotal. |
| `breakdowns.ts` | Per-stat aggregators (HP, saves, AC, PRR/MRR, melee/ranged power, doublestrike, doubleshot, healing amp 3-flavor, spell power per element, spell crit chance & damage per element, spell DCs per school, …). Universal vs per-element spell stats are computed separately and re-injected. |
| `runEngine.ts` | Top-level orchestrator. Builds the score pipeline, runs `collectEffects` → `evaluateEffect` → `breakdowns`, and synthesizes a few special bonuses post-breakdown (CON-mod × level for HP, Combat-Style HP multiplier, Fate-points × 2 HP). |
| `abilityScores.ts`, `bab.ts`, `hitPoints.ts`, `saves.ts`, `skills.ts`, `reaperXp.ts` | Pure helpers for the seed values that feed the breakdown pipeline. |
| `itemBuffResolver.ts` | Resolves an item's buff *reference* (`{ type: 'AbilityBonus', value1: 4, bonusType: 'Insight', item: 'Strength' }`) against the `itemBuffs.json` catalog template into a concrete `Effect`. |

Two cross-cutting invariants:

1. **Stacking model** — `<BonusTypes.xml>` declares each Bonus type as `Highest Only` or `Always`. The engine layers two extra rules on top: Highest-Only competition only applies between *gear-derived* bonuses (those with the `<ApplyAsItemEffect/>` flag, or sourced from items / augments / set bonuses / filigrees); non-gear bonuses always stack regardless of `<Bonus>` type. Mirrors DDOBuilderV2's `m_effects` vs `m_itemEffects` segregation.
2. **Score pipeline** — `base → applyRacialBonuses → applyAbilityTomes → applyLevelUps → effectiveScores`. This sequence is implemented in **both** `useBuild.ts` (UI display) and `runEngine.ts` (engine seed). They must stay in sync.

### Hook layer — `src/hooks/`

Hooks bridge the engine and React.

| Hook | What it gives the UI |
|---|---|
| `useGameData` | Boot-time loader — kicks off `gameDataStore.loadGameData` once. |
| `useBuild` | Current build + the score-pipeline display values (`charLevel`, `bab`, `hitPoints`, `saves`, `effectiveScores`, `modifiers`, …) + every store action. |
| `useBreakdowns` | Memoized `runEngine(...)` result. Returns `null` while game data loads. |
| `useStats` | Wraps `useBreakdowns` + `useBuild` and adds display-only derivations (attacks/round, weapon-finesse damage attribute, attack-chain labels, spell focus / metamagic feat lists). The component-facing API for "what's on the stat bar". |
| `useShareUrl` | URL-hash encode/decode, copy-to-clipboard share button. |
| `useLocalStorage` | Tiny `[get, set]` helper. |

### UI layer — `src/components/` + `src/pages/`

Routing: `App.tsx` mounts a `Layout` shell with three routes — `/` (landing), `/builder` (editor), `*` (404).

```
src/components/
├── build/         # Editor tabs and panels: race, class, level grid, ability scores, tomes/level-ups,
│                  # feats, special feats, skills, enhancements (heroic), destinies, reaper, spells,
│                  # stances, breakdowns. Tabbed inside the editor page.
├── gear/          # Gear set editor (multi-set), item picker, augment picker, filigree picker,
│                  # set-bonus pills. Always visible at the bottom of the editor.
├── stats/         # Always-visible top-of-page stats summary (StatsSection).
├── layout/        # Outer shell + nav.
└── ui/            # Generic primitives (Button, Tabs).
```

Page-level entry points:

| Page | What it does |
|---|---|
| `pages/Home.tsx` | Landing page with hero, three feature cards, attribution footer (source repo + DDOBuilderV2 + DDO trademark). |
| `pages/BuildEditor.tsx` | Main editor — toolbar (rename, import, share, reset) + always-visible `StatsSection` + tabbed `BuildSection` + `GearSection`. |
| `pages/NotFound.tsx` | 404. |

Two read patterns to keep in mind:
- **Most screens** read derived numbers from `useStats()` so the always-visible stat bar and the per-tab panels stay in sync.
- **The Breakdowns tab** reads `useBreakdowns()` directly and renders the raw contributor list with stacking dominance and percent contributions visible — it's the engine's debug view.

---

## Project Structure

```
src/
├── App.tsx, main.tsx, index.css
├── components/      build/, gear/, stats/, layout/, ui/
├── data/            tiny stub JSON (offline test fallback)
├── engine/          pure-TS calculation pipeline
├── hooks/           React-engine bridge
├── pages/           Home, BuildEditor, NotFound
├── store/           Zustand stores (build + game data)
├── types/           build, ddoData, gameData, effectTypes
└── utils/           XML parsers, build-file parser, helpers

public/
├── data/            DDOBuilderV2 XML catalog
│   ├── Feats.xml, Spells.xml, BonusTypes.xml, Stances.xml, SetBonuses.xml,
│   ├── ItemBuffs.xml, GuildBuffs.xml, SelfAndPartyBuffs.xml, AttackRates.xml
│   ├── Classes/         28 class XML files
│   ├── Races/           28 race XML files
│   ├── EnhancementTrees/  112 enhancement-tree XML files
│   ├── Augments/        31 augment-set XML files
│   ├── FiligreeSets/    65 filigree-set XML files
│   └── items/           preprocessed (index, by-slot/*, itemBuffs)
└── assets/images/   ~6,000 game icons (PNG)

tests/
├── engine/          unit tests + per-fixture engine snapshots
├── parser/          XML / .DDOBuild parser snapshots
├── ui/              React component smoke tests (happy-dom)
├── fixtures/        4 reference .DDOBuild files
└── snapshots/       locked outputs

scripts/
├── buildItemIndex.mjs    .item files → per-slot JSON shards
├── genEffectTypes.mjs    Effect.h → effectTypes.ts string union
└── dev.mjs               verify / verify:full / snapshots:reset / debug:fixture
```

---

## Getting Started

```bash
npm install
npm run dev                      # http://localhost:5173

docker compose up --build        # production preview, http://localhost:3000

npm run typecheck
npm run lint
npm run test                     # 28 files / 179 tests
npm run verify                   # typecheck + tests
npm run verify:full              # + production build
```

### Data refresh

```bash
npm run import-items             # .item files → public/data/items/*
npm run gen-effect-types         # Effect.h → src/types/effectTypes.ts
```

### Snapshot helpers

```bash
npm run snapshots:reset          # all
npm run snapshots:reset kemton   # filtered
npm run debug:fixture kemton     # pretty-print a parsed .DDOBuild
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript 5 + Vite 6 |
| State | Zustand 5 |
| Routing | React Router 7 |
| Build sharing | lz-string URL hash |
| Tests | Vitest + happy-dom + @testing-library/react |
| Hosting | Cloudflare Workers (static assets) |
| Local prod preview | Docker + Nginx (multi-stage, ~30MB image) |
| CI | GitHub Actions (lint + typecheck + test) |

---

## Deployment

The site is hosted on **[Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/)** with static-assets serving — global edge CDN, free tier covers hobby usage, deploys driven directly from this Git repo. **Push to `master` and Cloudflare rebuilds and redeploys within a few minutes**, no manual step required.

### How it's wired up

| File | Role |
|---|---|
| `wrangler.jsonc` | Worker config — points at `./dist` and enables SPA fallback (`not_found_handling: "single-page-application"`). |
| Cloudflare's GitHub integration | Watches `master`, runs `npm run build`, uploads `dist/` to the Worker. |
| `ddo-builds.com` | Custom domain, attached to the Worker via Cloudflare's *Custom Domains* feature. SSL is provisioned automatically. |

### Cloudflare project settings

Reproducing the project on a fresh Cloudflare account:

| Field | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output directory | `dist` (handled by `wrangler.jsonc`) |
| Environment variable | `NODE_VERSION=22` |
| Production branch | `master` |

### Manual deploy from your laptop

If Cloudflare's auto-deploy is ever down or you want to test a deploy outside CI:

```bash
npm run build
npx wrangler deploy        # uses wrangler.jsonc + your local Cloudflare login
```

### Self-hosting alternative

If you'd rather run this somewhere else, the `Dockerfile` produces a standalone Nginx + static-bundle image (~30MB). `docker compose up --build` serves it on port 3000. The image is platform-agnostic — works on any container host (Lightsail Containers, Fly.io, your own VPS, etc.).

---

## Data & Credits

XML game data and image assets come from **Maetrim's DDOBuilderV2**:

> **DDOBuilderV2** — https://github.com/Maetrim/DDOBuilderV2
>
> Windows desktop application (C++/MFC) for planning DDO character builds.
> The XML and PNG assets in this repository are taken directly from that
> project's `Output/DataFiles/` directory.

**DDO (Dungeons and Dragons Online)** is © 2024 Standing Stone Games. All game content, names, and assets are the property of their respective owners. This project is a fan-made hobby tool and is not affiliated with or endorsed by Standing Stone Games or Daybreak Game Company.

The source code is licensed under the MIT License — see [LICENSE](./LICENSE).

---

## Roadmap

- **DPS pane** — full damage simulation. DDOBuilderV2's DPS pane is itself a stub, so this needs an algorithm designed from scratch using the breakdown inputs + `AttackRates.xml`.
- **Spell DPS / SP cost** — beyond DC and crit chance, model spell damage output.
- **Reaper-mode breakdowns** — toggle a UI switch to see "what if Reaper-1 is on" so reaper-stance-gated HP/SP/etc. show.
- **Sentient gem effects** — gem personality and rare effects on weapons.
- **Mobile-friendly layout** — the current design assumes desktop width.

Pull requests welcome for bug fixes and data corrections.
