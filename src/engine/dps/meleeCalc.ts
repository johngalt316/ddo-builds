// Melee DPS calculator — Phase 6.7
//
// Computes auto-attack DPS for melee builds from a weapon + build-stats
// snapshot. Phase 1 covers main-hand + off-hand auto-attacks with
// Doublestrike and Seeker. Ki strikes, on-hit procs, and sneak attack
// are deferred to Phase 2.

import type { Build } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import { abilityModifier } from '@/engine';
import type { GearItem } from '@/types/build';

export type WeaponCategory = 'handwraps' | 'one-handed' | 'two-handed';
export type TWFStyle = 'none' | 'twf' | 'itwf' | 'gtwf';

export interface MeleeWeaponInfo {
  name: string;
  category: WeaponCategory;
  diceNum: number;
  diceSides: number;
  diceBonus: number;
  enchantBonus: number;
  /** Raw d20 faces that threaten a crit before feat doubling (1 = 20-only). */
  critThreatBase: number;
  critMultiplier: number;
  attackStat: 'Strength' | 'Dexterity';
}

export interface MeleeBuildStats {
  statMod: number;
  meleePower: number;
  doublestrike: number;    // %
  meleeAlacrity: number;   // %, caller-clamped to [0, 15]
  seeker: number;
  hasImprovedCritical: boolean;
  twfStyle: TWFStyle;
  offHandChance: number;   // % (GTWF base + enhancement adds)
  isHandwraps: boolean;    // no DS cap on off-hand for handwraps
}

export interface MeleeDPSResult {
  avgBaseDamage: number;
  avgScaledDamage: number;
  avgPerHit: number;
  critChance: number;
  critMultiplier: number;
  seeker: number;
  mhAttacksPerMin: number;
  ohAttacksPerMin: number;
  effectiveMHPerMin: number;
  effectiveOHPerMin: number;
  totalEffectivePerMin: number;
  mhDPS: number;
  ohDPS: number;
  totalAutoDPS: number;
  meleePower: number;
  doublestrike: number;
  meleeAlacrity: number;
}

// ── Weapon category ──────────────────────────────────────────────────

const TWO_HANDED_KEYWORDS = [
  'greatsword', 'greataxe', 'great crossbow', 'falchion',
  'maul', 'quarterstaff', 'two-handed', 'two handed',
  'bastard sword',  // can be 2H wielded
];

export function weaponCategoryFromName(weaponName: string): WeaponCategory {
  const lower = weaponName.toLowerCase();
  if (lower === 'handwraps') return 'handwraps';
  if (TWO_HANDED_KEYWORDS.some(k => lower.includes(k))) return 'two-handed';
  return 'one-handed';
}

// ── Attack rates ──────────────────────────────────────────────────────
//
// Baseline measured in-game for a BAB 20+ character.
// Handwraps: slightly faster than standard one-handed.
// Two-handed: slightly slower.
// Alacrity cap = 15% (user-visible slider cap).

export function meleeBaseAPM(category: WeaponCategory): number {
  switch (category) {
    case 'handwraps':  return 110;
    case 'two-handed': return 90;
    default:           return 100;
  }
}

export function meleeAttacksPerMin(category: WeaponCategory, alacrityPct: number): number {
  return meleeBaseAPM(category) * (1 + Math.min(Math.max(0, alacrityPct), 15) / 100);
}

// ── TWF helpers ──────────────────────────────────────────────────────

export function twfOffHandChancePct(style: TWFStyle): number {
  switch (style) {
    case 'gtwf': return 80;
    case 'itwf': return 60;
    case 'twf':  return 40;
    default:     return 0;
  }
}

export function detectTWFStyle(build: Build): TWFStyle {
  const ids = new Set([
    ...build.feats.map(f => f.featId),
    ...(build.specialFeats ?? []).map(f => f.featId),
  ]);
  if (ids.has('Greater Two Weapon Fighting')) return 'gtwf';
  if (ids.has('Improved Two Weapon Fighting')) return 'itwf';
  if (ids.has('Two Weapon Fighting'))          return 'twf';
  return 'none';
}

export function detectImprovedCritical(build: Build): boolean {
  return build.feats.some(f => f.featId.startsWith('Improved Critical:'));
}

// ── Core DPS formula ─────────────────────────────────────────────────

export function meleeDPS(
  weapon: MeleeWeaponInfo,
  stats: MeleeBuildStats,
): MeleeDPSResult {
  // Per-hit damage
  const avgDice = weapon.diceNum * (weapon.diceSides + 1) / 2;
  const avgBase = avgDice + weapon.diceBonus + stats.statMod + weapon.enchantBonus;
  const scaled  = avgBase * (1 + stats.meleePower / 100);

  const effectiveThreat = stats.hasImprovedCritical
    ? weapon.critThreatBase * 2
    : weapon.critThreatBase;
  const critChance = effectiveThreat / 20;

  const avgOnNormal = scaled;
  const avgOnCrit   = (scaled + stats.seeker) * weapon.critMultiplier;
  const avgPerHit   = (1 - critChance) * avgOnNormal + critChance * avgOnCrit;

  // Attack rates
  const alacrity = Math.min(Math.max(0, stats.meleeAlacrity), 15);
  const mhAPM    = meleeAttacksPerMin(weapon.category, alacrity);
  const ohFrac   = Math.min(1.0, stats.offHandChance / 100);
  const ohAPM    = mhAPM * ohFrac;

  // Doublestrike — handwraps have no DS cap on off-hand
  const dsMH = stats.doublestrike / 100;
  const dsOH = stats.isHandwraps ? dsMH : Math.min(dsMH, 0.50);

  const effectiveMH    = mhAPM * (1 + dsMH);
  const effectiveOH    = ohAPM * (1 + dsOH);
  const totalEffective = effectiveMH + effectiveOH;

  const mhDPS = effectiveMH * avgPerHit / 60;
  const ohDPS = effectiveOH * avgPerHit / 60;

  return {
    avgBaseDamage:        avgBase,
    avgScaledDamage:      scaled,
    avgPerHit,
    critChance,
    critMultiplier:       weapon.critMultiplier,
    seeker:               stats.seeker,
    mhAttacksPerMin:      mhAPM,
    ohAttacksPerMin:      ohAPM,
    effectiveMHPerMin:    effectiveMH,
    effectiveOHPerMin:    effectiveOH,
    totalEffectivePerMin: totalEffective,
    mhDPS,
    ohDPS,
    totalAutoDPS:         mhDPS + ohDPS,
    meleePower:           stats.meleePower,
    doublestrike:         stats.doublestrike,
    meleeAlacrity:        alacrity,
  };
}

// ── Build-data extractors ────────────────────────────────────────────

/** Build a MeleeWeaponInfo from a GearItem. Returns null when the item
 *  has no weapon fields (non-weapon item or no baseDice parsed). */
export function weaponInfoFromGearItem(item: GearItem): MeleeWeaponInfo | null {
  if (!item.weapon || !item.baseDice) return null;
  const enchantBuff = item.buffs.find(b => b.type === 'WeaponEnchantment');
  return {
    name:           item.name,
    category:       weaponCategoryFromName(item.weapon),
    diceNum:        item.baseDice.number,
    diceSides:      item.baseDice.sides,
    diceBonus:      item.baseDice.bonus ?? 0,
    enchantBonus:   enchantBuff?.value1 ?? 0,
    critThreatBase: item.criticalThreatRange ?? 1,
    critMultiplier: item.criticalMultiplier  ?? 2,
    attackStat:     item.attackModifier?.toLowerCase().includes('dex')
                      ? 'Dexterity'
                      : 'Strength',
  };
}

/** Derive MeleeBuildStats from the engine result + build. Pass an
 *  optional `alacrityOverride` (0-15) from the panel slider. */
export function buildStatsFromEngine(
  build: Build,
  engine: EngineResult,
  weaponInfo: MeleeWeaponInfo,
  alacrityOverride?: number,
): MeleeBuildStats {
  const statMod = weaponInfo.attackStat === 'Dexterity'
    ? abilityModifier(engine.abilityScores.DEX.total)
    : abilityModifier(engine.abilityScores.STR.total);

  const twfStyle   = detectTWFStyle(build);
  const ohChance   = twfOffHandChancePct(twfStyle);
  const alacrity   = alacrityOverride ?? engine.meleeSpeed.total;

  return {
    statMod,
    meleePower:          engine.meleePower.total,
    doublestrike:        engine.doublestrike.total,
    meleeAlacrity:       alacrity,
    seeker:              engine.seeker.total,
    hasImprovedCritical: detectImprovedCritical(build),
    twfStyle,
    offHandChance:       ohChance,
    isHandwraps:         weaponInfo.category === 'handwraps',
  };
}
