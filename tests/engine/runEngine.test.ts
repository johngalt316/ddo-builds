// @vitest-environment happy-dom
//
// Engine snapshot — locks in what the Phase 2 MVP engine produces for
// our reference builds. The snapshot intentionally records:
//   - per-stat total + applied/dominated contributor counts
//   - diagnostics (unmodeled amount types, unmatched feats, etc.)
//
// Subsequent Phase 2.x sessions that add enhancement / item / set-bonus
// sources will see the diff move in expected ways:
//   - diagnostics.unmodeledAmountTypes → fewer entries
//   - per-stat appliedCount → goes up
//   - per-stat total → matches DDOBuilderV2 side-by-side
//
// We snapshot a *summary*, not full contributor lists, because effect
// sources will multiply rapidly across phases — full lists would churn
// on every game-data refresh and obscure real regressions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml, parseAugmentsXml,
  parseFiligreesXml, parseGuildBuffsXml,
} from '@/utils/ddoXmlParser';
import { runEngine } from '@/engine/runEngine';
import type { Build } from '@/types/build';
import type { BreakdownResult } from '@/engine/bonusStacking';
import type { DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData, ItemBuffCatalog, DDOAugmentData, DDOFiligreeData, DDOFiligreeSetBonus } from '@/types/ddoData';

const FIXTURES = resolve(__dirname, '../fixtures');
const SNAPSHOTS = resolve(__dirname, '../snapshots');
const DATA = resolve(__dirname, '../../public/data');

function readData(rel: string) {
  return readFileSync(resolve(DATA, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  const raw = readData(rel);
  // BOM-tolerant JSON parsing: the manifests are UTF-8 with BOM.
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(clean) as T;
}

function loadGameData() {
  // The classes.json / races.json manifests list filenames in those subdirs.
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

  // Merge feat definitions from Feats.xml + every class XML + every race XML.
  // Class XMLs (Epic, ArcaneTrickster, etc.) define class-specific feats
  // (Past Life, Arcane Pulse, etc.) that aren't in the main Feats.xml.
  const featSources = [readData('Feats.xml'), ...classXmls, ...raceXmls];
  const featByName = new Map<string, DDOFeatData>();
  for (const xml of featSources) {
    for (const f of parseFeatsXml(xml)) {
      // First definition wins (Feats.xml is most authoritative; class/race
      // XMLs occasionally redefine a feat with stripped-down data).
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

  // Item-name → set lookup for .DDOBuild files that omit SetBonus.
  const itemSetIndex: Record<string, string> = {};
  const idx = readJson<{ name: string; setBonus?: string }[]>('items/index.json');
  for (const i of idx) if (i.setBonus) itemSetIndex[i.name] = i.setBonus;

  // Augments: 31 small XML files. Parse all, flatten.
  const augmentFiles = readJson<string[]>('augments.json');
  const augments: DDOAugmentData[] = [];
  for (const f of augmentFiles) {
    augments.push(...parseAugmentsXml(readData(`Augments/${f}`)));
  }

  // Filigrees: 65 small XML files; each defines both a set bonus and individual filigrees.
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

  return {
    classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex, augments,
    filigrees, filigreeSetBonuses, guildBuffs,
  };
}

function loadBuild(filename: string): Build {
  const xml = readFileSync(resolve(FIXTURES, filename), 'utf8');
  const result = parseDDOBuildFile(xml);
  if (!result) throw new Error(`parseDDOBuildFile returned null for ${filename}`);
  return result.build;
}

function summarizeBreakdown(b: BreakdownResult) {
  const applied = b.contributors.filter(c => c.applied);
  const dominated = b.contributors.filter(c => !c.applied);
  return {
    total: b.total,
    appliedCount: applied.length,
    dominatedCount: dominated.length,
    sources: applied.map(c => ({
      source: c.source,
      bonusType: c.bonusType || '(untyped)',
      value: c.value,
      target: c.target,
    })),
  };
}

function engineSummary(build: Build, gameData: ReturnType<typeof loadGameData>) {
  const r = runEngine({ build, ...gameData });
  return {
    diagnostics: r.diagnostics,
    abilityScores: Object.fromEntries(
      Object.entries(r.abilityScores).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    hitPoints: summarizeBreakdown(r.hitPoints),
    saves: {
      Fortitude: summarizeBreakdown(r.saves.Fortitude),
      Reflex:    summarizeBreakdown(r.saves.Reflex),
      Will:      summarizeBreakdown(r.saves.Will),
    },
    meleePower:      summarizeBreakdown(r.meleePower),
    rangedPower:     summarizeBreakdown(r.rangedPower),
    doublestrike:    summarizeBreakdown(r.doublestrike),
    doubleshot:      summarizeBreakdown(r.doubleshot),
    meleeSpeed:      summarizeBreakdown(r.meleeSpeed),
    rangedSpeed:     summarizeBreakdown(r.rangedSpeed),
    healingAmp:      summarizeBreakdown(r.healingAmp),
    negativeHealingAmp: summarizeBreakdown(r.negativeHealingAmp),
    repairAmp:       summarizeBreakdown(r.repairAmp),
    ac:              summarizeBreakdown(r.ac),
    dodge:           summarizeBreakdown(r.dodge),
    prr:             summarizeBreakdown(r.prr),
    mrr:             summarizeBreakdown(r.mrr),
    spellResistance: summarizeBreakdown(r.spellResistance),
    arcaneSpellFailure: summarizeBreakdown(r.arcaneSpellFailure),
    casterLevel:     summarizeBreakdown(r.casterLevel),
    spellPenetration: summarizeBreakdown(r.spellPenetration),
    spellDCs: Object.fromEntries(
      Object.entries(r.spellDCs).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    spellPowers: Object.fromEntries(
      Object.entries(r.spellPowers).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    spellCriticalChance: Object.fromEntries(
      Object.entries(r.spellCriticalChance).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    spellCriticalDamage: Object.fromEntries(
      Object.entries(r.spellCriticalDamage).map(([k, v]) => [k, summarizeBreakdown(v)]),
    ),
    slas: r.slas.map(s => ({
      name: s.name, castingClass: s.castingClass, category: s.category,
      cost: s.cost, maxCasterLevel: s.maxCasterLevel, cooldown: s.cooldown,
      source: s.source,
    })),
  };
}

describe('runEngine snapshots', () => {
  // Load game data once per test file; it's shared and stable.
  const gameData = loadGameData();

  const cases: { name: string; fixture: string; snapshot: string }[] = [
    { name: 'kemton',   fixture: 'kemton.DDOBuild',                       snapshot: 'kemton.engine.snap.json' },
    { name: 'zentek',   fixture: 'zentek.DDOBuild',                       snapshot: 'zentek.engine.snap.json' },
    { name: 'maetrim',  fixture: 'Maetrim_EndGameHandwrapsMonk.DDOBuild', snapshot: 'maetrim.engine.snap.json' },
    { name: 'yings',    fixture: 'YingsMonk.DDOBuild',                    snapshot: 'yings.engine.snap.json' },
  ];

  for (const c of cases) {
    it(`${c.name} engine output is stable`, async () => {
      const build = loadBuild(c.fixture);
      const summary = engineSummary(build, gameData);
      await expect(JSON.stringify(summary, null, 2))
        .toMatchFileSnapshot(resolve(SNAPSHOTS, c.snapshot));
    });
  }
});
