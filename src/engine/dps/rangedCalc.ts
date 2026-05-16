// Ranged DPS calculator — MVP
//
// Computes auto-attack DPS for ranged builds (bow / crossbow / repeating
// crossbow / thrown) from a weapon + build-stats snapshot. Mirrors
// `meleeCalc.ts` but with the ranged-specific stat plumbing:
//
//   - Doubleshot (instead of Doublestrike) — % chance of an extra projectile
//     per shot. Stacks on top of base APM exactly like Doublestrike does
//     for melee.
//   - Ranged Power (instead of Melee Power) — same multiplicative scaling
//     for damage.
//   - Ranged Alacrity (instead of Melee Alacrity) — passive 15% cap.
//   - DEX is the canonical damage stat for ranged (most weapons; a few
//     exotic crossbows let INT replace via `Weapon_DamageAbility`).
//
// Out of scope for MVP (deferred to a "full" ranged pass):
//   - Manyshot 6s burst window (additional projectiles for 6 seconds,
//     30s cooldown). Modeled as base APM only for now.
//   - Imbue Dice — Slaying Arrows / Arcane Archer imbues that add per-hit
//     dice. Engine surfaces `imbueDice.total` but this MVP doesn't
//     fold it into the per-hit damage.
//   - Repeating crossbow 3-bolt burst pattern — treated as smoothed
//     average rate.
//   - Thrown weapons' return-to-thrower animation impact on APM.

import type { Build, GearItem } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import { abilityModifier } from '@/engine';
import { stackBonuses } from '@/engine/bonusStacking';
import type { Stat } from '@/types/build';
import { critRangeBonusForWeapon, weaponClassBonusesForWeapon, detectImprovedCritical } from './meleeCalc';

export type RangedCategory = 'bow' | 'crossbow' | 'repeating-crossbow' | 'thrown';

export interface RangedWeaponInfo {
  name: string;
  /** Raw DDO weapon type from the item catalog (e.g. "Longbow", "Heavy
   *  Crossbow", "Repeating Light Crossbow"). Used to look up weapon-type-
   *  gated effects. */
  weaponType: string;
  category: RangedCategory;
  /** Weapon W multiplier from `<WeaponDamage>` in the item data. */
  wScalar: number;
  diceNum: number;
  diceSides: number;
  diceBonus: number;
  enchantBonus: number;
  /** Raw d20 faces that threaten a crit before feat doubling (1 = 20-only). */
  critThreatBase: number;
  critMultiplier: number;
  attackStat: 'Strength' | 'Dexterity';
}

export interface RangedBuildStats {
  statMod: number;
  damageStat: Stat;
  rangedPower: number;
  doubleshot: number;        // %
  rangedAlacrity: number;    // %, passive (capped at 15 in rangedDPS)
  /** Time-averaged Action Boost alacrity from rotation boosts (Haste
   *  Boost, Action Boost: Speed). Multiplies with passive, no cap. */
  actionBoostAlacrity: number;
  seeker: number;
  hasImprovedCritical: boolean;
  critRangeBonus: number;
  critMultBonus: number;
  critMult1920Bonus: number;
  wBonus: number;
  flatDmgBonus: number;
  /** Percentage physical damage bonus (Primal Force +2% etc.). */
  physDamagePct: number;
}

export interface RangedDPSResult {
  avgBaseDamage: number;
  avgScaledDamage: number;
  avgPerHit: number;
  critThreatFaces: number;
  critChance: number;
  critMultOnAll: number;
  critMultOn1920: number;
  critMult1920Bonus: number;
  wScalar: number;
  wBonus: number;
  totalW: number;
  flatDmgBonus: number;
  physDamagePct: number;
  seeker: number;
  damageStat: Stat;
  damageStatMod: number;
  /** Base APM at zero alacrity (informational). */
  baseAPM: number;
  /** APM after passive alacrity + Doubleshot, no action-boost. Drives the
   *  timeline visualization. */
  apmNoBoost: number;
  /** Final APM after action-boost alacrity. */
  apm: number;
  effectivePerMin: number;
  totalAutoDPS: number;
  rangedPower: number;
  doubleshot: number;
  rangedAlacrity: number;
  actionBoostAlacrity: number;
}

// ── Weapon category classification ──────────────────────────────────────

const BOW_KEYWORDS = ['longbow', 'shortbow', 'great bow', 'greatbow'];
const REPEATING_KEYWORDS = ['repeating'];
const CROSSBOW_KEYWORDS = ['crossbow'];
const THROWN_KEYWORDS = [
  'shuriken', 'dart', 'throwing axe', 'throwing dagger', 'throwing hammer',
  'thrown',
];

export function rangedCategoryFromName(weaponName: string): RangedCategory | null {
  const lower = weaponName.toLowerCase();
  if (REPEATING_KEYWORDS.some(k => lower.includes(k))) return 'repeating-crossbow';
  if (BOW_KEYWORDS.some(k => lower.includes(k))) return 'bow';
  if (CROSSBOW_KEYWORDS.some(k => lower.includes(k))) return 'crossbow';
  if (THROWN_KEYWORDS.some(k => lower.includes(k))) return 'thrown';
  return null;
}

// ── Attack rates ────────────────────────────────────────────────────────
//
// Baseline APM at BAB 20+ for each ranged category. Numbers reflect the
// post-U62 ranged speed normalization; sourced from in-game testing.
//
//   Bow: ~80 APM (a bit faster than 1H melee due to Rapid Shot scaling
//                 typically baked in for end-game builds)
//   Crossbow: ~75 APM (slower reload than bows)
//   Repeating: ~110 APM (3-bolt burst smoothed)
//   Thrown: ~90 APM
//
// These are reasonable starting numbers; if real measurements diverge
// just edit this table.

export function rangedBaseAPM(category: RangedCategory): number {
  switch (category) {
    case 'bow':                return 80;
    case 'crossbow':           return 75;
    case 'repeating-crossbow': return 110;
    case 'thrown':             return 90;
  }
}

export function rangedAttacksPerMin(category: RangedCategory, alacrityPct: number): number {
  return rangedBaseAPM(category) * (1 + Math.min(Math.max(0, alacrityPct), 15) / 100);
}

// ── Core DPS formula ────────────────────────────────────────────────────

export function rangedDPS(
  weapon: RangedWeaponInfo,
  stats: RangedBuildStats,
): RangedDPSResult {
  // Per-hit damage (mirrors meleeDPS).
  const totalW   = weapon.wScalar + stats.wBonus;
  const avgDice  = weapon.diceNum * totalW * (weapon.diceSides + 1) / 2;
  const avgBase  = avgDice + weapon.diceBonus + stats.statMod + weapon.enchantBonus + stats.flatDmgBonus;
  const scaled   = avgBase * (1 + stats.rangedPower / 100) * (1 + stats.physDamagePct / 100);

  // Crit threat range + multipliers (same model as melee — IC doubles
  // the base, flat bonuses add on top; 19-20 carve-out for OC family).
  const rangeAfterIC   = stats.hasImprovedCritical
    ? weapon.critThreatBase * 2
    : weapon.critThreatBase;
  const totalFaces     = rangeAfterIC + stats.critRangeBonus;
  const critChance     = totalFaces / 20;
  const multOnAll      = weapon.critMultiplier + stats.critMultBonus;
  const multOn1920     = multOnAll + stats.critMult1920Bonus;
  const faces1920      = Math.min(2, totalFaces);
  const facesOther     = Math.max(0, totalFaces - 2);
  const avgPerHit = (1 - critChance) * scaled
    + (facesOther / 20) * (scaled + stats.seeker) * multOnAll
    + (faces1920  / 20) * (scaled + stats.seeker) * multOn1920;

  // Attack rates — passive alacrity capped at 15%, action-boost on top.
  const alacrity      = Math.min(Math.max(0, stats.rangedAlacrity), 15);
  const boostAlacrity = Math.max(0, stats.actionBoostAlacrity);
  const baseAPM       = rangedBaseAPM(weapon.category);
  const apmNoBoost    = baseAPM * (1 + alacrity / 100);
  const apm           = apmNoBoost * (1 + boostAlacrity / 100);

  // Doubleshot: % chance of an additional projectile per shot. Adds 1×ds
  // to effective hit count per APM tick.
  const ds            = Math.max(0, stats.doubleshot) / 100;
  const effective     = apm * (1 + ds);

  const totalAutoDPS  = effective * avgPerHit / 60;

  return {
    avgBaseDamage:        avgBase,
    avgScaledDamage:      scaled,
    avgPerHit,
    critThreatFaces:      totalFaces,
    critChance,
    critMultOnAll:        multOnAll,
    critMultOn1920:       multOn1920,
    critMult1920Bonus:    stats.critMult1920Bonus,
    wScalar:              weapon.wScalar,
    wBonus:               stats.wBonus,
    totalW,
    flatDmgBonus:         stats.flatDmgBonus,
    physDamagePct:        stats.physDamagePct,
    seeker:               stats.seeker,
    damageStat:           stats.damageStat,
    damageStatMod:        stats.statMod,
    baseAPM,
    apmNoBoost,
    apm,
    effectivePerMin:      effective,
    totalAutoDPS,
    rangedPower:          stats.rangedPower,
    doubleshot:           stats.doubleshot,
    rangedAlacrity:       alacrity,
    actionBoostAlacrity:  boostAlacrity,
  };
}

// ── Build-data extractors ───────────────────────────────────────────────

/** Build a RangedWeaponInfo from a gear item. Returns null when the item
 *  has no weapon fields or isn't classifiable as a ranged weapon. */
export function rangedWeaponInfoFromGearItem(item: GearItem): RangedWeaponInfo | null {
  if (!item.weapon || !item.baseDice) return null;
  const category = rangedCategoryFromName(item.weapon);
  if (!category) return null;
  const enchantBuff = item.buffs.find(b => b.type === 'WeaponEnchantment');
  return {
    name:           item.name,
    weaponType:     item.weapon,
    category,
    wScalar:        item.weaponDamage ?? 1,
    diceNum:        item.baseDice.number,
    diceSides:      item.baseDice.sides,
    diceBonus:      item.baseDice.bonus ?? 0,
    enchantBonus:   enchantBuff?.value1 ?? 0,
    critThreatBase: item.criticalThreatRange ?? 1,
    critMultiplier: item.criticalMultiplier  ?? 2,
    // Most ranged weapons use DEX. attackModifier on the item overrides
    // when present (e.g. a "Mighty" composite bow tagged Strength).
    attackStat:     item.attackModifier?.toLowerCase().includes('str')
                      ? 'Strength'
                      : 'Dexterity',
  };
}

/** Derive RangedBuildStats from the engine result + build. Mirrors
 *  meleeCalc's `buildStatsFromEngine` but reads ranged-side breakdowns. */
export function rangedBuildStatsFromEngine(
  build: Build,
  engine: EngineResult,
  weaponInfo: RangedWeaponInfo,
  alacrityOverride?: number,
  actionBoostAlacrity = 0,
): RangedBuildStats {
  // Effective damage stat — Weapon_DamageAbility can swap DEX → INT etc.
  const STAT_MAP: Record<string, Stat> = {
    strength: 'STR', dexterity: 'DEX', constitution: 'CON',
    intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA',
  };
  let damageStat: Stat = weaponInfo.attackStat === 'Strength' ? 'STR' : 'DEX';
  let bestMod = abilityModifier(engine.abilityScores[damageStat].total);
  for (const b of engine.allBonuses) {
    if (b.effectType !== 'Weapon_DamageAbility') continue;
    const tgt = (b.target ?? '').toLowerCase();
    const candidate = STAT_MAP[tgt] as Stat | undefined;
    if (!candidate) continue;
    const mod = abilityModifier(engine.abilityScores[candidate].total);
    if (mod > bestMod) { bestMod = mod; damageStat = candidate; }
  }
  const statMod = bestMod;

  // Class-restricted weapon bonuses (e.g. Arcane Archer's bow-only crit
  // range bumps). Shared helper from meleeCalc since the routing logic
  // is identical — only the consuming stat block differs.
  const klass = weaponClassBonusesForWeapon(engine, weaponInfo.weaponType);

  const alacrity = alacrityOverride ?? engine.rangedSpeed.total;

  return {
    statMod,
    damageStat,
    rangedPower:         engine.rangedPower.total,
    doubleshot:          engine.doubleshot.total,
    rangedAlacrity:      alacrity,
    seeker:              engine.seeker.total + klass.critDamageRider,
    hasImprovedCritical: detectImprovedCritical(build),
    critRangeBonus:      critRangeBonusForWeapon(engine, weaponInfo.weaponType) + klass.critRange,
    critMultBonus:       engine.weaponCritMult.total + klass.critMult,
    critMult1920Bonus:   engine.weaponCritMult1920.total,
    wBonus:              engine.weaponBaseDamage.total,
    flatDmgBonus:        engine.weaponFlatDamage.total + klass.flatDamage + klass.enchantment,
    physDamagePct:       engine.weaponDamagePct.total,
    actionBoostAlacrity: Math.max(0, actionBoostAlacrity),
  };
}

// re-export for the editor to filter buff-only ranged bonuses if needed
// without needing to also import stackBonuses; keeps the surface area
// tight for the editor.
export { stackBonuses };
