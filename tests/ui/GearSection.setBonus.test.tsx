// @vitest-environment happy-dom
//
// Verifies that augment-granted set bonuses surface in the Gear tab's
// Active Set Bonuses pill row. Pre-fix the GearSection only counted
// item-tagged set memberships; Lost Purpose augments (which grant a
// set bonus via a slotted augment) were invisible despite firing in
// the engine.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup } from '@testing-library/react';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml, parseAugmentsXml,
  parseStancesXml, parseWeaponGroupsXml,
} from '@/utils/ddoXmlParser';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { GearSection } from '@/components/gear/GearSection';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData,
  ItemBuffCatalog, DDOAugmentData,
} from '@/types/ddoData';

const FIXTURES = resolve(__dirname, '../fixtures');
const DATA = resolve(__dirname, '../../public/data');

function read(rel: string) { return readFileSync(resolve(DATA, rel), 'utf8'); }
function readJson<T>(rel: string): T {
  const raw = read(rel);
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw) as T;
}

function loadMinGameData() {
  const classFiles = readJson<string[]>('classes.json');
  const raceFiles  = readJson<string[]>('races.json');
  const treeFiles  = readJson<string[]>('enhancementTrees.json');
  const augmentFiles = readJson<string[]>('augments.json');
  const classXmls  = classFiles.map(f => read(`Classes/${f}`));
  const raceXmls   = raceFiles.map(f => read(`Races/${f}`));
  const classes = classXmls.map(parseClassXml).filter((c): c is DDOClassData => c !== null);
  const races   = raceXmls.map(parseRaceXml).filter((r): r is DDORaceData => r !== null);
  const featByName = new Map<string, DDOFeatData>();
  for (const xml of [read('Feats.xml'), ...classXmls, ...raceXmls]) {
    for (const f of parseFeatsXml(xml)) {
      if (!featByName.has(f.name.toLowerCase())) featByName.set(f.name.toLowerCase(), f);
    }
  }
  const feats = [...featByName.values()];
  const bonusTypes = parseBonusTypesXml(read('BonusTypes.xml'));
  const enhancementTrees = treeFiles
    .map(f => parseEnhancementTreeXml(read(`EnhancementTrees/${f}`)))
    .filter((t): t is EnhancementTreeData => t !== null);
  const itemBuffs = readJson<ItemBuffCatalog>('items/itemBuffs.json');
  const setBonuses = parseSetBonusesXml(read('SetBonuses.xml'));
  const itemSetIndex: Record<string, string> = {};
  const idx = readJson<{ name: string; setBonus?: string }[]>('items/index.json');
  for (const i of idx) if (i.setBonus) itemSetIndex[i.name] = i.setBonus;
  const augments: DDOAugmentData[] = [];
  for (const f of augmentFiles) {
    augments.push(...parseAugmentsXml(read(`Augments/${f}`)));
  }
  const stances = parseStancesXml(read('Stances.xml'));
  const weaponGroups = parseWeaponGroupsXml(read('WeaponGroupings.xml'));
  return {
    classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex, augments,
    filigrees: [], filigreeSetBonuses: [],
    spells: [], selfPartyBuffs: [], guildBuffs: [], metamagics: [],
    stances, weaponGroups,
    bonusTypeRules: new Map(bonusTypes.map(b => [b.name.trim().toLowerCase(),
      b.stacking === 'Highest Only' ? 'highest' : 'always' as const])),
  };
}

// Parse the full game data + the fixture once — both are read-only and
// shared across tests. Doing the work in beforeEach causes CI hook
// timeouts (parsing every XML file takes 10s+ on slower runners).
const sharedGameData = loadMinGameData();
const sharedFixtureXml = readFileSync(resolve(FIXTURES, 'zentek.DDOBuild'), 'utf8');
const sharedBuild = (() => {
  const r = parseDDOBuildFile(sharedFixtureXml);
  if (!r) throw new Error('zentek fixture failed to parse');
  return r.build;
})();

describe('GearSection — augment-granted set bonus visibility', () => {
  beforeEach(() => {
    cleanup();
    useGameDataStore.setState({
      status: 'ready',
      ...sharedGameData,
    } as never);
    useBuildStore.setState({ build: sharedBuild });
  });

  it('renders the Legendary Devil\'s Infernal Dance pill for zentek\'s 3 Lost Purpose augments', () => {
    const { container } = render(<GearSection />);
    // The pill text is "<set name> <count>/<maxTier>". For Infernal Dance
    // with 3 Lost Purpose augments and a 3-piece-only tier ladder, we
    // expect "Legendary Devil's Infernal Dance 3/3".
    const html = container.textContent ?? '';
    expect(html).toContain("Legendary Devil's Infernal Dance");
    expect(html).toContain('3/3');
  });
});
