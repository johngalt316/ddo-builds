// Per-hit imbue damage riders.
//
// "Imbue Toggle" stances add a per-hit elemental damage rider to every
// weapon attack. Examples:
//   "Imbue Toggle: ... 1d6 Electric damage on each hit, scaling with
//    Electric Spell Power." (Battle Engineer Thundershock)
//   "Imbue Toggle: ... 1d8 fire damage on hit, scaling with 75% of your
//    Spell Power." (Arcane Archer Flaming Arrows)
//   "1d6 Poison damage on hit scaling with 100% of the higher of Melee
//    or Ranged power." (Ninja Spy Sting of the Ninja)
//
// Per DDO rules, imbue damage:
//   • does NOT benefit from per-ability scalars (Hand of Harm +30%
//     doesn't multiply imbue dice),
//   • DOES benefit from the Power stat named in the description (Spell
//     Power / Melee Power / Ranged Power, with optional % modifier),
//   • crits with the weapon (treated as flat damage on each attack).
//
// This module parses the stance description prose into a structured
// `ImbueRider`, then evaluates that rider against the current
// EngineResult to produce a per-hit average damage number that the
// melee / ranged DPS calculators add to their per-hit average.

import type { EngineResult } from '@/engine/runEngine';
import type { AvailableStance } from '@/engine/collectEffects';
import type { Build } from '@/types/build';

/** Which Power stat scales this rider. */
export type ImbueScalingStat =
  | 'sp'            // (Element-specific) Spell Power
  | 'universal_sp'  // Universal Spell Power
  | 'mp'            // Melee Power
  | 'rp'            // Ranged Power
  | 'higher_mr_p';  // max(Melee Power, Ranged Power)

export interface ImbueRider {
  /** Display label for the tooltip — usually the stance name. */
  source: string;
  diceNum: number;
  diceSides: number;
  /** Flat addend per dice instance (e.g. "1d6+3"). */
  diceBonus: number;
  /** Optional "per Imbue Dice" multiplier on the dice instance count.
   *  'flat' (default) = 1 instance per hit. 'imbueDie' = `engine.imbueDice.total`
   *  instances per hit (Arcane-Archer style). 'charLevel' = total char level. */
  diceMultiplier: 'flat' | 'imbueDie' | 'charLevel';
  /** Damage type — used to look up element-specific spell power when
   *  `scalingStat === 'sp'`. Matches `SpellDamageType` for known types;
   *  falls back to a raw label (e.g. "Bane", "Untyped"). */
  damageType: string;
  /** Power scaling percent (e.g. 100, 75, 150, 200). */
  scalingPct: number;
  /** Which Power stat scales the rider. */
  scalingStat: ImbueScalingStat;
}

const KNOWN_DAMAGE_TYPES = new Set([
  'Acid', 'Chaos', 'Cold', 'Electric', 'Evil', 'Fire', 'Force',
  'Light', 'Negative', 'Poison', 'Positive', 'Repair', 'Sonic',
  'Bane', 'Untyped', 'Bludgeoning', 'Piercing', 'Slashing',
  // Alignment-damage types — distinct in DDO from Light/Alignment.
  // Used by Inquisitive's Law on Your Side, Paladin's Holy Strike,
  // Divine Crusader's Aligned Damage, etc.
  'Law', 'Good',
]);

/** Parse an Imbue Toggle description into a structured rider.
 *  Returns null when the prose doesn't match the standard per-hit
 *  imbue grammar (e.g. defensive-only imbues like Aligned Arrows that
 *  bypass DR but don't add damage). */
export function parseImbueRider(source: string, description: string): ImbueRider | null {
  if (!description) return null;

  // Some imbues describe two conditional dice clauses, e.g.
  // "1d10 Law damage per Imbue Dice on hit to Chaotic creatures and
  //  1d6 Law damage on hit to all other creatures". The first clause
  // is the bonus-vs-subset case, the second is the general case. For
  // DPS modeling we use the general case (most fights aren't 100%
  // chaotic targets); the bonus-vs-X case is unmodeled. When the
  // sentinel phrase "to all other (creatures|enemies)" is present,
  // slice from the most recent " and " before it so the parser sees
  // only the default-case prose. Description is multi-line in XML so
  // we work with raw indexOf — line breaks don't affect substring math.
  let analysisText = description;
  const allOtherIdx = description.search(/\bto\s+all\s+other\s+(?:creatures|enemies)\b/i);
  if (allOtherIdx >= 0) {
    const before = description.slice(0, allOtherIdx);
    const lastAnd = before.lastIndexOf(' and ');
    if (lastAnd >= 0) {
      analysisText = description.slice(lastAnd + ' and '.length);
    }
  }

  // 1. Dice expression: "XdY" or "Xd[a/b/c]" (per-rank bracket — use the
  //    highest rank) with optional "+Z" bonus.
  const diceMatch = analysisText.match(/(\d+)d(?:\[(\d+(?:\/\d+)+)\]|(\d+))(?:\s*\+\s*(\d+))?/);
  if (!diceMatch) return null;
  const diceNum   = parseInt(diceMatch[1]!, 10);
  const diceSides = diceMatch[2]
    ? parseInt(diceMatch[2].split('/').pop()!, 10)
    : parseInt(diceMatch[3]!, 10);
  const diceBonus = diceMatch[4] ? parseInt(diceMatch[4], 10) : 0;

  // 2. Damage type — first known type word AFTER the dice expression
  //    and BEFORE "damage". "Electrical" normalizes to "Electric".
  const afterDice = analysisText.slice(diceMatch.index! + diceMatch[0].length);
  const typeMatch = afterDice.match(/\b(Acid|Chaos|Cold|Electrical|Electric|Evil|Fire|Force|Good|Law|Light|Negative|Poison|Positive|Repair|Sonic|Bane|Untyped|Bludgeoning|Piercing|Slashing)\b/i);
  if (!typeMatch) return null;
  let damageType = typeMatch[1]!;
  if (damageType.toLowerCase() === 'electrical') damageType = 'Electric';
  // Normalize capitalization to the catalog form.
  for (const t of KNOWN_DAMAGE_TYPES) {
    if (t.toLowerCase() === damageType.toLowerCase()) { damageType = t; break; }
  }

  // 3. Per-Imbue-Dice or per-character-level multiplier — read from the
  //    analysed clause so we don't pick up "per Imbue Dice" from a
  //    different (bonus-vs-X) clause that doesn't apply.
  let diceMultiplier: ImbueRider['diceMultiplier'] = 'flat';
  if (/per\s+Imbue\s+Di(?:e|ce)/i.test(analysisText)) {
    diceMultiplier = 'imbueDie';
  } else if (/per\s+(?:Character\s+)?Level/i.test(analysisText)) {
    diceMultiplier = 'charLevel';
  }

  // 4. Power scaling clause. Default 100% Spell Power when not stated.
  //    Same scaling applies regardless of which clause fired, so we
  //    read this off the full description (not the per-clause subset).
  let scalingPct: number = 100;
  let scalingStat: ImbueScalingStat = 'sp';
  // Match "scaling with [PCT%] [of [your]] [the higher of [your]] STAT (and/or STAT)? Power".
  // "of" is optional — some prose reads "200% Ranged Power", others read
  // "75% of your Spell Power". The pct + optional "of/of your" both
  // collapse into the same outcome.
  const scaleMatch = description.match(/scal\w+\s+with\s+(?:(\d+)%\s+(?:of\s+)?(?:your\s+)?)?(?:the\s+higher\s+of\s+(?:your\s+)?)?([\w\s/]+?)\s+Power/i);
  if (scaleMatch) {
    if (scaleMatch[1]) scalingPct = parseInt(scaleMatch[1], 10);
    const text = scaleMatch[2]!.toLowerCase();
    const hasMelee  = /\bmelee\b/.test(text);
    const hasRanged = /\branged\b/.test(text);
    const hasSpell  = /\bspell\b/.test(text);
    if (hasMelee && hasRanged) scalingStat = 'higher_mr_p';
    else if (hasMelee)         scalingStat = 'mp';
    else if (hasRanged)        scalingStat = 'rp';
    else if (hasSpell) {
      // "Electric Spell Power" → element-specific SP; "your Spell Power" → universal.
      const elemBeforeSP = text.match(/^(\w+)\s+spell$/);
      scalingStat = elemBeforeSP ? 'sp' : 'universal_sp';
    }
  }

  return {
    source,
    diceNum, diceSides, diceBonus,
    diceMultiplier,
    damageType,
    scalingPct,
    scalingStat,
  };
}

/** Per-hit average damage for one imbue rider, against an engine result.
 *  Does NOT apply crit weighting — callers do that, since imbue damage
 *  participates in the weapon's crit multiplier the same way per-hit
 *  flat damage does. */
export function imbueAvgPerHit(
  rider: ImbueRider,
  engine: EngineResult,
  totalCharLevel: number,
): number {
  const avgPerInstance = rider.diceNum * (rider.diceSides + 1) / 2 + rider.diceBonus;
  let instances = 1;
  if (rider.diceMultiplier === 'imbueDie') {
    instances = Math.max(1, engine.imbueDice.total);
  } else if (rider.diceMultiplier === 'charLevel') {
    instances = Math.max(1, totalCharLevel);
  }
  const baseDmg = avgPerInstance * instances;

  let powerStat: number;
  switch (rider.scalingStat) {
    case 'mp':           powerStat = engine.meleePower.total; break;
    case 'rp':           powerStat = engine.rangedPower.total; break;
    case 'higher_mr_p':  powerStat = Math.max(engine.meleePower.total, engine.rangedPower.total); break;
    case 'universal_sp': powerStat = engine.universalSpellPower.total; break;
    case 'sp': {
      // Element-specific Spell Power if the damage type maps to a tracked
      // school; fall back to universal otherwise.
      const sp = engine.spellPowers[rider.damageType as keyof typeof engine.spellPowers];
      powerStat = sp ? sp.total : engine.universalSpellPower.total;
      break;
    }
  }
  // Effective scaling = (scalingPct% × powerStat / 100) ratio → ×(1 + ratio).
  const ratio = (rider.scalingPct * powerStat) / 10000;
  return baseDmg * (1 + ratio);
}

/** Aggregate per-hit imbue damage across all active riders. */
export function totalImbueAvgPerHit(
  riders: readonly ImbueRider[],
  engine: EngineResult,
  totalCharLevel: number,
): number {
  return riders.reduce((sum, r) => sum + imbueAvgPerHit(r, engine, totalCharLevel), 0);
}

/** Pull active imbue toggles off the build + available-stance catalog
 *  and parse each one's description into a structured ImbueRider.
 *  Skips defensive-only imbues (Aligned/Metalline/Morphic Arrows — DR
 *  bypass without a damage clause) since their descriptions don't match
 *  the dice + scaling grammar. */
export function collectActiveImbueRiders(
  build: Build,
  available: readonly AvailableStance[],
): ImbueRider[] {
  const activeSet = new Set(build.activeStances ?? []);
  const out: ImbueRider[] = [];
  for (const stance of available) {
    if (stance.data.group !== 'Imbue') continue;
    if (!activeSet.has(stance.data.name)) continue;
    const rider = parseImbueRider(stance.data.name, stance.data.description);
    if (rider) out.push(rider);
  }
  return out;
}
