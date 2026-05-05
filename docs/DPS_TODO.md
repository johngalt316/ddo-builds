# DPS calculator — known approximations & TODOs

Tracks places where the DPS calculator deliberately under- or over-estimates
damage because the underlying mechanic isn't fully modeled yet. As we wire
each one up, delete its row.

---

## Damage-over-time effects (currently modeled as instant hits)

The calculator treats every spell's `<SpellDamage>` block as a single
instantaneous hit. Several Epic Strikes and procs apply damage over a
duration (per-tick + duration + tick-interval). Until a DoT model lands,
their `<Spell>` entries are wired with the per-tick damage as if it were
instant — this **underestimates** their total contribution.

| Source | True mechanic | What we model today |
|---|---|---|
| **Carrion Swarm** (Primal Avatar Epic Strike) | 1d6+1 Acid + 1d6+1 Poison every 2s for 8s, scales per 2 char levels | Single Acid hit, 1d6+1 per 2 CL — Poison rider missing, multi-tick missing |
| **Storm Catcher** (Primal Avatar Epic Strike) | 1d8+8 Electric instant + 1d6 Cold every 2s for 8s | Instant Electric hit only — Cold DoT rider missing |
| **Cutter** (Fury of the Wild "Quick Cutter" rider) | 1d6 Slash per CL every 2s for 8s, stacks 3× | Not modeled — Quick Cutter is skipped entirely (physical strike) |
| **Spring to Summer** (Primal Avatar Epic Strike) | Heal-then-burst: rejuvenation cocoon + delayed Fire AoE | Modeled as instant Fire hit; cocoon ignored |
| **Shadow Loss** (Shadowstrike Melee/Ranged debuff) | -5 PRR/MRR/SR for 12s on hit | Not a DPS contribution; just flagged here |
| **Bleed effects** (various weapon procs) | Per-tick damage every 2s | Procs surface their `qtyPerTrigger × dice` once; tick decay missing |

### Design notes for a future DoT model

- `<Spell>` could grow a `<DoT>` block: `{ tickDice, tickInterval, duration }` — separate from `<SpellDamage>` so calculator can sum (instant + DoT-total).
- DoT total = `floor(duration / tickInterval) × tickDice`.
- Buff/debuff DoTs (Cutter, Shadow Loss) belong on the *buff* system once that's wired (see `src/engine/dps/buffs.ts`).
- Stacking DoTs (Cutter, Carrion Swarm — 3 stacks each) need a stack-cap field.
- Multi-element DoTs (Carrion Swarm: Acid + Poison) need an array of damage entries per tick, not a single one.

---

## Other approximations

| Topic | Note |
|---|---|
| Pluck of a String / Sword Sings | Modeled as pure 2d10 Sonic per CL. In-game they're weapon-augment riders that scale with 200% Ranged/Melee Power on top of weapon damage. We capture the spell-style portion only. |
| Drifting Lotus / Orchid Blossom | Modeled as Force spells per CL. In-game the Force damage scales with the higher of Melee or Ranged Power (similar to Magus Eclipse strikes); doubles vs. Tainted Creatures. The doubling-vs-tainted rule is global to several abilities and could become a settings flag. |
