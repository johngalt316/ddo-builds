# external/

Read-only snapshots of upstream data sources. **Don't edit anything in
this directory directly** — these mirrors exist only as diff baselines
for syncing upstream changes into our authoritative copies elsewhere
in the tree.

## Subdirectories

| Path | Source | Used by | Sync command |
|---|---|---|---|
| `ddobuilderv2/` | [Maetrim/DDOBuilderV2](https://github.com/Maetrim/DDOBuilderV2) `Output/DataFiles/` | `public/data/` | `npm run sync-upstream` |

## Why this exists

`public/data/` started as a verbatim copy of DDOBuilderV2's data. Over
time we've fixed enough bugs and extended the schema enough (Sharp Magic
fan-out, Mechanic stance rename, Epic Strike SLA wiring, multi-projectile
spell rules, the Nightmare Lance entry, …) that **our copy is now the
source of truth**, not theirs. We still want a way to pull in their
fixes, but as a curated merge — never a blind overwrite.

## Update workflow

```bash
# 0. Pull the sibling DDOBuilderV2 clone first so it's at HEAD.
git -C ../DDOBuilderV2 pull

# 1. Dry-run shows what they changed since the pinned commit.
npm run sync-upstream

# 2. Refresh external/ddobuilderv2/ + bump SYNC.md.
npm run sync-upstream -- --apply

# 3. Review with git — what THEY changed lives in external/.
git diff external/ddobuilderv2/

# 4. Manually merge curated changes into public/data/ (the
#    authoritative copy). For each interesting upstream change:
#      git diff external/ddobuilderv2/Spells.xml public/data/Spells.xml
#    edit the relevant block in public/data/, commit.

# 5. Snapshot tests catch silent regressions:
#    npm test
```

By default the source path is `../DDOBuilderV2/Output/DataFiles`. Pass
`--source=<path>` to override (`npm run sync-upstream -- --source=…`).

See `docs/DATA_PATCHES.md` for the historical patch ledger — every
entry there is already baked into `public/data/`. Use the ledger as a
"things to look out for during merges" reference, not a re-apply
checklist.
