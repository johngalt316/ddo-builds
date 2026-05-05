import type { DDOClass, Race } from '@/types/gameData';
import type { DDOClassData, DDORaceData } from '@/types/ddoData';

// Normalize a display name to the ID format used in the build store
// "Arcane Trickster" → "arcane_trickster", "Half-Elf" → "half_elf"
export function nameToId(name: string): string {
  return name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
}

// Skill names suffer from upstream inconsistency: the build XML writes
// "Spellcraft" (one word) while class XMLs use "Spell Craft" (two words);
// `nameToId` would map them to "spellcraft" vs "spell_craft" respectively.
// `skillNameToId` strips all non-alphanumerics first and then looks the
// result up against the known skill IDs (also stripped of underscores), so
// every spelling variant collapses to the canonical id ("spellcraft",
// "disable_device", etc.). Falls back to plain `nameToId` for unknown skills.
import skillsJson from '@/data/skills.json';

const SKILL_BY_STRIPPED = new Map<string, string>();
for (const s of skillsJson as { id: string; name: string }[]) {
  SKILL_BY_STRIPPED.set(s.name.toLowerCase().replace(/[^a-z0-9]/g, ''), s.id);
  SKILL_BY_STRIPPED.set(s.id.replace(/_/g, ''), s.id);
}
// Game-data shorthand that won't normalize otherwise.
SKILL_BY_STRIPPED.set('umd', 'use_magic_device');

export function skillNameToId(name: string): string {
  const stripped = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SKILL_BY_STRIPPED.get(stripped) ?? nameToId(name);
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
  // Prefer the parsed XML mods. Fall back to the hand-coded table only
  // when the race XML didn't include any <Strength>/<Dexterity>/etc. tags
  // (extra safety; in practice every race file carries them).
  const parsed = r.abilityMods ?? {};
  const bonuses = Object.keys(parsed).length > 0 ? parsed : (RACIAL_BONUSES[id] ?? {});
  return {
    id,
    name: r.name,
    description: r.description,
    abilityBonuses: bonuses as Partial<Record<'STR'|'DEX'|'CON'|'INT'|'WIS'|'CHA', number>>,
    skillBonuses: {},
    racialTraits: [],
    hitPointBonus: 0,
    bonusSkillPoints: r.bonusSkillPoints ?? 0,
    availableAlignments: [],
  };
}
