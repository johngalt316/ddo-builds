// @vitest-environment happy-dom
//
// Verifies that stance-gated effects fire when, and only when, their
// stance is active. We use Mountain Stance (granted by the "Adept of
// Forms" feat path) which has effects with explicit Stance requirements.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml,
} from '@/utils/ddoXmlParser';
import { runEngine } from '@/engine/runEngine';
import { passesRequirements } from '@/engine/evaluateEffect';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build } from '@/types/build';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData, ItemBuffCatalog, DDOEffect,
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

  return { classes, races, feats, bonusTypes, enhancementTrees, itemBuffs, setBonuses, itemSetIndex };
}

const gameData = loadGameData();

function buildWithFeats(feats: string[], stances: string[] = []): Build {
  return {
    ...DEFAULT_BUILD,
    classes: [{ classId: 'monk', levels: 20 }],
    feats: feats.map((featId, slotIndex) => ({ slotIndex, featId })),
    activeStances: stances,
  };
}

describe('stance gating', () => {
  // Find the Mountain Stance ability bonus effect — it requires Stance=Mountain Stance.
  const mountainStanceFeat = gameData.feats.find(f => f.name === 'Adept of Forms');
  const mountainStanceEffect: DDOEffect | undefined = mountainStanceFeat?.effects
    .find(e => e.requirements.allOf.some(r => r.type === 'Stance' && r.item === 'Mountain Stance'));

  it('reference data: Adept of Forms has a Mountain Stance gated effect', () => {
    expect(mountainStanceFeat).toBeDefined();
    expect(mountainStanceEffect).toBeDefined();
  });

  it('passesRequirements: Stance requirement fails when stance is not active', () => {
    expect(mountainStanceEffect).toBeDefined();
    const ctx = {
      totalLevel: 20,
      classLevels: new Map([['monk', 20]]),
      baseClassLevels: new Map([['monk', 20]]),
      raceId: 'human',
      raceName: 'Human',
      feats: new Set<string>(['Adept of Forms']),
      abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      bab: 15,
      apSpentInTree: new Map<string, number>(),
      activeStances: new Set<string>(),     // empty
    };
    expect(passesRequirements(mountainStanceEffect!.requirements, ctx)).toBe(false);
  });

  it('passesRequirements: Stance requirement passes when stance is active', () => {
    expect(mountainStanceEffect).toBeDefined();
    const ctx = {
      totalLevel: 20,
      classLevels: new Map([['monk', 20]]),
      baseClassLevels: new Map([['monk', 20]]),
      raceId: 'human',
      raceName: 'Human',
      feats: new Set<string>(['Adept of Forms']),
      abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      bab: 15,
      apSpentInTree: new Map<string, number>(),
      activeStances: new Set<string>(['Mountain Stance']),
    };
    expect(passesRequirements(mountainStanceEffect!.requirements, ctx)).toBe(true);
  });

  it('runEngine: CON unaffected without stance, gains Mountain Stance bonus when active', () => {
    // Adept of Rocks grants stance-gated CON bonuses (table-indexed).
    const off = runEngine({
      build: buildWithFeats(['Adept of Forms'], []),
      ...gameData,
    });
    const on = runEngine({
      build: buildWithFeats(['Adept of Forms'], ['Mountain Stance']),
      ...gameData,
    });
    expect(on.abilityScores.CON.total).toBeGreaterThan(off.abilityScores.CON.total);

    // Diagnostics: requirementsFailedCount should drop by at least one
    // (the Mountain Stance gate now passes for at least one effect).
    expect(on.diagnostics.requirementsFailedCount).toBeLessThan(off.diagnostics.requirementsFailedCount);
  });

  it('toggling unrelated stance does not change CON', () => {
    const a = runEngine({
      build: buildWithFeats(['Adept of Forms'], ['Combat Expertise']),
      ...gameData,
    });
    const b = runEngine({
      build: buildWithFeats(['Adept of Forms'], []),
      ...gameData,
    });
    expect(a.abilityScores.CON.total).toBe(b.abilityScores.CON.total);
  });
});
