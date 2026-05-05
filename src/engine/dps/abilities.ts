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
import type { DDOSpellData, DDOSpellDamage, DDOClassData } from '@/types/ddoData';
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

function buildDisplayName(name: string, source: string, category: SLACategory): string {
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
      cooldownGroup: /Epic Strike\s*→/.test(sla.source) ? 'epic-strike' : undefined,
    });
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
