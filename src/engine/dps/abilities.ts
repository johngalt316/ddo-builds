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
   *    - 'damage'  — has at least one offensive damage roll (real or placeholder)
   *    - 'heal'    — only healing-flavored damage types (Positive, Repair)
   *    - 'boost'   — duration-bounded self-buff with no damage component
   *    - 'cc'      — crowd control (stun / paralyze / hold / daze / fear …)
   *    - 'debuff'  — applies a negative effect to enemies (vulnerability,
   *                  threat, fortification reduction)
   *    - 'utility' — movement, summons, lock-bash, illusion, etc.
   *  Computed by `categorizeAbility` once at construction. */
  category: AbilityCategory;
  /** True when the ability has no damage rolls in our catalog yet but
   *  deals damage in-game (typically clickies whose tree XML doesn't
   *  carry roll data). The DPS calculator treats these as zero-damage
   *  for now; the UI surfaces a placeholder indicator so the user
   *  knows the displayed damage isn't real. */
  placeholderDamage?: boolean;
}

export type AbilityCategory = 'damage' | 'heal' | 'boost' | 'cc' | 'debuff' | 'utility';

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
 * Classify a clickie enhancement from its description text. Returns
 * `null` when the entry is a no-duration passive (e.g. "Improved Power
 * Attack: your attacks deal +N damage") that the user shouldn't see
 * in the rotation palette — those belong on the Stances/Enhancements
 * pages, not as click-to-cast abilities.
 *
 * Order matters: damage / heal / cc detection wins over the generic
 * "has duration → boost" fallback so a stunning attack with a damage
 * line lands in the Damage tab where the user expects it.
 */
export function classifyClickie(description: string): { category: AbilityCategory; placeholderDamage: boolean } | null {
  const desc = (description ?? '').toLowerCase();
  if (!desc) return null;

  const hasDamage = /\bdamage\b|\d+d\d+|deal[s]? \w+ damage|\bnecrotic\b|\beldritch\b/.test(desc)
                 && !/^passive[: ]/.test(desc);
  const hasHeal   = /\b(heal|cure|restore[s]? \d|positive energy|hit points per caster level)\b/.test(desc);
  const hasCC     = /\b(stun|paralyze|hold|daze|fear|sleep|charm|incapacit|knockdown|trip|petrif|flat-?footed|helpless)\w*/.test(desc);
  const hasDebuff = /\b(vulnerab|fortification reduc|threat|hate|more likely to attack|expos|reduces? .* (?:armor|prr|saving|ac|dr))\w*/.test(desc);
  const hasDuration = /\bfor (?:up to )?\d+(?:\.\d+)? (?:second|minute|turn)s?\b|action boost/.test(desc);

  if (hasDamage)   return { category: 'damage',  placeholderDamage: true  };
  if (hasHeal)     return { category: 'heal',    placeholderDamage: true  };
  if (hasCC)       return { category: 'cc',      placeholderDamage: false };
  if (hasDebuff)   return { category: 'debuff',  placeholderDamage: false };
  if (hasDuration) return { category: 'boost',   placeholderDamage: false };

  // Movement / summons / illusion / utility clickies — keep them in
  // the palette but under the Utility tab so they don't pollute Boosts.
  if (/\b(teleport|jaunt|misty step|dimension door|invisibil|displacement|summon|find familiar|conjure|stoneskin|mage armor|spell resistance|deathward|death ward|true seeing|freedom of movement|haste|expeditious)\w*/.test(desc)) {
    return { category: 'utility', placeholderDamage: false };
  }
  // No active effect we recognize → passive enhancement (filter out).
  return null;
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
 * Total reaper-charge pool: 1 baseline + 1 per reaper-tree clickie taken
 * + 1 per "Reaper's Charge" enhancement (DireCharge / DAReapersCharge /
 * GrimReapersCharge — all stack). Returns 0 when no reaper boost is
 * trained, since the baseline only kicks in once the user is committed
 * to a reaper boost.
 *
 * Kemton's reaper spends (9 boosts + 3 charge enhancements) → 13 charges.
 */
export function computeReaperCharges(
  build: Build,
  trees: EnhancementTreeData[],
): number {
  if (trees.length === 0) return 0;
  const treeIdx = new Map<string, EnhancementTreeData>();
  for (const t of trees) treeIdx.set(t.name.toLowerCase(), t);
  const set = getActiveEnhancementSet(build);

  let boostsTaken = 0;
  let chargeEnhancements = 0;
  for (const spend of set.reaperEnhancements) {
    const tree = treeIdx.get(spend.treeId.toLowerCase());
    if (!tree) continue;
    for (const e of spend.enhancements) {
      if (e.rank <= 0) continue;
      const item = tree.items.find(i => i.internalName === e.enhancementId)
                ?? tree.items.find(i => i.name === e.enhancementId);
      if (!item) continue;
      if (item.clickie) {
        boostsTaken++;
        continue;
      }
      // Prefer the structured `MaxReaperCharge` effect when the XML
      // carries one (each rank's amount adds, normally 1). Falls back
      // to a regex on the description for items not yet annotated.
      const maxReaperCharge = item.effects
        .filter(eff => eff.types.includes('MaxReaperCharge'))
        .reduce((sum, eff) => sum + (eff.amount?.[Math.min(e.rank, eff.amount.length) - 1] ?? 0), 0);
      if (maxReaperCharge > 0) {
        chargeEnhancements += maxReaperCharge;
      } else if (/\+1 (?:to )?(?:maximum )?reaper charge/i.test(item.description)) {
        chargeEnhancements++;
      }
    }
  }
  if (boostsTaken === 0) return 0;          // never used → 0
  return 1 + boostsTaken + chargeEnhancements;
}

/**
 * Total action-boost charge pool: 5 baseline + extras from gear /
 * enhancement / destiny / racial. Sources are detected by description
 * pattern since the upstream data doesn't model these mechanically:
 *
 *   • "+N Action Boost charges" / "+N to Action Boost charges"
 *     (augments + item buffs descriptions)
 *   • "use each of your action boosts N additional times per rest"
 *     (Battle Engineer, Frenzied Berserker "Extra Action Boost", etc.)
 *
 * Returns the fully-expanded charge count for any single action-boost
 * clickie (action boosts share one pool in-game, so this is what each
 * boost can reach if all charges go to it).
 */
export function computeActionBoostCharges(
  build: Build,
  trees: EnhancementTreeData[],
): number {
  let extra = 0;
  // Walk every taken enhancement (heroic + destiny + reaper) for description
  // matches. The reaper trees don't grant action-boost charges, but the
  // walk's symmetric and the regex won't false-match.
  if (trees.length > 0) {
    const treeIdx = new Map<string, EnhancementTreeData>();
    for (const t of trees) treeIdx.set(t.name.toLowerCase(), t);
    const set = getActiveEnhancementSet(build);
    const spendLists = [set.enhancements, set.destinyEnhancements, set.reaperEnhancements];
    for (const spendList of spendLists) {
      for (const spend of spendList) {
        const tree = treeIdx.get(spend.treeId.toLowerCase());
        if (!tree) continue;
        for (const e of spend.enhancements) {
          if (e.rank <= 0) continue;
          const item = tree.items.find(i => i.internalName === e.enhancementId)
                    ?? tree.items.find(i => i.name === e.enhancementId);
          if (!item) continue;
          // Prefer the structured `ExtraActionBoost` effect when the
          // XML carries one (Half-Orc + most other Extra Action Boost
          // enhancements already do — Battle Engineer / Frenzied
          // Berserker variants don't yet, hence the regex fallback).
          const fromEffect = item.effects
            .filter(eff => eff.types.includes('ExtraActionBoost'))
            .reduce((sum, eff) => sum + (eff.amount?.[Math.min(e.rank, eff.amount.length) - 1] ?? 0), 0);
          if (fromEffect > 0) extra += fromEffect;
          else                extra += extractActionBoostExtras(item.description, e.rank);
        }
      }
    }
  }
  // Augment descriptions on equipped gear ("+N Enhancement bonus to
  // Action Boost charges" — Vecna Unleashed's Legendary Moment to
  // Legendary Moment etc.).
  for (const gearSet of build.gearSets ?? []) {
    if (gearSet.name !== build.activeGearSet) continue;
    for (const item of gearSet.items) {
      for (const aug of item.augmentSlots ?? []) {
        if (!aug.selectedAugment) continue;
        // We don't have augment descriptions in the GearItem; the
        // augment catalog isn't passed in here. Fall back to a
        // name-based heuristic for the few augments that grant charges.
        const m = aug.selectedAugment.match(/\+(\d+).*action boost charges?/i);
        if (m) extra += parseInt(m[1]!, 10);
      }
    }
  }
  return 5 + extra;
}

function extractActionBoostExtras(description: string, rank: number): number {
  if (!description) return 0;
  // "+N Enhancement bonus to Action Boost charges" — direct add.
  const direct = description.match(/\+(\d+)\b[^.\n]*action boost charges?/i);
  if (direct) return parseInt(direct[1]!, 10);
  // "use each of your action boosts [1/2/3] additional times per rest"
  // — value is per-rank from a [a/b/c] table; pick the user's rank.
  const tabular = description.match(/\[([\d/]+)\][^.\n]*additional times per rest/i);
  if (tabular) {
    const tiers = tabular[1]!.split('/').map(s => parseInt(s, 10));
    const idx = Math.min(rank, tiers.length) - 1;
    return tiers[idx] ?? 0;
  }
  // "use each of your action boosts N additional times per rest" — fixed N.
  const fixed = description.match(/(\d+)\s+additional times? per rest/i);
  if (fixed) return parseInt(fixed[1]!, 10);
  return 0;
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

  // Pre-compute the build's charge pools. Reaper boosts share one pool;
  // action boosts share another. We stamp each clickie with the full
  // pool size so the user sees how many uses they have available — the
  // timeline can't yet model "shared pool depletes faster when multiple
  // boosts are slotted", but the per-ability cap is at least honest.
  const reaperCharges      = computeReaperCharges(build, trees);
  const actionBoostCharges = computeActionBoostCharges(build, trees);

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
      // Stolen Spell / Epic Strike-style clickies grant the actual SLA
      // through a `<SpellLikeAbility>` effect (on the item itself or on
      // a chosen selection). Those entries already come through the
      // standard SLA pipeline above as damaging SLAs — skip them here
      // so we don't double-list the "[E] Stolen Spell I" wrapper.
      const grantsSLA = (effs: { types: string[] }[]) =>
        effs.some(ef => ef.types.includes('SpellLikeAbility'));
      if (grantsSLA(item.effects)) continue;
      if (item.selector?.some(sel => grantsSLA(sel.effects))) continue;

      // Category + placeholderDamage: prefer `<Category>` / `<PlaceholderDamage/>`
      // tags on the XML when present; otherwise classify from the description.
      // `null` from the classifier means "passive enhancement, no duration,
      // no active effect" — those belong on the Enhancements / Stances
      // pages, not the active-spells palette.
      let category: AbilityCategory;
      let placeholderDamage: boolean;
      if (item.category) {
        category = item.category;
        placeholderDamage = item.placeholderDamage ?? false;
      } else {
        const classified = classifyClickie(item.description);
        if (!classified) continue;
        category          = classified.category;
        placeholderDamage = classified.placeholderDamage;
      }

      const id = `clickie::${tree.name}::${item.internalName || item.name}`;
      if (seen.has(id)) continue;
      seen.add(id);

      // Cooldown: prefer the XML's `<Cooldown>` (single value or
      // per-rank `<Cooldown size="N">`). Falls back to a description
      // regex, and finally to a 30s heroic / 60s reaper default so the
      // timeline always has something to work with.
      const xmlCooldown = item.cooldownSecondsByRank
        ? item.cooldownSecondsByRank[Math.min(e.rank, item.cooldownSecondsByRank.length) - 1]
        : item.cooldownSeconds;
      const cooldown = xmlCooldown
        ?? parseClickieCooldown(item.description)
        ?? (scope === 'R' ? 60 : 30);

      // Charge-pool selection: prefer `<UsesReaperCharge/>` /
      // `<UsesActionBoostCharge/>` flags on the XML; otherwise infer
      // from the tree scope (reaper) or a name/description match
      // ("action boost").
      const isReaperBoost = item.usesReaperCharge ?? (scope === 'R');
      const isActionBoost = item.usesActionBoostCharge
        ?? (!isReaperBoost
            && /\baction boost\b/i.test(item.name + ' ' + item.description));
      const charges = isReaperBoost
        ? reaperCharges
        : isActionBoost
          ? actionBoostCharges
          : 0;

      out.push({
        id,
        source:         'sla',
        name:           item.name,
        displayName:    `[${scope}] ${item.name}`,
        icon:           item.icon || 'ActionBoost',
        school:         '',
        cost:           0,
        cooldown,
        charges,
        maxCasterLevel: 0,
        damages:        [],
        castTime:       0.5,
        slaCategory:    'enhancement',
        slaSource:      `[${scope}] ${tree.name}: ${item.name}`,
        isUtility:      true,
        category,
        placeholderDamage,
      });
    }
  }
  return out;
}
