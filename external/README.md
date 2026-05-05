# external/

Read-only snapshots of upstream data sources. **Don't edit anything in
this directory directly** — these mirrors exist only as diff baselines
for syncing upstream changes into our authoritative copies elsewhere
in the tree.

## Subdirectories

| Path | Source | Used by | Sync command |
|---|---|---|---|
| `ddobuilderv2/` | [Maetrim/DDOBuilderV2](https://github.com/Maetrim/DDOBuilderV2) `Output/DataFiles/` | `public/data/` | manual today; `npm run sync-upstream` planned (Phase 2) |

## Why this exists

`public/data/` started as a verbatim copy of DDOBuilderV2's data. Over
time we've fixed enough bugs and extended the schema enough (Sharp Magic
fan-out, Mechanic stance rename, Epic Strike SLA wiring, multi-projectile
spell rules, the Nightmare Lance entry, …) that **our copy is now the
source of truth**, not theirs. We still want a way to pull in their
fixes, but as a curated merge — never a blind overwrite.

## Update workflow

1. Refresh the snapshot in `ddobuilderv2/` from the latest upstream clone.
2. Update `ddobuilderv2/SYNC.md` with the new commit hash + date.
3. `git diff external/ddobuilderv2/` shows what *they* changed.
4. Compare each interesting upstream change against `public/data/`,
   apply the ones we want, ignore the rest.
5. Snapshot tests in `tests/` will fail loudly if a merge accidentally
   regresses something we'd patched intentionally.

See `docs/DATA_PATCHES.md` for the historical patch ledger (entries
marked "baked in" are now part of `public/data/` directly and don't
need re-applying on each sync).
