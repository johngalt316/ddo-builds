# DDOBuilderV2 snapshot

Pinned mirror of [DDOBuilderV2](https://github.com/Maetrim/DDOBuilderV2)'s
`Output/DataFiles/` directory. Used **only** as a diff baseline when we
sync upstream changes — `public/data/` is our authoritative copy.

## Last sync

| | |
|---|---|
| Upstream commit | `a219fa426097e23dcf1bb5e40d674a5a2e4273b9` |
| Upstream date   | 2026-04-24 |
| Pulled into ddo-builds | 2026-05-05 |

## What's included

XML schema files we track in `public/data/`:

- Top-level: `AttackRates.xml`, `BonusTypes.xml`, `Challenges.xml`,
  `Feats.xml`, `GuildBuffs.xml`, `ItemBuffs.xml`, `ItemClickies.xml`,
  `Patrons.xml`, `Quests.xml`, `SelfAndPartyBuffs.xml`,
  `Sentient.gems.xml`, `SetBonuses.xml`, `Spells.xml`, `Stances.xml`,
  `WeaponGroupings.xml`
- Directories: `Augments/`, `Classes/`, `EnhancementTrees/`,
  `FiligreeSets/`, `Races/`

## What's NOT included

- **`Items/`** — 8,477 `.item` XML files at ~37 MB total. Read by
  `npm run import-items` directly from the sibling DDOBuilderV2 clone
  (`../DDOBuilderV2/Output/DataFiles/Items/`) and preprocessed into
  `public/data/items/*.json`.
- **`*Images/`** folders — already mirrored under `public/assets/images/`.
- **`Blank Trees/`** — XML templates for new tree creation, not data.

## Refresh procedure

When upstream releases new data:

```bash
# 1. Pull the latest DDOBuilderV2 clone
git -C ../DDOBuilderV2 pull

# 2. Run the sync tool (Phase 2 — TODO):
#    npm run sync-upstream
#    Will overwrite this folder + print a per-file diff vs public/data/.
```

For now the refresh is manual: copy the listed files/dirs from
`../DDOBuilderV2/Output/DataFiles/` over `external/ddobuilderv2/`,
update the commit hash + sync date above, then run `git diff
external/` to review what changed upstream and decide what (if
anything) to merge into `public/data/`.
