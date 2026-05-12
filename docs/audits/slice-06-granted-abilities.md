# Slice 6 — Granted Abilities Audit

**Date:** 2026-05-11
**Scope:** SpellLikeAbility, GrantFeat, GrantSpell. These are the
  effect types that grant *new capabilities* (a clicky, a feat slot, a
  spell on the spellbook) rather than modifying an existing stat.
**Status:** complete (audit + 1 inline fix). One real gap closed
  (GrantFeat); SpellLikeAbility already handled; GrantSpell deferred.

## Coverage matrix

| Effect type | Total instances | Handler | Status |
|---|---:|---|---|
| `SpellLikeAbility` | 427 | `runEngine.ts:296` SLA early-return → `slas[]` | ✅ — fully captured (cost, charges, cooldown, max CL); displayed in DPS pane |
| `GrantFeat` | 169 | `collectEffects.ts` Section 9 (NEW) | ✅ — **fix this slice**; expands to granted feat's own effects + adds feat name to ctx.feats |
| `GrantSpell` | 78 | — | ⚠ — see Issue 2 |

`<Type>Stance</Type>` is a requirement type (2,730 instances across the
data — gates effects on the user having a stance active), not an
effect — covered in Slice 7.

## Issues found

### Issue 1 — `<Type>GrantFeat</Type>` not expanded (MEDIUM) — **FIXED 2026-05-11**

**Severity.** Medium for accuracy. 169 instances of `<Type>GrantFeat</Type>`
across enhancement trees, race XMLs, and a few class XMLs. The grant
effect itself emits no Bonus — its purpose is to put the named feat
into the build's repertoire. Previously the effect type was in the
known-types catalog (so it didn't show as an unmodeled diagnostic) but
no handler expanded it. Result: the granted feat's effects were never
fired. The most visible miss was **Magical Training granted by Shiradi
Champion / Shadowdancer / Machrotechnic destinies on a non-caster**.

**Top granted feats (by GrantFeat instance count).** 86 distinct feats
total; the long tail is mostly proficiency feats (Tower Shield, Exotic
Weapon, armor proficiencies) with no measurable bonuses.

| Granted feat | Instances | Has measurable effects? |
|---|---:|---|
| Magical Training | 12 | ✅ — +80 SP, +5 universal spell crit, spell-cast unlock |
| Deflect Arrows | 11 | ❌ — passive proc, no Bonus |
| Quick Draw | 8 | ❌ — animation speed only |
| Evasion | 7 | ❌ — save-reflex zero-on-success; not modeled |
| Diehard | 6 | ❌ — stay alive at -10 HP; flag |
| Favored Enemy: × | 5 each × many | ✅ — sneak damage / MP vs type (build-planner-relevant, not DPS without enemy modeling) |
| Magical Beast, Reptilian, Animal, Dragon, etc. | 3–5 each | (same) |
| Exotic Weapon Proficiency: Bastard Sword | 4 | ❌ — proficiency flag |
| Augment Summoning | 3 | ✅ — pet stats; not modeled |
| Slippery Mind | 3 | ❌ — second save vs enchantment |
| Light/Medium/Tower Armor Proficiency | 2 each | ❌ — proficiency flag |

So the **headline fixture impact** is Magical Training: enables +5
UniversalSpellCriticalChance per source, multiplying across destinies
that grant it.

**Resolution.** Added Section 9 to `collectEffects.ts`. After all other
sources finish walking, scan the emitted effects for `GrantFeat`:

```typescript
// In collectEffects, after Section 8:
for (const se of out.slice()) {                       // snapshot — no chained grants
  if (!se.effect.types.includes('GrantFeat')) continue;
  const featName = se.effect.items?.[0];
  const data    = featIdx.get(featName.toLowerCase());
  if (!data) { unmatched.push(featName); continue; }
  grantedFeatNames.add(data.name);
  for (const eff of data.effects) {
    grantedEffects.push({
      effect: { ...eff, requirements: mergeRequirements(eff.requirements, se.effect.requirements) },
      source: `${se.source} → ${data.name}`,
      rankCount: 1,
    });
  }
}
```

Three subtleties:
- **Requirement inheritance.** The GrantFeat effect's own
  `<Requirements>` (race / class level / destiny tier) are AND-merged
  onto each granted-feat effect's `<Requirements>` so the gates flow
  through. A grant gated on "Race=Aasimar" doesn't fire the granted
  feat for non-Aasimar builds.
- **Granted-feat names join ctx.feats.** `buildBuildContext` accepts a
  `grantedFeats` parameter; `runEngine` was reordered to call
  `collectEffects` first, then build ctx with grantedFeats merged in.
  This makes downstream `<Type>Feat</Type>` requirements gating on the
  granted name pass.
- **No chained grants.** Iterates a snapshot of `out` so granted
  effects appended during the loop aren't re-scanned. No instance of a
  GrantFeat-granting-a-GrantFeat exists in the current data; if one
  ever appears the loop would need to be made iterative.

**Fixture snapshot deltas (all correct):**

| Fixture | Effects added | Topline change |
|---|---:|---|
| kemton (Arcane Trickster) | +9 sourced, +8 bonuses | Universal spell crit 27 → 42 (3 new Magical Training grants from destinies) |
| maetrim (Monk) | +6 sourced, +6 bonuses | Universal spell crit 5 → 10 (Shadow Training Magical Training grant) |
| yings (Monk) | +3 sourced, +3 bonuses | Same as maetrim |
| zentek | no change | No destiny-driven GrantFeat grants apply |

Snapshots updated. 4 new unit tests in `tests/engine/grantFeat.test.ts`
cover: fires granted effects, joins ctx.feats, inherits requirements,
unknown-feat-name path.

### Issue 2 — `<Type>GrantSpell</Type>` not modeled (LOW, deferred)

**Severity.** Low. 78 instances, concentrated in iconic / racial XMLs
(Dark Bargainer Tiefling, etc.) and a few destiny / SLA-adjacent
slots.

**Symptom.** Adds a spell to the build's spellbook. Similar shape to
SpellLikeAbility but the cast comes from the player's spell list, not
a clicky button. Currently falls through to the effect evaluator with
`AType=SpellInfo` — gets categorized as unmodeled-amount-type and the
diagnostic counter ticks. No bonuses emitted.

**Why deferred.** Spellbook membership is a Build-Planner concern, not
a stat one. The DPS engine doesn't yet enumerate available spells on a
caster (it relies on the user picking spells via the rotation UI); a
GrantSpell entry would only matter once that UI knows about the
granted spell. Even then it's additive to spell-list completeness, not
to per-cast damage math.

**Recommended later.** Either:
- Add a `grantedSpells: GrantedSpell[]` field to `EngineResult` whose
  shape mirrors `slas[]` (name, casting class, max caster level), so
  the spell picker UI can read it; or
- Surface the granted-spell list inline in the spellbook UI when one
  is built, sourcing directly from `GrantSpell` walks of the build's
  enhancement tree spend.

## Sample verification

- **Kemton's Shiradi Champion: Fey Favor → Magical Training.** A
  destiny enhancement that grants Magical Training. The granted feat's
  +5 UniversalSpellCriticalChance now fires; appears in the engine
  snapshot with source `[D] Shiradi Champion: Shiradi Champion: Fey
  Favor → Magical Training`. ✅
- **Maetrim's Shadowdancer: Shadow Training → Magical Training.**
  Monk build picking up Shadow Training (the destiny core) gains
  Magical Training; universal spell crit 5 → 10. ✅
- **Kemton's SLAs.** All 14 enhancement-tree SLAs (Reconstruct,
  Curative Admixture, Shiradi Mantle abilities, etc.) appear in
  `engine.slas[]` with cooldown / SP cost / max CL preserved. ✅
- **Yings's Light Armor Proficiency from race / class autofeats.**
  Proficiency feats with no Bonus-emitting effects: silently absent
  from the snapshot, as expected. ✅

## What changed during the audit

- `src/engine/collectEffects.ts` — added `mergeRequirements` helper;
  Section 9 GrantFeat expansion; `grantedFeats` field on return shape;
  `grantedFeats` parameter on `buildBuildContext`.
- `src/engine/runEngine.ts` — reordered: `collectEffects` runs before
  `buildBuildContext` so granted feats can land in ctx.feats.
- `tests/engine/grantFeat.test.ts` — 4 unit tests for the expansion.
- `tests/snapshots/{kemton,maetrim,yings}.engine.snap.json` — updated
  to reflect newly-firing granted-feat effects.

## Next slice

**Slice 7 — Stances + exclusions** (structural). `<Type>Stance</Type>`
requirements (2,730 instances) — already gated through
`evaluateEffect.ts:123` (`case 'Stance'`), but the inventory of which
stances are reachable, mutually-exclusive groupings, and toggle UI
plumbing deserves a dedicated audit pass. Includes `ExclusionGroup`
(261) and `GroupMember` (85) — DDO's mechanism for "you can only have
one of these stances on at a time".
