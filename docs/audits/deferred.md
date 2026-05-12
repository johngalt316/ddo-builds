# Deferred Audit Items

Consolidated list of issues surfaced during the Slice 1-7 engine audit
that were intentionally deferred. Grouped by impact category. Source
slice cited so you can read the context if you pick one up.

## Engine accuracy (would change numbers; needs design)

| Item | Source | Notes |
|---|---|---|
| **`OverrideBAB`** (11 instances) — flag effects from Bard Warchanter, Vile Chemist Alchemist, etc. to force full-BAB progression for off-BAB classes. | Slice 5 | Not DPS-visible until to-hit / AC modeling lands. The engine assumes 100% hit-rate today. |
| **`TacticalDC`** (104 instances) — per-tactic DCs (Trip / Sunder / Stun / Assassinate / Quivering Palm). | Slice 5 | Build-planner stat coverage. Engine has the bonuses in `allBonuses` but no breakdown surfaces them. Future: add `breakdownTacticalDC` with per-tactic + aggregate, same shape as `breakdownSpellDC`. |
| **Positional sneak-attack stats** — `SneakAttackRange`, `SneakAttackAttack`, `SneakAttackDamage`, `RangedSneakAttackRange`. | Slice 5 | Engine treats all sneak as "always-on" (matches optimal positioning). Modeling position requires a flanking / behind-target probability input. |
| **Auto-controlled stances** — 30 entries in `Stances.xml` (Two Weapon Fighting, Two Handed Fighting, Heavy Armor, Centered, Good/Lawful/Chaotic/etc.) should auto-activate from build state. | Slice 7 | Currently user must manually toggle each. Stance-gated effects don't fire until activated. Future: `computeAutoStances(build, gear, weaponGroups, alignment)` that adds qualifying entries to `activeStances` alongside user toggles. |
| **Static weapon-group registry diverges from `WeaponGroupings.xml`** — Handwraps in local `weaponGroups.ts` is `[Unarmed, Light, Melee, Simple]` but upstream data says `[Exotic, Melee, Finesseable, Centered, Bludgeoning]`. | Slice 7 | Replace `STATIC_GROUPS` with a parsed-at-init mapping from `gameDataStore.weaponGroups`. Has measurable accuracy impact on GroupMember-gated effects for handwraps and other miscategorized weapons. |
| **`SpellPowerReplacement`** (8 instances, Tiefling-only) — overrides one spell power type with another. | Slice 3 | Engine has no routing for "use Fire spellpower as Cold". Niche; defer until a Tiefling fixture exists. |
| **Per-spell caster level overrides + Song* buffs** | Slice 3 | Bardic-song-specific buffs (SongMRR, SongAmp, etc.) emit bonuses correctly but the "song active" UI gate doesn't exist. |

## Build-planner stats (no DPS impact; would show in stat panels)

| Item | Source | Instances |
|---|---|---:|
| `EnergyResistance` (per-element flat resist) | Slice 4 | 119 |
| `EnergyAbsorbance` (per-element % absorbed) | Slice 4 | 110 |
| `Immunity` (status: disease, sleep, fear, etc.) | Slice 4 | 131 |
| `Fortification` (% anti-crit on incoming) | Slice 4 | 57 |
| `DodgeCapBonus` (raises dodge cap above default 25%) | Slice 4 | 49 |
| `MRRCap` (raises MRR cap; matters for Evasion-style scaling) | Slice 4 | 57 |
| `Displacement` (% miss for incoming attacks) | Slice 4 | 21 |
| `HelplessDamageReduction` (DR while player is helpless) | Slice 4 | 7 |
| `ThreatBonusMelee` / `ThreatBonusRanged` / `ThreatBonusSpell` (tank aggro) | Slice 5 | 71 total |
| `Concealment`, `LesserDisplacement`, per-status Immunity variants | Slice 4 | small each |

Add `EngineResult` fields + breakdowns when the build-planner Breakdowns UI wants them.

## Offensive DPS additions (need enemy-state modeling)

| Item | Source | Why deferred |
|---|---|---|
| `HelplessDamage` (43 instances) | Slice 4 | Bonus damage WHEN ATTACKING helpless enemies. Needs an enemy-state input (helpless%). |
| `FortificationBypass` (46 instances) | Slice 4 | Bypasses enemy fortification on crit. Needs enemy fort modeling. |
| `DodgeBypass` (13 instances) | Slice 4 | Bypasses enemy dodge. Needs enemy dodge modeling. |
| To-hit family (Weapon_Attack, MeleeAttack, RangedAttack as bonuses) | Slice 2 | DPS engine assumes 100% hit vs unknown AC. To-hit math wakes up once AC modeling lands. |
| Per-direction sneak modifiers (already mostly handled, see "Engine accuracy") | Slice 5 | (Listed above.) |

## UI / build-editor (not engine; affects user experience)

| Item | Source | Notes |
|---|---|---|
| `<IncompatibleStance>` enforcement at toggle time (59 declarations) | Slice 7 | `useBuildStore.toggleStance` should deactivate incompatible stances when activating one. Currently user can activate conflicting stances simultaneously. |
| `<Type>ExclusionGroup</Type>` (261 instances) — caster element specialization, capstone choices | Slice 7 | Tree picker should prevent allocating AP to mutually-exclusive enhancements within the same exclusion group. |
| **Skill-point budget enforcement** (Phase 3.2 plan) | (plan) | Skill editor exists but no budget panel; budget formula sketched in `docs/use-the-current-folder-golden-floyd.md`. |
| **Stance auto-derivation UI** (badges on auto-on stances) | Slice 7 | Pair with the engine-side auto-stance work above. |

## Granted abilities (additive; build-planner concern)

| Item | Source | Notes |
|---|---|---|
| `<Type>GrantSpell</Type>` (78 instances) | Slice 6 | Adds a spell to the build's spellbook. Currently falls through to evaluator as `SpellInfo` → unmodeled-amount-type diagnostic. Future: `engine.grantedSpells[]` mirroring `slas[]`, surface in spellbook UI. |

## Spell catalog consumers (parsed but unused)

| Item | Source | Notes |
|---|---|---|
| **Per-spell `dcs[]` field unused** (245 spells carry SpellDC) | Slice 8 | Engine uses school-level DCs only. Per-spell DC overrides (multi-school spells, ModAbility swaps for heightened arcane, NoSave flagging) are lost. Two-stage fix: (1) surface in SpellsTab tooltip; (2) route through DPS once save-vs-DC math lands. |
| **Self-cast buff spell effects unused** (72 spells in Spells.xml only, not in SelfAndPartyBuffs.xml) | Slice 8 | Examples: Bull's Strength, Cat's Grace, Bear's Endurance, Adamantine Weapons, Armor of Speed. Spells.xml has `effects[]` but no `build.activeSpellBuffs` field. Future: unify under one buff list; let source XML choose activation UX, engine plumbing stays the same. |

## Niche / catalog gaps

| Item | Source | Notes |
|---|---|---|
| `Hireling*` effect types (defensive variants) | Slices 1-5 | Out of scope per project convention. |
| `Web Immunity`, `Petrification Immunity`, `BlindnessImmunity`, etc. as distinct types | Slice 4 | Should fold into a unified `Immunity` handler if/when Immunity is modeled. |
| `Construct Fortification (10%)` (1 instance, parser anomaly) | Slice 4 | Looks like a value baked into the type name. Investigate if/when other Construct-specific stats appear. |
| Niche `*AbilityClass` variants (per-weapon-class ability scaling) | Slice 2 | Affects rare enhancement-tree corners. |
| `SP breakdown` known undershoot (kemton 3,428 vs in-game 3,555) | (memory) | Gaps: Fate Points (60), Enhancement over-stack (145), Base (45), Feat bundle (175). Tracked separately. |

## Notes

- **No item here is a bug.** Each was a conscious choice to defer
  rather than expand a slice's scope. The audit doc for the citing
  slice has the full rationale.
- **Pick up criteria.** Most engine-accuracy items unlock once a
  related modeling decision lands (enemy state, AC, auto-stance
  layer). The build-planner stat items unlock when the Breakdowns UI
  surfaces those panels. UI/editor items unlock when the planner
  feature work resumes.
- **Don't move items here.** When an item gets resolved in a future
  commit, just delete its row (`git log` is the historical record).
