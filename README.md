# DDO Builds

A hobby build calculator for **Dungeons and Dragons Online** (DDO). Plan and price out a character — race, multiclass splits, ability scores, feats, skills, enhancement trees, epic destinies, reaper points, gear, augments, filigrees, stances, party buffs — then share the result with a URL or import a `.DDOBuild` file straight from the desktop tool.

It's a TypeScript port of [Maetrim's DDOBuilderV2](https://github.com/Maetrim/DDOBuilderV2) (C++/MFC desktop app), running in the browser.

---

## Features

- **Full character editor** — race, alignment, per-level class assignment, ability scores (32-point buy), tomes, level-ups, heroic & epic past lives, racial completionist, iconic past lives
- **Multiclass + epic levels** — DDO's 3-class heroic split + 14 post-heroic Epic/Legendary levels (HP, BAB, ability gains all wired up)
- **All trees** — heroic enhancements, epic destinies (with capstone selection), reaper points, racial trees, universal trees. Selector enhancements, multi-rank costs, AP-pool overflow (racial → universal → standard) all modeled.
- **Feats** — slot-aware feat picker with class/race auto-grants, special-feat (past-life) ranks, completionist eligibility (Heroic + Racial), automatic-acquisition feats (Heroic Durability, Improved Heroic Durability per heroic class).
- **Skills** — class-skill detection, rank cap based on level + tomes, skill-point budget calculator.
- **Gear** — multiple gear sets, slot-by-slot item picker (8,200+ items), augment slots with full augment catalog (Sealed in Undeath unsealing supported), filigree slots, sentient-weapon set bonuses.
- **Stances & buffs** — toggle-able stance picker (Energy Criticals, Combat Expertise, etc.), self/party buff list (138 catalog buffs), guild-level-gated guild buffs.
- **Spells & SLAs** — per-class spell-slot allocation, feat-/enhancement-/destiny-granted SLAs, mantles.
- **Live breakdowns** — every stat (HP, saves, AC, PRR/MRR, melee/ranged power, doublestrike, doubleshot, healing amp, spell DCs per school, spell power per element, spell crit chance & damage per element, …) shows source-by-source contributors with applied/dominated stacking, and percent buffs render as `+X% (+Y)` so you can see the actual flat HP/SP delta.
- **Build sharing** — full build state encoded in the URL via lz-string. Paste-to-share, no account.
- **Import .DDOBuild** — drag-drop the file the desktop app exports and the parser pulls in classes, ability scores, tomes, level-ups, feats, special feats / past lives, all enhancement spends, gear sets, augments, filigrees, active stances, guild level, etc.
- **Self-hostable** — Docker Compose for local prod preview, AWS App Runner for the cloud (~$5/mo).

---

## Engine architecture

The whole calculation pipeline is pure TypeScript; the React layer just consumes its output.

```
build state ─┐
data XML  ───┼─▶ collectEffects ─▶ evaluateEffect ─▶ Bonus[] ─▶ stackBonuses ─▶ per-stat breakdown
gear sets ───┘                                                                      │
                                                                                    ▼
                                                                          BreakdownsTab UI
```

| Module | Job |
|---|---|
| `src/utils/effectParser.ts` | One canonical XML-Effect parser used by every walker. |
| `src/engine/collectEffects.ts` | Walks the build (feats, class auto-feats, enhancements, destinies, reaper, augments, filigrees, set bonuses, guild buffs, party buffs, special-feat past lives) and emits `SourcedEffect[]`. |
| `src/engine/evaluateEffect.ts` | One Effect → many `Bonus`. Handles every `<AType>` (Simple, Stacks, TotalLevel, AbilityMod, BAB, …) and every requirement (Class/Race/Stance/Feat/Level/SpecificLevel/CharacterLevel/Ability/…). |
| `src/engine/bonusStacking.ts` | Stacks `Bonus[]` into a `BreakdownResult`. Highest-Only competition only applies to *gear-derived* effects (`<ApplyAsItemEffect/>` flag or augment/set/filigree/itemBuff source) — non-item effects always stack, mirroring DDOBuilderV2's `m_effects` vs `m_itemEffects` segregation. Percent bonuses (`<Percent/>` flag) layer on top of the flat subtotal. |
| `src/engine/breakdowns.ts` | Per-stat aggregators. Universal vs per-element spell crit chance / damage / power are computed independently and re-injected (matches `BreakdownItemSpellPower::CreateOtherEffects`). |
| `src/engine/runEngine.ts` | Top-level orchestrator. Synthesizes special bonuses (CON-mod × level for HP, Combat-Style HP multiplier, Fate-points HP, Class HP, etc.) from the final breakdowns. |
| `src/hooks/useBreakdowns.ts` | Engine output as React state, memoized over the entire build + game data. |
| `src/components/build/BreakdownsTab.tsx` | Per-stat collapsible rows showing the live source list, with stacking dominance and percent contributions visible. |

**Stacking model** — `<BonusTypes.xml>` sets each type's mode (`Highest Only` or `Always`); the engine layers two more rules on top: gear bonuses with the same `<Bonus>` compete (Highest Only); non-gear bonuses always stack regardless of `<Bonus>`. Percent bonuses are stacked separately and applied as `flatSubtotal × Σ percents / 100` (DDOBuilderV2's `m_bAllPercentsAtOnce` model for HP).

**Score pipeline** (must stay in sync between `useBuild` and `runEngine`):
`base → applyRacialBonuses → applyAbilityTomes → applyLevelUps → effectiveScores → AbilityBonus stack → final`.

The HP seed is class-only (`classHitPoints`); CON × levels is injected as a synthetic bonus *after* the CON breakdown is final, so gear/augment/PL CON bonuses feed through to HP exactly like `BreakdownItemHitpoints::CreateOtherEffects`.

---

## Getting Started

### Local development

```bash
npm install
npm run dev           # http://localhost:5173
```

### Production preview (Docker)

```bash
docker compose up --build    # http://localhost:3000
```

The image is ~30MB (Nginx + static bundle). Nginx ships with SPA fallback, aggressive cache headers for hashed assets, and security headers.

### Checks

```bash
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run test          # Vitest (28 files / 179 tests as of 2026-05-03)
npm run verify        # typecheck + tests
npm run verify:full   # typecheck + tests + production build
```

### Data refresh helpers

```bash
npm run import-items       # rebuild public/data/items/index.json + by-slot/*.json from the .item files
npm run gen-effect-types   # regenerate src/types/effectTypes.ts from DDOBuilderV2's Effect.h
```

### Snapshot helpers

```bash
npm run snapshots:reset                # delete all snapshots and regenerate
npm run snapshots:reset kemton         # only kemton.* snapshots
npm run debug:fixture kemton           # pretty-print a parsed .DDOBuild
```

---

## Project Structure

```
src/
├── components/
│   ├── build/        # Race/Class/Level/Ability/Feat/Skill/Enhancement/Destiny/Reaper/Spell/Stance/Tome panels + dialogs
│   ├── gear/         # Gear set editor, item picker, augment picker, filigree picker, set-bonus pills
│   ├── stats/        # Always-visible top-of-page stats summary
│   └── ui/           # Generic primitives (Button, Tabs, …)
├── data/             # Tiny stub JSON for offline tests; superseded by public/data XML at runtime
├── engine/           # Pure TS: bonusStacking, collectEffects, evaluateEffect, breakdowns, runEngine,
│                     # itemBuffResolver, abilityScores, bab, hitPoints, saves, skills, reaperXp
├── hooks/            # useBuild, useBreakdowns, useStats, useGameData, useShareUrl, useLocalStorage
├── pages/            # BuildEditor (main), Home, NotFound
├── store/            # Zustand: buildStore (build state) + gameDataStore (XML catalog)
├── types/            # build.ts, gameData.ts, ddoData.ts, effectTypes.ts (auto-generated)
└── utils/            # ddoXmlParser, ddoBuildParser, effectParser, classAdapter, compression,
                      # featSlots, levelClasses, defaultEnhancementTrees, itemCatalog

public/
├── data/             # DDO XML catalog (see Data & Credits)
│   ├── Feats.xml             # 430+ feats
│   ├── Spells.xml            # full spell catalog
│   ├── BonusTypes.xml        # stacking rules (Highest Only vs Always)
│   ├── Stances.xml           # stance catalog
│   ├── SetBonuses.xml        # set bonus tier definitions
│   ├── ItemBuffs.xml         # canonical buff templates referenced by items
│   ├── GuildBuffs.xml        # guild-level-gated buffs
│   ├── SelfAndPartyBuffs.xml # toggleable party buffs (Bless, Haste, …)
│   ├── Classes/              # 28 class XML files
│   ├── Races/                # 28 race XML files
│   ├── EnhancementTrees/     # 112 enhancement-tree XML files
│   ├── Augments/             # 31 augment-set XML files
│   ├── FiligreeSets/         # 65 filigree-set XML files
│   └── items/                # preprocessed (8,200 items, by-slot shards, itemBuffs.json catalog)
└── assets/images/    # ~6,000 game icons (PNG) — class, feat, enhancement, spell, augment, item, …

tests/
├── engine/           # Engine unit tests + per-fixture engine snapshot
├── parser/           # XML parsers + .DDOBuild import snapshot
├── ui/               # React component smoke tests (happy-dom)
├── fixtures/         # Reference builds (kemton.DDOBuild, zentek.DDOBuild, two real monk builds)
└── snapshots/        # Locked outputs — refresh via `npm run snapshots:reset`

scripts/
├── buildItemIndex.mjs   # 8,477 .item files → public/data/items/{index,by-slot/*,itemBuffs}.json
├── genEffectTypes.mjs   # DDOBuilderV2 Effect.h → src/types/effectTypes.ts string union
└── dev.mjs              # verify / verify:full / snapshots:reset / debug:fixture wrappers
```

---

## AWS Deployment

The recommended hosting path is **AWS App Runner** (~$5/month for a 0.25 vCPU / 0.5 GB container).

### One-time setup

```bash
aws ecr create-repository --repository-name ddo-builds --region us-east-1
# Then create an App Runner service pointing at the ECR image (port 80).
# Enable "automatic deployment" so pushes to ECR trigger a redeploy.
```

### Deploy

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

docker build -t ddo-builds .
docker tag  ddo-builds:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/ddo-builds:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/ddo-builds:latest
```

### Automated via GitHub Actions

`.github/workflows/deploy.yml` builds, pushes, and triggers a redeploy. Replace `<ACCOUNT_ID>` and `<SERVICE_ID>` with your values, then create an IAM role with a GitHub OIDC trust policy (no long-lived secrets needed).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript 5 + Vite 6 |
| State | Zustand 5 |
| Routing | React Router 7 |
| Build sharing | lz-string URL hash |
| Tests | Vitest + happy-dom + @testing-library/react |
| Serving | Nginx 1.27-alpine |
| Container | Docker multi-stage build (~30MB image) |
| Cloud | AWS App Runner |
| CI | GitHub Actions (lint + typecheck + test + Docker build) |

---

## Data & Credits

The XML game data in `public/data/` and the image assets in `public/assets/images/` come from **Maetrim's DDOBuilderV2** project:

> **DDOBuilderV2** — https://github.com/Maetrim/DDOBuilderV2
>
> A Windows desktop application (C++/MFC) for planning DDO character builds.
> The data files (XML) and image assets (PNG) in this repository are taken
> directly from that project's `Output/DataFiles/` directory.

Specifically:

- **Feats.xml** — 430+ feats with prerequisites and effects
- **Classes/** — 28 class files (BAB, save progressions, automatic feats, feat slots, spell slots)
- **Races/** — 28 race files (build points, racial mods, past-life feat, iconic flag)
- **EnhancementTrees/** — 112 enhancement trees (class, race, universal, epic destiny, reaper)
- **Augments/, FiligreeSets/** — augment + filigree definitions
- **Spells.xml, Stances.xml, SetBonuses.xml, ItemBuffs.xml, GuildBuffs.xml, SelfAndPartyBuffs.xml** — supporting catalogs
- **8,477 .item files** — every named item, preprocessed into per-slot shards

**DDO (Dungeons and Dragons Online)** is © 2024 Standing Stone Games. All game content, names, and assets are the property of their respective owners. This project is a fan-made hobby tool and is not affiliated with or endorsed by Standing Stone Games or Daybreak Game Company.

The source code in this repository is licensed under the MIT License — see [LICENSE](./LICENSE).

---

## Roadmap

This is a personal hobby project. Stretch items still on the list:

- **DPS pane** — full damage simulation. DDOBuilderV2's DPS pane is itself a stub, so this needs an algorithm designed from scratch using the breakdown inputs + `AttackRates.xml`.
- **Spell DPS / SP cost** — beyond DC and crit chance, model spell damage output.
- **Reaper-mode breakdowns** — currently the engine excludes reaper-stance-gated HP/SP/etc. Toggle a UI switch to see "what if Reaper-1 is on".
- **Class-auto-feat parity for Improved Heroic Durability template** — DDOBuilderV2 generates per-class IHD feats dynamically; current implementation fires the canonical IHD effect per heroic class but doesn't expose them as separate named feats in the UI.
- **Sentient gem effects** — gem-personality and rare effects.
- **Mobile-friendly layout** — current design assumes desktop width.

Pull requests welcome for bug fixes and data corrections.
