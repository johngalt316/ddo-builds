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
import {
  critRangeBonusForWeapon, weaponClassBonusesForWeapon, detectImprovedCritical,
} from './meleeCalc';

export type RangedCategory = 'bow' | 'crossbow' | 'great-crossbow' | 'repeating-crossbow' | 'thrown';

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
  /** Pre-alacrity base APM for the active weapon. Defaults from
   *  `rangedBaseAPM(category)`, with the Dual Shooter override applied
   *  when its stance is active. The Ranged editor's Base APM slider
   *  may replace this with a user-tuned value. */
  baseAPM: number;
  seeker: number;
  hasImprovedCritical: boolean;
  critRangeBonus: number;
  critMultBonus: number;
  critMult1920Bonus: number;
  wBonus: number;
  flatDmgBonus: number;
  /** Percentage physical damage bonus (Primal Force +2% etc.). */
  physDamagePct: number;
  /** Inquisitive's "Dual Shooter" stance active AND a non-repeating
   *  crossbow equipped — the build effectively dual-wields hand
   *  crossbows. Per in-game behavior, each MH shot ALWAYS triggers an
   *  OH-equivalent shot (`offHandChance = 100`); the cadence is set
   *  by `DUAL_SHOOTER_APM` rather than the crossbow's normal rate. */
  dualShooter: boolean;
  /** OH attack chance, 0-100. 100 whenever `dualShooter` is true. */
  offHandChance: number;
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
  /** Passive-alacrity-only APM (no action-boost). Drives the timeline
   *  visualization so boost windows show denser bars. */
  apmNoBoost: number;
  /** Final per-hand APM after action-boost alacrity. With Dual Shooter
   *  active this is the MH (and OH = `apm × offHandChance/100`); without
   *  it, this is the only attack rate (OH fields are 0). */
  apm: number;
  /** Effective MH shots/min after Doubleshot. */
  effectivePerMin: number;
  /** MH-only auto-DPS contribution (= avgPerHit × effectivePerMin / 60). */
  mhDPS: number;
  /** OH attack rate; 0 when Dual Shooter is inactive. */
  ohAttacksPerMin: number;
  /** Passive-alacrity OH APM (for timeline boost-window rendering). */
  ohBaseAPM: number;
  /** Effective OH shots/min after Doubleshot; 0 when Dual Shooter inactive. */
  ohEffectivePerMin: number;
  /** OH-only auto-DPS contribution; 0 when Dual Shooter inactive. */
  ohDPS: number;
  /** MH + OH auto-DPS combined. */
  totalAutoDPS: number;
  rangedPower: number;
  doubleshot: number;
  rangedAlacrity: number;
  actionBoostAlacrity: number;
  /** Whether the Dual Shooter MH+OH model was applied. */
  dualShooter: boolean;
  /** Resolved OH attack chance % (informational; 0 when not dual-shooting). */
  offHandChance: number;
}

// ── Weapon category classification ──────────────────────────────────────

const BOW_KEYWORDS = ['longbow', 'shortbow', 'great bow', 'greatbow'];
const GREAT_CROSSBOW_KEYWORDS = ['great crossbow', 'greatcrossbow'];
const REPEATING_KEYWORDS = ['repeating'];
const CROSSBOW_KEYWORDS = ['crossbow'];
const THROWN_KEYWORDS = [
  'shuriken', 'dart', 'throwing axe', 'throwing dagger', 'throwing hammer',
  'thrown',
];

export function rangedCategoryFromName(weaponName: string): RangedCategory | null {
  const lower = weaponName.toLowerCase();
  if (REPEATING_KEYWORDS.some(k => lower.includes(k))) return 'repeating-crossbow';
  if (GREAT_CROSSBOW_KEYWORDS.some(k => lower.includes(k))) return 'great-crossbow';
  if (BOW_KEYWORDS.some(k => lower.includes(k))) return 'bow';
  if (CROSSBOW_KEYWORDS.some(k => lower.includes(k))) return 'crossbow';
  if (THROWN_KEYWORDS.some(k => lower.includes(k))) return 'thrown';
  return null;
}

// ── Attack rates ────────────────────────────────────────────────────────
//
// Baseline APM at BAB 20+ for each ranged category. Updated to reflect
// in-game measured fire rates rather than older approximations:
//
//   Bow:                50 APM
//   Light/Heavy Crossbow: 50 APM
//   Great Crossbow:     30 APM
//   Repeating Crossbow: 30 APM (3-bolt burst smoothed to per-bolt cadence)
//   Thrown:             90 APM (no measurement override — kept)
//
// Special case: Inquisitive "Dual Shooter" stance overrides the MH cadence
// to 45 APM regardless of crossbow size (the dual-hand-crossbow animation
// has its own fire rate). See `rangedBuildStatsFromEngine` for the override.

export const DUAL_SHOOTER_APM = 45;

export function rangedBaseAPM(category: RangedCategory): number {
  switch (category) {
    case 'bow':                return 50;
    case 'crossbow':           return 50;
    case 'great-crossbow':     return 30;
    case 'repeating-crossbow': return 30;
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
  // `stats.baseAPM` is pre-resolved by the build-stats builder so the
  // editor's Base APM slider + Dual Shooter cadence override flow
  // through here without rangedDPS needing to know about either.
  const alacrity      = Math.min(Math.max(0, stats.rangedAlacrity), 15);
  const boostAlacrity = Math.max(0, stats.actionBoostAlacrity);
  const baseAPM       = stats.baseAPM > 0 ? stats.baseAPM : rangedBaseAPM(weapon.category);
  const apmNoBoost    = baseAPM * (1 + alacrity / 100);
  const apm           = apmNoBoost * (1 + boostAlacrity / 100);

  // Doubleshot: % chance of an additional projectile per shot. Adds 1×ds
  // to effective hit count per APM tick. With Dual Shooter, both hands
  // proc Doubleshot independently — same per-side multiplier applied to
  // each.
  const ds            = Math.max(0, stats.doubleshot) / 100;
  const mhEffective   = apm * (1 + ds);
  const mhDPS         = mhEffective * avgPerHit / 60;

  // Dual Shooter MH+OH model (Inquisitive enhancement): when active, the
  // build dual-wields hand crossbows — each MH shot triggers an OH-side
  // shot at `offHandChance%`. OH attacks use the same per-hit damage
  // profile (same weapon stats), and proc Doubleshot independently.
  const dualShooter   = stats.dualShooter;
  const ohFrac        = dualShooter ? Math.min(1.0, Math.max(0, stats.offHandChance) / 100) : 0;
  const ohAPM         = apm * ohFrac;
  const ohBaseAPM     = apmNoBoost * ohFrac;
  const ohEffective   = ohAPM * (1 + ds);
  const ohDPS         = ohEffective * avgPerHit / 60;

  const totalAutoDPS  = mhDPS + ohDPS;

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
    effectivePerMin:      mhEffective,
    mhDPS,
    ohAttacksPerMin:      ohAPM,
    ohBaseAPM,
    ohEffectivePerMin:    ohEffective,
    ohDPS,
    totalAutoDPS,
    rangedPower:          stats.rangedPower,
    doubleshot:           stats.doubleshot,
    rangedAlacrity:       alacrity,
    actionBoostAlacrity:  boostAlacrity,
    dualShooter,
    offHandChance:        dualShooter ? Math.min(100, Math.max(0, stats.offHandChance)) : 0,
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
  /** Optional manual stat pick from the editor's damage-stat dropdown.
   *  When 'auto' (default), the function picks the highest-mod stat
   *  among DEX/STR plus any Weapon_DamageAbility-emitted candidates. */
  damageStatOverride: Stat | 'auto' = 'auto',
  /** Optional Base APM override from the editor's slider. When undefined,
   *  the function picks `rangedBaseAPM(category)` with the Dual Shooter
   *  cadence applied when the stance is active. */
  baseAPMOverride?: number,
): RangedBuildStats {
  // Effective damage stat — Weapon_DamageAbility can swap DEX → INT etc.
  const STAT_MAP: Record<string, Stat> = {
    strength: 'STR', dexterity: 'DEX', constitution: 'CON',
    intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA',
  };
  let damageStat: Stat;
  let statMod: number;
  if (damageStatOverride !== 'auto') {
    // Editor user picked a specific stat — honor it verbatim. Useful
    // when the engine can't see a stat-swap path (e.g. a deity-favored
    // weapon list that doesn't include the equipped crossbow), or to
    // sanity-check a what-if scenario.
    damageStat = damageStatOverride;
    statMod    = abilityModifier(engine.abilityScores[damageStat].total);
  } else {
    damageStat = weaponInfo.attackStat === 'Strength' ? 'STR' : 'DEX';
    let bestMod = abilityModifier(engine.abilityScores[damageStat].total);
    for (const b of engine.allBonuses) {
      if (b.effectType !== 'Weapon_DamageAbility') continue;
      const tgt = (b.target ?? '').toLowerCase();
      const candidate = STAT_MAP[tgt] as Stat | undefined;
      if (!candidate) continue;
      const mod = abilityModifier(engine.abilityScores[candidate].total);
      if (mod > bestMod) { bestMod = mod; damageStat = candidate; }
    }
    statMod = bestMod;
  }

  // Class-restricted weapon bonuses (e.g. Arcane Archer's bow-only crit
  // range bumps). Shared helper from meleeCalc since the routing logic
  // is identical — only the consuming stat block differs.
  const klass = weaponClassBonusesForWeapon(engine, weaponInfo.weaponType);

  const alacrity = alacrityOverride ?? engine.rangedSpeed.total;

  // Inquisitive "Dual Shooter" stance — when active AND the player wields
  // a non-repeating light/heavy crossbow (NOT great crossbows), the
  // build is treated as dual-wielding hand crossbows. Per in-game
  // observation, this is NOT TWF-derived: each MH shot ALWAYS triggers
  // an OH shot (100% chance), and the cadence is fixed at
  // DUAL_SHOOTER_APM regardless of the crossbow's normal fire rate.
  const isDualShooterCrossbow = weaponInfo.category === 'crossbow';
  const dualShooterActive = isDualShooterCrossbow
    && (build.activeStances ?? []).includes('Dual Shooter');
  const offHandChance = dualShooterActive ? 100 : 0;

  const computedBaseAPM = dualShooterActive
    ? DUAL_SHOOTER_APM
    : rangedBaseAPM(weaponInfo.category);
  const baseAPM = baseAPMOverride !== undefined && baseAPMOverride > 0
    ? baseAPMOverride
    : computedBaseAPM;

  return {
    statMod,
    damageStat,
    rangedPower:         engine.rangedPower.total,
    doubleshot:          engine.doubleshot.total,
    rangedAlacrity:      alacrity,
    baseAPM,
    seeker:              engine.seeker.total + klass.critDamageRider,
    hasImprovedCritical: detectImprovedCritical(build),
    critRangeBonus:      critRangeBonusForWeapon(engine, weaponInfo.weaponType) + klass.critRange,
    critMultBonus:       engine.weaponCritMult.total + klass.critMult,
    critMult1920Bonus:   engine.weaponCritMult1920.total,
    wBonus:              engine.weaponBaseDamage.total,
    flatDmgBonus:        engine.weaponFlatDamage.total + klass.flatDamage + klass.enchantment,
    physDamagePct:       engine.weaponDamagePct.total,
    actionBoostAlacrity: Math.max(0, actionBoostAlacrity),
    dualShooter:         dualShooterActive,
    offHandChance,
  };
}

// re-export for the editor to filter buff-only ranged bonuses if needed
// without needing to also import stackBonuses; keeps the surface area
// tight for the editor.
export { stackBonuses };

// ── Per-ability helpers (parity with meleeAbilityDamagePerActivation) ──

/**
 * Effective shots-per-activation multiplier for a ranged ability. Each
 * activation fires `mhHits` base projectiles; Doubleshot grants an
 * additional projectile per shot with `doubleshot%` probability. No
 * off-hand for ranged.
 */
export function rangedAbilityEffectiveShots(mhHits: number, stats: RangedBuildStats): number {
  const ds = Math.max(0, stats.doubleshot) / 100;
  return mhHits * (1 + ds);
}

/**
 * Per-hit average damage for a ranged ability that modifies the weapon's
 * crit threat range. Mirrors `meleeAbilityAvgPerHit` — scales by the
 * ability's W multiplier (`scalar`) and re-weights the crit profile with
 * the ability's bonus faces / multiplier.
 */
function rangedAbilityAvgPerHit(
  result: RangedDPSResult,
  scalar: number,
  extraCritFaces: number,
  extraCritMult: number,
): number {
  const cappedFaces = Math.min(20, result.critThreatFaces + extraCritFaces);
  const critChance  = cappedFaces / 20;
  const faces1920   = Math.min(2, cappedFaces);
  const facesOther  = Math.max(0, cappedFaces - 2);
  const s = result.avgScaledDamage;
  const multAll  = result.critMultOnAll  + extraCritMult;
  const mult1920 = result.critMultOn1920 + extraCritMult;
  const avgPerHit = (1 - critChance) * s
    + (facesOther / 20) * (s + result.seeker) * multAll
    + (faces1920  / 20) * (s + result.seeker) * mult1920;
  return avgPerHit * scalar;
}

/**
 * Per-activation damage for a ranged weapon-attack ability (Manyshot,
 * Hunt's End, etc.). Hits × per-hit damage × (1 + Doubleshot), with
 * optional crit-range / crit-mult riders and a transient buff-uptime
 * window mirroring the melee helper.
 */
export function rangedAbilityDamagePerActivation(
  mhHits: number,
  scalar: number,
  rangedResult: RangedDPSResult,
  stats: RangedBuildStats,
  extraCritFaces = 0,
  extraCritMult  = 0,
  /** Some abilities (e.g. Rapid Shot) grant a temporary alacrity buff.
   *  Modeled as extra auto-attack APM over the buff window. */
  alacrityBuffPct      = 0,
  alacrityBuffDuration = 0,
): number {
  const perHit = (extraCritFaces === 0 && extraCritMult === 0)
    ? rangedResult.avgPerHit * scalar
    : rangedAbilityAvgPerHit(rangedResult, scalar, extraCritFaces, extraCritMult);
  const hitDamage = rangedAbilityEffectiveShots(mhHits, stats) * perHit;

  // Transient alacrity buff: extra APM during the buff window adds
  // (extraAPM / 60) × buff-duration extra shots, each averaging perHit.
  let buffDamage = 0;
  if (alacrityBuffPct > 0 && alacrityBuffDuration > 0) {
    const extraAPM = (alacrityBuffPct / 100) * rangedResult.apm;
    buffDamage = (extraAPM / 60) * rangedResult.avgPerHit * alacrityBuffDuration;
  }

  return hitDamage + buffDamage;
}

/**
 * Build a per-line breakdown of how DPC was computed for a ranged
 * weapon-attack ability. Each entry is one row of derivation; consumers
 * (palette tooltip, timeline block tooltip) render them verbatim.
 *
 * The order follows the per-cast formula:
 *   1. weapon base damage line (dice + stat + flat + enchant)
 *   2. ranged-power / physical-damage multipliers
 *   3. ability scalar (the +N% damage rider)
 *   4. crit profile (incorporating ability crit-range / crit-mult riders)
 *   5. average per-hit
 *   6. effective shots (mhHits × (1 + DS))
 *   7. transient alacrity buff (when present)
 *   8. cycle-time + DPS total
 *
 * Values are formatted with `fmt` so big numbers render readably.
 */
export function rangedAbilityTooltipLines(
  weapon: RangedWeaponInfo,
  stats: RangedBuildStats,
  result: RangedDPSResult,
  wa: {
    mhHits: number;
    scalar: number;
    critRangeBonus?: number;
    critMultBonus?: number;
    dsBuffPct?: number;
    dsBuffDuration?: number;
  },
  cycleTime: number,
): string[] {
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });

  const lines: string[] = [];

  // 1. Base weapon damage components
  const avgDice  = wa.scalar > 0
    ? weapon.diceNum * (weapon.wScalar + stats.wBonus) * (weapon.diceSides + 1) / 2
    : weapon.diceNum * (weapon.wScalar + stats.wBonus) * (weapon.diceSides + 1) / 2;
  const baseParts: string[] = [];
  baseParts.push(`${fmt(avgDice, 2)} dice (${weapon.diceNum}d${weapon.diceSides} × ${fmt(weapon.wScalar + stats.wBonus, 2)}W)`);
  if (weapon.diceBonus)   baseParts.push(`+${weapon.diceBonus} dice bonus`);
  if (stats.statMod)      baseParts.push(`+${stats.statMod} ${stats.damageStat}`);
  if (weapon.enchantBonus) baseParts.push(`+${weapon.enchantBonus} enchant`);
  if (stats.flatDmgBonus)  baseParts.push(`+${stats.flatDmgBonus} flat`);
  const baseSum = avgDice + weapon.diceBonus + stats.statMod + weapon.enchantBonus + stats.flatDmgBonus;
  lines.push(`Base/hit: ${fmt(baseSum, 1)}  [${baseParts.join(' · ')}]`);

  // 2. Multipliers
  const scaled = result.avgScaledDamage;
  const mults: string[] = [];
  mults.push(`×${fmt(1 + stats.rangedPower / 100, 2)} RP(${stats.rangedPower})`);
  if (stats.physDamagePct) mults.push(`×${fmt(1 + stats.physDamagePct / 100, 2)} phys(${stats.physDamagePct}%)`);
  const baseScalar = wa.scalar;
  if (baseScalar !== 1) mults.push(`×${fmt(baseScalar, 2)} ability scalar (+${Math.round((baseScalar - 1) * 100)}%)`);
  const scaledWithScalar = scaled * baseScalar;
  lines.push(`Scaled/hit: ${fmt(scaledWithScalar, 1)}  [${mults.join(' · ')}]`);

  // 3. Crit profile (with ability bonuses)
  const extraCritFaces = wa.critRangeBonus ?? 0;
  const extraCritMult  = wa.critMultBonus  ?? 0;
  const totalFaces = Math.min(20, result.critThreatFaces + extraCritFaces);
  const multAll    = result.critMultOnAll  + extraCritMult;
  const mult1920   = result.critMultOn1920 + extraCritMult;
  const loBound    = 21 - totalFaces;
  const facesOther = Math.max(0, totalFaces - 2);
  const critStr = result.critMult1920Bonus > 0 || extraCritMult > 0
    ? facesOther > 0
      ? `(${loBound}-18)×${multAll}, (19-20)×${mult1920}`
      : `(19-20)×${mult1920}`
    : `(${loBound}-20)×${multAll}`;
  const critParts: string[] = [`${totalFaces}/20 = ${fmt(totalFaces * 5, 0)}%`];
  if (extraCritFaces) critParts.push(`+${extraCritFaces} faces`);
  if (extraCritMult)  critParts.push(`+${extraCritMult} mult`);
  if (stats.seeker)   critParts.push(`+${stats.seeker} seeker`);
  lines.push(`Crit: ${critStr}  [${critParts.join(' · ')}]`);

  // 4. Per-hit avg (with crit profile applied)
  const avgPerHit = (extraCritFaces === 0 && extraCritMult === 0)
    ? result.avgPerHit * baseScalar
    : rangedAbilityAvgPerHit(result, baseScalar, extraCritFaces, extraCritMult);
  lines.push(`Avg/hit: ${fmt(avgPerHit, 1)}  (crit-weighted)`);

  // 5. Effective shots
  const ds = Math.max(0, stats.doubleshot) / 100;
  const effShots = wa.mhHits * (1 + ds);
  lines.push(`Hits: ${wa.mhHits} × (1 + ${fmt(stats.doubleshot, 0)}% DS) = ${fmt(effShots, 2)}`);

  // 6. Transient alacrity buff
  const dsBuffPct = wa.dsBuffPct ?? 0;
  const dsBuffDur = wa.dsBuffDuration ?? 0;
  if (dsBuffPct > 0 && dsBuffDur > 0) {
    const extraAPM = (dsBuffPct / 100) * result.apm;
    const extraShots = (extraAPM / 60) * dsBuffDur;
    lines.push(`Alacrity buff: +${dsBuffPct}% for ${dsBuffDur}s → ${fmt(extraShots, 2)} extra shots`);
  }

  // 7. Cycle + DPS
  const hitDamage  = effShots * avgPerHit;
  const buffDamage = dsBuffPct > 0 && dsBuffDur > 0
    ? ((dsBuffPct / 100) * result.apm / 60) * result.avgPerHit * dsBuffDur
    : 0;
  const total = hitDamage + buffDamage;
  lines.push(`DPC: ${fmt(effShots, 2)} × ${fmt(avgPerHit, 1)}${buffDamage > 0 ? ` + ${fmt(buffDamage, 1)} buff` : ''} = ${fmt(total, 0)}`);
  if (cycleTime > 0) {
    lines.push(`Cycle: ${fmt(cycleTime, 1)}s → DPS ${fmt(total / cycleTime, 0)}`);
  }
  return lines;
}
