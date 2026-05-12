// Shared fixture loading for engine + DPS snapshot tests. Keeps
// loadGameData/loadBuild + the canonical build cases in one place so
// adding a new fixture or a new snapshot type doesn't fork the
// path-resolution logic.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml, parseAugmentsXml,
  parseFiligreesXml, parseGuildBuffsXml,
  parseSpellsXml, parseSelfPartyBuffsXml, parseMetamagicsXml,
} from '@/utils/ddoXmlParser';
import { nameToId, skillNameToId } from '@/utils/classAdapter';
import type { Build } from '@/types/build';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData,
  ItemBuffCatalog, DDOAugmentData, DDOFiligreeData, DDOFiligreeSetBonus,
  DDOSpellData, DDOOptionalBuff, DDOMetamagicData,
} from '@/types/ddoData';

export const FIXTURES  = resolve(__dirname, '../fixtures');
export const SNAPSHOTS = resolve(__dirname, '../snapshots');
const DATA = resolve(__dirname, '../../public/data');

function readData(rel: string) {
  return readFileSync(resolve(DATA, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  const raw = readData(rel);
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(clean) as T;
}

export function loadGameData() {
  const classFiles = readJson<string[]>('classes.json');
  const raceFiles  = readJson<string[]>('races.json');

  const classXmls = classFiles.map(f => readData(`Classes/${f}`));
  const raceXmls  = raceFiles.map(f  => readData(`Races/${f}`));

  const classes = classXmls
    .map(parseClassXml)
    .filter((c): c is DDOClassData => c !== null);

  const races = raceXmls
    .map(parseRaceXml)
    .filter((r): r is DDORaceData => r !== null);

  const featSources = [readData('Feats.xml'), ...classXmls, ...raceXmls];
  const featByName = new Map<string, DDOFeatData>();
  for (const xml of featSources) {
    for (const f of parseFeatsXml(xml)) {
      const key = f.name.toLowerCase();
      if (!featByName.has(key)) featByName.set(key, f);
    }
  }
  const feats: DDOFeatData[] = [...featByName.values()];

  const bonusTypes = parseBonusTypesXml(readData('BonusTypes.xml'));

  const treeFiles = readJson<string[]>('enhancementTrees.json');
  const enhancementTrees = treeFiles
    .map(f => parseEnhancementTreeXml(readData(`EnhancementTrees/${f}`)))
    .filter((t): t is EnhancementTreeData => t !== null);

  const itemBuffs = readJson<ItemBuffCatalog>('items/itemBuffs.json');
  const setBonuses = parseSetBonusesXml(readData('SetBonuses.xml'));

  const itemSetIndex: Record<string, string> = {};
  const idx = readJson<{ name: string; setBonus?: string }[]>('items/index.json');
  for (const i of idx) if (i.setBonus) itemSetIndex[i.name] = i.setBonus;

  const augmentFiles = readJson<string[]>('augments.json');
  const augments: DDOAugmentData[] = [];
  for (const f of augmentFiles) {
    augments.push(...parseAugmentsXml(readData(`Augments/${f}`)));
  }

  const filigreeFiles = readJson<string[]>('filigreeSets.json');
  const filigrees: DDOFiligreeData[] = [];
  const filigreeSetBonuses: DDOFiligreeSetBonus[] = [];
  for (const f of filigreeFiles) {
    const parsed = parseFiligreesXml(readData(`FiligreeSets/${f}`));
    filigrees.push(...parsed.filigrees);
    filigreeSetBonuses.push(...parsed.setBonuses);
  }

  const guildBuffsXml = readData('GuildBuffs.xml');
  const guildBuffs = parseGuildBuffsXml(guildBuffsXml);

  // Catalogs the DPS snapshot needs in addition to the engine inputs.
  const spells: DDOSpellData[] = parseSpellsXml(readData('Spells.xml'));
  const selfPartyBuffs: DDOOptionalBuff[] = parseSelfPartyBuffsXml(readData('SelfAndPartyBuffs.xml'));
  const metamagics: DDOMetamagicData[] = parseMetamagicsXml(readData('Metamagics.xml'));

  return {
    classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex, augments,
    filigrees, filigreeSetBonuses, guildBuffs,
    spells, selfPartyBuffs, metamagics,
  };
}

export type GameData = ReturnType<typeof loadGameData>;

export function loadBuild(filename: string, classSkillsByClassId?: Record<string, string[]>): Build {
  const xml = readFileSync(resolve(FIXTURES, filename), 'utf8');
  const result = parseDDOBuildFile(xml, { classSkillsByClassId });
  if (!result) throw new Error(`parseDDOBuildFile returned null for ${filename}`);
  return result.build;
}

export function buildClassSkillsLookup(gameData: GameData): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const c of gameData.classes) {
    m[nameToId(c.name)] = c.classSkills.map(skillNameToId);
  }
  return m;
}

/** The 4 reference builds used by every fixture-snapshot test. */
export const FIXTURE_CASES: { name: string; fixture: string }[] = [
  { name: 'kemton',  fixture: 'kemton.DDOBuild'                       },
  { name: 'zentek',  fixture: 'zentek.DDOBuild'                       },
  { name: 'maetrim', fixture: 'Maetrim_EndGameHandwrapsMonk.DDOBuild' },
  { name: 'yings',   fixture: 'YingsMonk.DDOBuild'                    },
];
