// Phase 6.2 — Ability catalog for the DPS rotation builder.
//
// A `MagicAbility` is the unit of a magic rotation: enough metadata to
// (a) display in the palette, (b) sit in the timeline, and (c) feed the
// damage / simulation passes coming in 6.3 / 6.4.
//
// Two sources contribute:
//   • Class-trained spells from build.trainedSpells × Spells.xml.
//   • SLAs (spell-like abilities) granted by feats / enhancements / gear /
//     past lives — `runEngine` collects these into `EngineResult.slas`.
//
// Only damaging entries (≥ 1 entry in the spell's `damages[]`) make it
// through; non-damaging spells / utility SLAs are filtered out.

import type { Build } from '@/types/build';
import { getActiveEnhancementSet } from '@/types/build';
import type { DDOSpellData, DDOSpellDamage, DDOClassData, EnhancementTreeData } from '@/types/ddoData';
import type { CollectedSLA, SLACategory } from '@/engine/runEngine';

export interface MagicAbility {
  /** Stable identifier — `${className}::${spellName}` for class spells,
   *  `sla::${spellName}::${sourceLabel}` for SLAs. */
  id: string;
  source: 'spell' | 'sla';
  /** Bare spell name (matches the spell catalog). */
  name: string;
  /** Name as shown in tiles / blocks. For SLAs we prefix a short source
   *  tag so duplicates from different sources are distinguishable, e.g.
   *  `[AT] Magic Missile` vs `[PL] Magic Missile`. Class spells use the
   *  bare `name`. */
  displayName: string;
  icon: string;
  school: string;
  /** SP cost per cast (after class / SLA override, if any). */
  cost: number;
  /** Cooldown in seconds. 0 = no cooldown (limited only by cast time). */
  cooldown: number;
  /** Per-rest charges (only meaningful for SLAs). 0 = unlimited; >0 means
   *  the SLA can fire at most that many times before resting. Class spells
   *  always set this to 0. */
  charges: number;
  /** Hard cap on the spell's caster level scaling. */
  maxCasterLevel: number;
  /** Per-element damage rolls. Phase 6.3 turns these into numbers. */
  damages: DDOSpellDamage[];
  /** Cast time in seconds. Estimated until per-spell timing data lands —
   *  default 1.0s for offensive spells, 2.0s for level 5+ heavy hitters. */
  castTime: number;
  // ── Class-spell only ───────────────────────────────────────────────
  /** Class that trained this spell (drives caster-level / DC scaling). */
  className?: string;
  /** 1–9 spell level the slot was filled at. */
  spellLevel?: number;
  // ── SLA only ───────────────────────────────────────────────────────
  /** Bucket the SLA's source falls into (feat / enhancement / gear / other). */
  slaCategory?: SLACategory;
  /** Human-readable source label, e.g. `[E] Arcane Trickster: Stolen Spell I`. */
  slaSource?: string;
  /** Cooldown-sharing group. When set, firing this ability also pushes
   *  every other ability with the same group onto cooldown — the
   *  classic "Epic Strike shared cooldown" pattern. Undefined = the
   *  ability is on its own private cooldown. */
  cooldownGroup?: string;
  /** True for self-buff clickies (e.g. Wellspring of Power) — abilities
   *  with no per-cast damage that the user wants in the rotation as
   *  buff triggers. The DPS calculator skips the "damages required"
   *  filter for these, so they slot in like any other SLA. The buff
   *  effect itself (SP / crit-damage modulation of subsequent casts)
   *  is modeled separately by the buff catalog when implemented. */
  isUtility?: boolean;
  /** UI bucket for the Manage / palette tabs:
   *    - 'damage' — has at least one non-healing damage roll
   *    - 'heal'   — only healing-flavored damage types (Positive,
   *                 Negative for undead-heals, Repair)
   *    - 'boost'  — utility / clickie with no damage rolls
   *  Computed by `categorizeAbility` once at construction. */
  category: AbilityCategory;
}

export type AbilityCategory = 'damage' | 'heal' | 'boost';

/** Damage types that count as healing (vs. offensive). Negative is
 *  ambiguous — it heals undead but damages everyone else. We treat it
 *  as a heal only when it's the *sole* damage type on the spell, since
 *  a mixed cure-with-radiant-burst spell still primarily exists for
 *  offense. */
const HEAL_DAMAGE_TYPES: ReadonlySet<string> = new Set(['Positive', 'Repair']);

function categorizeAbility(damages: DDOSpellDamage[], isUtility: boolean | undefined): AbilityCategory {
  if (isUtility) return 'boost';
  if (damages.length === 0) return 'boost';
  if (damages.every(d => HEAL_DAMAGE_TYPES.has(d.damageType))) return 'heal';
  return 'damage';
}

/**
 * Derive a short source tag for an SLA so duplicates of the same spell
 * from different sources can be told apart in the palette / timeline.
 *
 *   "[PL] Past Life: Arcane Initiate ×3"          → "PL"
 *   "[E] Arcane Trickster: Stolen Spell I"        → "AT"
 *   "[E] Mechanic: Tanglefoot"                    → "Mech"
 *   "[D] Shiradi Champion: Friend or Foe → Magic" → "SC"
 *   "[R] Dire Thaumaturge: …"                     → "DT"
 *   "[G] Trinket: …" / "[A] Boots: … → …"         → "Gear"
 */
export function deriveSlaTag(source: string, category: SLACategory): string {
  if (source.startsWith('[PL] ') || category === 'feat') return 'PL';
  // [E]/[D]/[R] <Tree Name>: …  → tree-name based tag.
  const treeName = source.match(/^\[(?:E|D|R)\]\s+([^:]+):/)?.[1]?.trim();
  if (treeName) {
    const words = treeName.split(/\s+/);
    if (words.length >= 2) {
      return words.map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 4);
    }
    // split on a non-empty trimmed string yields at least one non-empty word.
    const first = words[0]!;
    return first.length <= 4
      ? first
      : first[0]!.toUpperCase() + first.slice(1, 4).toLowerCase();
  }
  if (category === 'gear') return 'Gear';
  return 'SLA';
}

/** Source label pattern shared by every Epic Strike SLA. */
const EPIC_STRIKE_SOURCE_RE = /Epic Strike\s*→/;

function buildDisplayName(name: string, source: string, category: SLACategory): string {
  // Epic Strike SLAs use uniquely-named spells (Nightmare Lance, Boulder Smash, …)
  // — no need to disambiguate with a destiny tag.
  if (EPIC_STRIKE_SOURCE_RE.test(source)) return name;
  return `[${deriveSlaTag(source, category)}] ${name}`;
}

/**
 * Get every damaging ability the build can cast: class-trained spells +
 * granted SLAs. Returns sorted: class spells by (level, name), SLAs by
 * (category, name) appended after.
 */
export function getMagicAbilities(
  build: Build,
  spellCatalog: DDOSpellData[],
  classCatalog: DDOClassData[],
  slas: CollectedSLA[],
  enhancementTrees: EnhancementTreeData[] = [],
): MagicAbility[] {
  const spellByName = new Map<string, DDOSpellData>();
  for (const s of spellCatalog) spellByName.set(s.name, s);
  const classByName = new Map<string, DDOClassData>();
  for (const c of classCatalog) classByName.set(c.name, c);

  const classSpells: MagicAbility[] = [];
  const slaAbilities: MagicAbility[] = [];

  // ── Class-trained spells ───────────────────────────────────────────
  const trained = build.trainedSpells ?? {};
  for (const [className, levelMap] of Object.entries(trained)) {
    const cls = classByName.get(className);
    if (!cls) continue;
    for (const [levelStr, names] of Object.entries(levelMap)) {
      const spellLevel = Number(levelStr);
      if (!Number.isFinite(spellLevel)) continue;
      for (const name of names) {
        const data = spellByName.get(name);
        if (!data) continue;
        if (data.damages.length === 0) continue;       // not a DPS spell
        // Per-class override (cost / cooldown / maxCL) wins when present.
        const classSpell = cls.spells.find(cs => cs.name === name);
        const cost     = classSpell?.cost           ?? data.cost           ?? 0;
        const cooldown = classSpell?.cooldown       ?? data.cooldown       ?? 0;
        const maxCL    = classSpell?.maxCasterLevel ?? data.maxCasterLevel ?? 0;
        classSpells.push({
          id: `${className}::${name}`,
          source: 'spell',
          name,
          displayName: name,
          icon: data.icon,
          school: data.school,
          className,
          spellLevel,
          cost,
          cooldown,
          charges: 0,                      // class spells are unlimited
          maxCasterLevel: maxCL,
          damages: data.damages,
          castTime: spellLevel >= 5 ? 2.0 : 1.0,
          category: categorizeAbility(data.damages, false),
        });
      }
    }
  }

  // ── SLAs (feat / enhancement / gear / other) ───────────────────────
  // Same SLA name from multiple sources is kept as separate abilities so
  // the user can see and fire each individually (cooldowns differ).
  for (const sla of slas) {
    const data = spellByName.get(sla.name);
    if (!data) continue;
    if (data.damages.length === 0) continue;
    // SLA-side metadata wins when the granting effect specifies it; many
    // sources (e.g. Past Life: Arcane Initiate's Magic Missile carries
    // `<Amount>0 0 0 0</Amount>`) don't, so fall back to the underlying
    // spell catalog for cost / cooldown / maxCL.
    slaAbilities.push({
      id: `sla::${sla.name}::${sla.source}`,
      source: 'sla',
      name: sla.name,
      displayName: buildDisplayName(sla.name, sla.source, sla.category),
      icon: data.icon,
      school: data.school,
      cost:           sla.cost           || data.cost           || 0,
      cooldown:       sla.cooldown       || data.cooldown       || 0,
      charges:        sla.charges        || 0,
      maxCasterLevel: sla.maxCasterLevel || data.maxCasterLevel || 0,
      damages: data.damages,
      // SLAs typically cast quickly; same heuristic as spells for now.
      castTime: 1.0,
      slaCategory: sla.category,
      slaSource: sla.source,
      // Epic Strike SLAs share a cooldown across the whole group: firing
      // any of them puts every other Epic Strike on cooldown until that
      // one is ready again. Detected via the source label tail
      // ("Epic Strike → Nightmare Lance" etc.) which the destiny trees
      // use uniformly. Other shared-CD groups can be added by detecting
      // their source pattern here.
      cooldownGroup: EPIC_STRIKE_SOURCE_RE.test(sla.source) ? 'epic-strike' : undefined,
      category:    categorizeAbility(data.damages, false),
    });
  }

  // ── Utility self-buff clickies (no damage, but selectable) ──────────
  // Some feats grant clicky self-buffs that aren't tagged
  // `<Type>SpellLikeAbility</Type>` in the source XML, so they don't
  // surface through `engine.slas`. The user still wants them in the
  // rotation palette to model their cooldown / cast time / buff
  // contribution. List them here, gated on the granting feat being
  // trained.
  for (const u of UTILITY_ABILITIES) {
    if (!u.isAvailable(build)) continue;
    slaAbilities.push({
      id:             `utility::${u.featId}`,
      source:         'sla',
      name:           u.name,
      displayName:    u.name,
      icon:           u.icon,
      school:         '',
      cost:           u.cost,
      cooldown:       u.cooldown,
      charges:        0,
      maxCasterLevel: 0,
      damages:        [],
      castTime:       u.castTime,
      slaCategory:    'feat',
      slaSource:      `${u.featId} (feat)`,
      isUtility:      true,
      category:       'boost',
    });
  }

  // ── Clickie enhancements (action boosts, reaper boosts, racial clickies) ──
  // Every `<Clickie/>`-tagged enhancement the user has spent ranks in
  // becomes a utility ability. Cooldown is best-effort scraped from the
  // description text since the source data doesn't carry it as a field.
  for (const c of collectClickieAbilities(build, enhancementTrees)) {
    slaAbilities.push(c);
  }

  classSpells.sort((a, b) =>
    (a.spellLevel ?? 0) - (b.spellLevel ?? 0) || a.name.localeCompare(b.name));
  slaAbilities.sort((a, b) => {
    const ca = a.slaCategory ?? 'other';
    const cb = b.slaCategory ?? 'other';
    return ca.localeCompare(cb) || a.name.localeCompare(b.name);
  });

  return [...classSpells, ...slaAbilities];
}

/** Self-buff clickies that the engine doesn't surface through
 *  `<SpellLikeAbility>` effects but the user wants in their rotation. */
interface UtilityAbilityEntry {
  featId:     string;
  name:       string;
  icon:       string;
  cost:       number;
  cooldown:   number;
  castTime:   number;
  isAvailable: (build: Build) => boolean;
}

const UTILITY_ABILITIES: UtilityAbilityEntry[] = [
  {
    // Epic feat at character level 21. Activate for +150 Universal
    // Spell Power and +20% Spell Critical Damage for 30s; 3-minute
    // cooldown. Modeled here because the source XML tags it as a
    // stance, not a SpellLikeAbility, so the standard SLA collector
    // skips it.
    featId:   'Wellspring of Power',
    name:     'Wellspring of Power',
    icon:     'WellspringOfPower',
    cost:     0,
    cooldown: 180,
    castTime: 0.5,
    isAvailable: (build) =>
      build.feats.some(f => f.featId === 'Wellspring of Power'),
  },
];

/**
 * Pull cooldown (in seconds) out of a clickie's description text. DDO
 * descriptions phrase it as "Cooldown: 30 seconds", "30 second cooldown",
 * or "Cooldown: 3 minutes". Returns undefined when nothing matches —
 * callers fall back to a sensible default.
 */
export function parseClickieCooldown(description: string): number | undefined {
  if (!description) return undefined;
  // "Cooldown: 30 seconds" / "Cooldown: 1 minute"
  // tolerate "Cooldown:30s" and trailing "(s)".
  const colonForm = description.match(/Cooldown:\s*([\d.]+)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/i);
  if (colonForm) {
    const n = parseFloat(colonForm[1]!);
    return /^m/i.test(colonForm[2]!) ? n * 60 : n;
  }
  // "30 second cooldown" / "3 minute cooldown"
  const inlineForm = description.match(/([\d.]+)\s*(seconds?|secs?|s|minutes?|mins?|m)\s+cooldown/i);
  if (inlineForm) {
    const n = parseFloat(inlineForm[1]!);
    return /^m/i.test(inlineForm[2]!) ? n * 60 : n;
  }
  return undefined;
}

/**
 * Walk the active enhancement set and return one MagicAbility per
 * `<Clickie/>`-tagged item the user has spent ranks in. Covers heroic,
 * destiny, and reaper trees uniformly — the parsed item shape is the
 * same across all three.
 *
 * Untaken items (rank <= 0) are skipped. Items whose tree isn't in the
 * passed-in catalog (e.g. legacy save with a deprecated tree) are also
 * skipped quietly.
 */
function collectClickieAbilities(
  build: Build,
  trees: EnhancementTreeData[],
): MagicAbility[] {
  if (trees.length === 0) return [];
  const treeIdx = new Map<string, EnhancementTreeData>();
  for (const t of trees) treeIdx.set(t.name.toLowerCase(), t);

  const set = getActiveEnhancementSet(build);
  const allSpends = [
    ...set.enhancements.map(s => ({ spend: s, scope: 'E' as const })),
    ...set.destinyEnhancements.map(s => ({ spend: s, scope: 'D' as const })),
    ...set.reaperEnhancements.map(s => ({ spend: s, scope: 'R' as const })),
  ];

  const out: MagicAbility[] = [];
  const seen = new Set<string>();
  for (const { spend, scope } of allSpends) {
    const tree = treeIdx.get(spend.treeId.toLowerCase());
    if (!tree) continue;
    for (const e of spend.enhancements) {
      if (e.rank <= 0) continue;
      const item = tree.items.find(i => i.internalName === e.enhancementId)
                ?? tree.items.find(i => i.name === e.enhancementId);
      if (!item || !item.clickie) continue;

      const id = `clickie::${tree.name}::${item.internalName || item.name}`;
      if (seen.has(id)) continue;
      seen.add(id);

      // Reaper-tree clickies: 3 ranks scale a numeric bonus but only one
      // ability button. Heroic/destiny clickies follow the same pattern.
      // Cooldown comes from the description; fall back to 30s for action
      // boosts and 60s for everything else (matches DDO defaults).
      const cd = parseClickieCooldown(item.description);
      const cooldown = cd ?? (scope === 'R' ? 60 : 30);

      out.push({
        id,
        source:         'sla',
        name:           item.name,
        displayName:    `[${scope}] ${item.name}`,
        icon:           item.icon || 'ActionBoost',
        school:         '',
        cost:           0,
        cooldown,
        charges:        0,
        maxCasterLevel: 0,
        damages:        [],
        castTime:       0.5,
        slaCategory:    'enhancement',
        slaSource:      `[${scope}] ${tree.name}: ${item.name}`,
        isUtility:      true,
        category:       'boost',
      });
    }
  }
  return out;
}
