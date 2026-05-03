// Phase 2.x-F migration: this is the replacement for useCharacterStats.
//
// Combines the new engine output (`useBreakdowns`) with the build's
// pre-effect baseline (BAB, class data) and a small amount of derived
// display logic (attacks-per-round, weapon-finesse damage attribute,
// spell points heuristic). Returns the same flat shape that
// `StatsSection` already consumes, so the migration is just an import
// swap on the consumer side.
//
// Things that still use feat-name heuristics (for display labels, not
// for any number that actually drives a stat total):
//   - `improvedCriticalGroups` — list of weapon types from "Improved Critical: X" feat names
//   - `attackChain` — TWF / GTWF / THF / GTHF chains
//   - `metamagicFeats`, `spellFocusSchools` — per-feat-name buckets
//   - `primarySpellcaster` — picks the highest-level caster class for caster level
//   - `spellPoints` — base SP per class table + casting-stat-driven bonus (~5 SP per mod per level)
//
// These will be replaced with engine-driven equivalents once the matching
// effect types are modeled (Phase 5+ touches DPS / spell DCs / etc.).

import { useMemo } from 'react';
import { useBuild } from '@/hooks/useBuild';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { useGameDataStore } from '@/store/gameDataStore';
import { nameToId } from '@/utils/classAdapter';
import { abilityModifier } from '@/engine';
import type { Stat } from '@/types/build';

const CASTING_STAT_TO_ABILITY: Record<string, Stat> = {
  Intelligence: 'INT',
  Wisdom:       'WIS',
  Charisma:     'CHA',
  Strength:     'STR',
  Dexterity:    'DEX',
  Constitution: 'CON',
};

export function useStats() {
  const ub = useBuild();
  const breakdowns = useBreakdowns();
  const classData = useGameDataStore(s => s.classes);

  const { build, charLevel, bab, modifiers: seedModifiers, effectiveScores } = ub;

  // ── Ability score totals (engine if available, fall back to seeds) ──
  const abilityScores = useMemo(() => {
    if (breakdowns) return {
      STR: breakdowns.abilityScores.STR.total,
      DEX: breakdowns.abilityScores.DEX.total,
      CON: breakdowns.abilityScores.CON.total,
      INT: breakdowns.abilityScores.INT.total,
      WIS: breakdowns.abilityScores.WIS.total,
      CHA: breakdowns.abilityScores.CHA.total,
    };
    return effectiveScores;
  }, [breakdowns, effectiveScores]);

  const abilityMods: Record<Stat, number> = useMemo(() => ({
    STR: abilityModifier(abilityScores.STR),
    DEX: abilityModifier(abilityScores.DEX),
    CON: abilityModifier(abilityScores.CON),
    INT: abilityModifier(abilityScores.INT),
    WIS: abilityModifier(abilityScores.WIS),
    CHA: abilityModifier(abilityScores.CHA),
  }), [abilityScores]);

  // ── Engine-backed totals (with fallbacks while game data is loading) ─
  const hitPoints = breakdowns?.hitPoints.total ?? ub.hitPoints;
  const saves = breakdowns ? {
    fortitude: breakdowns.saves.Fortitude.total,
    reflex:    breakdowns.saves.Reflex.total,
    will:      breakdowns.saves.Will.total,
  } : ub.saves;

  const meleePower  = breakdowns?.meleePower.total  ?? 0;
  const rangedPower = breakdowns?.rangedPower.total ?? 0;
  const doublestrike = breakdowns?.doublestrike.total ?? 0;
  const doubleshot  = breakdowns?.doubleshot.total  ?? 0;
  const healingAmp  = breakdowns?.healingAmp.total  ?? 0;

  // ── Spell points (heuristic — base SP per class + caster-level bonus) ─
  const spellPoints = useMemo(() => {
    let total = 0;
    for (const cls of build.classes) {
      const data = classData.find(c => nameToId(c.name) === cls.classId);
      if (!data) continue;
      total += data.spellPointsPerLevel[cls.levels] ?? 0;
      if (data.castingStat) {
        const stat = CASTING_STAT_TO_ABILITY[data.castingStat];
        if (stat) total += Math.max(0, abilityMods[stat]) * cls.levels * 5;
      }
    }
    return total;
  }, [build.classes, classData, abilityMods]);

  // ── Feat-name buckets for display-only fields ───────────────────────
  const featNames = useMemo(
    () => new Set(build.feats.map(f => f.featId)),
    [build.feats],
  );
  const hasFeat = (n: string) => featNames.has(n);

  const meleeDamageAttr = useMemo(() => {
    const strMod = abilityMods.STR;
    const dexMod = abilityMods.DEX;
    if (hasFeat('Weapon Finesse') && dexMod > strMod) {
      return { stat: 'DEX' as Stat, mod: dexMod };
    }
    return { stat: 'STR' as Stat, mod: strMod };
  }, [abilityMods, featNames]);

  const improvedCriticalGroups = useMemo(
    () => Array.from(featNames)
      .filter(f => f.startsWith('Improved Critical'))
      .map(f => f.replace(/Improved Critical[:\s]+/, '')),
    [featNames],
  );

  const attackChain = useMemo(() => {
    const chains: string[] = [];
    if (hasFeat('Greater Two Weapon Fighting')) chains.push('GTWF');
    else if (hasFeat('Improved Two Weapon Fighting')) chains.push('ITWF');
    else if (hasFeat('Two Weapon Fighting')) chains.push('TWF');
    if (hasFeat('Greater Two Handed Fighting')) chains.push('GTHF');
    else if (hasFeat('Improved Two Handed Fighting')) chains.push('ITHF');
    else if (hasFeat('Two Handed Fighting')) chains.push('THF');
    return chains;
  }, [featNames]);

  const meleeAttackCount = useMemo(
    () => 1 + Math.floor(Math.max(0, bab - 1) / 5),
    [bab],
  );

  const spellPenetration = useMemo(() => {
    let bonus = 0;
    if (hasFeat('Spell Penetration')) bonus += 2;
    if (hasFeat('Greater Spell Penetration')) bonus += 2;
    return bonus;
  }, [featNames]);

  const spellFocusSchools = useMemo(
    () => Array.from(featNames)
      .filter(f => f.startsWith('Spell Focus') || f.startsWith('Greater Spell Focus'))
      .map(f => f.replace(/(Greater )?Spell Focus[:\s]+/, '')),
    [featNames],
  );

  const metamagicFeats = useMemo(
    () => ['Empower Spell', 'Maximize Spell', 'Quicken Spell', 'Heighten Spell',
           'Enlarge Spell', 'Extend Spell', 'Empower Healing Spell', 'Intensify Spell']
      .filter(hasFeat),
    [featNames],
  );

  const primarySpellcaster = useMemo(() => {
    let bestLevel = 0;
    let bestClass = '';
    for (const cls of build.classes) {
      const data = classData.find(c => nameToId(c.name) === cls.classId);
      if (data?.spellPointsPerLevel.some(sp => sp > 0) && cls.levels > bestLevel) {
        bestLevel = cls.levels;
        bestClass = data.name;
      }
    }
    return bestClass ? { className: bestClass, level: bestLevel } : null;
  }, [build.classes, classData]);

  return {
    // Core
    charLevel,
    hitPoints,
    spellPoints,
    bab,
    saves,
    modifiers: abilityMods,
    abilityScores,

    // Defensive (gear-dependent placeholders for now)
    prr: 0,
    mrr: 0,
    ac: 10 + abilityMods.DEX,

    // Melee
    meleePower,
    meleeDamageAttr,
    meleeAttackBonus: bab + meleeDamageAttr.mod,
    meleeAttackCount,
    improvedCriticalGroups,
    attackChain,
    doublestrike,

    // Ranged
    rangedPower,
    rangedAttackBonus: bab + abilityMods.DEX,
    rangedDexBonus: abilityMods.DEX,
    doubleshot,

    // Magic
    primarySpellcaster,
    spellPenetration,
    spellFocusSchools,
    metamagicFeats,
    healingAmp,

    // Internal: keep seedModifiers around in case any caller still wants it
    _seedModifiers: seedModifiers,

    // Engine-backed: passed through for callers that want the full breakdown
    breakdowns,
  };
}
