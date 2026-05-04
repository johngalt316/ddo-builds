// @vitest-environment happy-dom
//
// Verifies the engine source walker fires reaper-tree spends with the
// `[R]` source-label prefix. Mirrors enhancementWalker.test.ts but with
// build.reaperEnhancements instead of build.enhancements.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml,
} from '@/utils/ddoXmlParser';
import { collectEffects } from '@/engine/collectEffects';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build } from '@/types/build';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData, ItemBuffCatalog,
} from '@/types/ddoData';

const DATA = resolve(__dirname, '../../public/data');
function readData(rel: string) { return readFileSync(resolve(DATA, rel), 'utf8'); }
function readJson<T>(rel: string): T {
  const raw = readData(rel);
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw) as T;
}

function loadGameData() {
  const classFiles = readJson<string[]>('classes.json');
  const raceFiles  = readJson<string[]>('races.json');
  const treeFiles  = readJson<string[]>('enhancementTrees.json');
  const classXmls  = classFiles.map(f => readData(`Classes/${f}`));
  const raceXmls   = raceFiles.map(f => readData(`Races/${f}`));

  const classes = classXmls.map(parseClassXml).filter((c): c is DDOClassData => c !== null);
  const races   = raceXmls.map(parseRaceXml).filter((r): r is DDORaceData => r !== null);

  const featByName = new Map<string, DDOFeatData>();
  for (const xml of [readData('Feats.xml'), ...classXmls, ...raceXmls]) {
    for (const f of parseFeatsXml(xml)) {
      if (!featByName.has(f.name.toLowerCase())) featByName.set(f.name.toLowerCase(), f);
    }
  }
  const feats = [...featByName.values()];
  const bonusTypes = parseBonusTypesXml(readData('BonusTypes.xml'));
  const enhancementTrees = treeFiles
    .map(f => parseEnhancementTreeXml(readData(`EnhancementTrees/${f}`)))
    .filter((t): t is EnhancementTreeData => t !== null);
  const itemBuffs = readJson<ItemBuffCatalog>('items/itemBuffs.json');
  const setBonuses = parseSetBonusesXml(readData('SetBonuses.xml'));
  const itemSetIndex: Record<string, string> = {};
  const idx = readJson<{ name: string; setBonus?: string }[]>('items/index.json');
  for (const i of idx) if (i.setBonus) itemSetIndex[i.name] = i.setBonus;

  return { classes, races, feats, bonusTypes, enhancementTrees, itemBuffs, setBonuses, itemSetIndex, augments: [], filigrees: [], filigreeSetBonuses: [], selfPartyBuffs: [] };
}

const gameData = loadGameData();

describe('reaper enhancement walker', () => {
  it('reference data: at least one reaper tree is loaded', () => {
    const reaperTrees = gameData.enhancementTrees.filter(t => t.isReaperTree);
    expect(reaperTrees.length).toBeGreaterThan(0);
  });

  it('emits effects with [R] prefix when build.reaperEnhancements is populated', () => {
    const reaperTree = gameData.enhancementTrees.find(t => t.isReaperTree);
    expect(reaperTree).toBeDefined();
    const itemWithEffect = reaperTree!.items.find(i => i.effects.length > 0);
    expect(itemWithEffect).toBeDefined();

    const build: Build = {
      ...DEFAULT_BUILD,
      classes: [{ classId: 'fighter', levels: 20 }],
      reaperEnhancements: [{
        treeId: reaperTree!.name,
        enhancements: [{ enhancementId: itemWithEffect!.internalName, tier: 0, rank: 1 }],
      }],
    };

    const r = collectEffects({ build, ...gameData });
    const reaperEffects = r.effects.filter(e => e.source.startsWith('[R]'));
    expect(reaperEffects.length).toBeGreaterThan(0);
    expect(reaperEffects[0]?.source).toContain(reaperTree!.name);
    expect(reaperEffects[0]?.rankCount).toBe(1);
  });

  it('reaper and heroic spends are kept separate', () => {
    const reaperTree = gameData.enhancementTrees.find(t => t.isReaperTree);
    const heroicTree = gameData.enhancementTrees.find(
      t => !t.isReaperTree && !t.isDestinyTree && t.items.some(i => i.effects.length > 0),
    );
    expect(reaperTree).toBeDefined();
    expect(heroicTree).toBeDefined();
    const reaperItem = reaperTree!.items.find(i => i.effects.length > 0)!;
    const heroicItem = heroicTree!.items.find(i => i.effects.length > 0)!;

    const build: Build = {
      ...DEFAULT_BUILD,
      classes: [{ classId: 'fighter', levels: 20 }],
      enhancements: [{
        treeId: heroicTree!.name,
        enhancements: [{ enhancementId: heroicItem.internalName, tier: 0, rank: 1 }],
      }],
      reaperEnhancements: [{
        treeId: reaperTree!.name,
        enhancements: [{ enhancementId: reaperItem.internalName, tier: 0, rank: 1 }],
      }],
    };

    const r = collectEffects({ build, ...gameData });
    expect(r.effects.some(e => e.source.startsWith('[R]'))).toBe(true);
    expect(r.effects.some(e => e.source.startsWith('[E]'))).toBe(true);
    expect(r.unmatchedTrees).toEqual([]);
    expect(r.unmatchedEnhancements).toEqual([]);
  });
});
