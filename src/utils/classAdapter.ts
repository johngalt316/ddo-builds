import type { DDOClass, Race } from '@/types/gameData';
import type { DDOClassData, DDORaceData } from '@/types/ddoData';

// Normalize a display name to the ID format used in the build store
// "Arcane Trickster" → "arcane_trickster", "Half-Elf" → "half_elf"
export function nameToId(name: string): string {
  return name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
}

// Derive BAB progression string from the explicit per-level BAB table.
// The table index is the level number (index 0 is unused, index 20 is level 20).
function babFromTable(table: number[]): 'full' | 'three_quarter' | 'half' {
  const bab20 = table[20] ?? table[table.length - 1] ?? 0;
  if (bab20 >= 20) return 'full';
  if (bab20 >= 14) return 'three_quarter';
  return 'half';
}

export function ddoClassDataToEngineClass(c: DDOClassData): DDOClass {
  return {
    id:          nameToId(c.name),
    name: c.name,
    description: c.description,
    hitDie: c.hitDie,
    babProgression: babFromTable(c.babPerLevel),
    saveProgressions: {
      fortitude: c.fortSave,
      reflex:    c.refSave,
      will:      c.willSave,
    },
    skillPointsPerLevel: c.skillPointsPerLevel,
    classSkills: c.classSkills.map(s => nameToId(s)),
    spellcaster: c.spellPointsPerLevel.some(sp => sp > 0),
    spellcastingAbility: null,
    availableAlignments: [],
  };
}

// Stubs for racial ability bonuses that aren't encoded in the race XML.
// These are hardcoded from DDO's game data since the XML stores them
// as enhancement tree effects, not direct stats.
const RACIAL_BONUSES: Record<string, Partial<Record<string, number>>> = {
  dwarf:           { CON: 2, CHA: -2 },
  elf:             { DEX: 2, CON: -2 },
  halfling:        { DEX: 2, STR: -2 },
  half_elf:        {},
  half_orc:        { STR: 2, INT: -2, CHA: -2 },
  human:           {},
  warforged:       { CON: 2, WIS: -2, CHA: -2 },
  drow:            { DEX: 2, INT: 2, CHA: 2, CON: -2, STR: -2 },
  gnome:           { INT: 2, STR: -2 },
  aasimar:         { WIS: 2, CHA: 2 },
  tiefling:        { CHA: 2, INT: 2, CON: -2 },
  dragonborn:      { STR: 2, CHA: 2, DEX: -2 },
  tabaxi:          { DEX: 2, CHA: 2 },
  bladeforged:     { CON: 2, WIS: -2, CHA: -2 },
  deep_gnome:      { INT: 2, WIS: 2, STR: -2, CHA: -4 },
  morninglord:     { CON: -2, WIS: 2, CHA: 2 },
  purple_dragon_knight: { STR: 2 },
  razorclaw_shifter: { STR: 2, DEX: 2, INT: -2 },
  shadar_kai:      { DEX: 2, WIS: -2 },
  eladrin:         { DEX: 2, INT: 2 },
  wood_elf:        { DEX: 2, INT: -2 },
  dhampir:         { DEX: 2, CHA: 2, CON: -2 },
  shifter:         { STR: 2, DEX: 2, INT: -2 },
};

export function ddoRaceDataToRace(r: DDORaceData): Race {
  const id = nameToId(r.name);
  const bonuses = RACIAL_BONUSES[id] ?? {};
  return {
    id,
    name: r.name,
    description: r.description,
    abilityBonuses: bonuses as Partial<Record<'STR'|'DEX'|'CON'|'INT'|'WIS'|'CHA', number>>,
    skillBonuses: {},
    racialTraits: [],
    hitPointBonus: 0,
    availableAlignments: [],
  };
}
