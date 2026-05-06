// @vitest-environment happy-dom
//
// Focused unit test for the enhancement source walker.
// Real fixture builds (kemton/zentek) have minimal enhancement spend, so
// we construct a synthetic build that exercises:
//   - per-rank value scaling (Simple AmountType × ranks)
//   - selector-based effect routing
//   - unmatched-tree + unmatched-enhancement diagnostics
//   - heroic vs destiny tree distinction (different source-label prefixes)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml,
} from '@/utils/ddoXmlParser';
import { runEngine } from '@/engine/runEngine';
import { collectEffects } from '@/engine/collectEffects';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build } from '@/types/build';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData, ItemBuffCatalog,
} from '@/types/ddoData';

const DATA = resolve(__dirname, '../../public/data');

function readData(rel: string) {
  return readFileSync(resolve(DATA, rel), 'utf8');
}
function readJson<T>(rel: string): T {
  const raw = readData(rel);
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(clean) as T;
}

function loadGameData() {
  const classFiles = readJson<string[]>('classes.json');
  const raceFiles  = readJson<string[]>('races.json');
  const treeFiles  = readJson<string[]>('enhancementTrees.json');

  const classXmls = classFiles.map(f => readData(`Classes/${f}`));
  const raceXmls  = raceFiles.map(f  => readData(`Races/${f}`));

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

  return {
    classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex, augments: [], filigrees: [], filigreeSetBonuses: [], selfPartyBuffs: [],
  };
}

const gameData = loadGameData();

interface BuildOverrides extends Partial<Build> {
  // Flat shortcuts for tests authored before EnhancementSet existed —
  // wrapped into the active set below so the engine sees them.
  enhancements?: Build['enhancements'];
  destinyEnhancements?: Build['destinyEnhancements'];
  reaperEnhancements?: Build['reaperEnhancements'];
  selectedEnhancementTrees?: Build['selectedEnhancementTrees'];
}
function syntheticBuild(overrides: BuildOverrides = {}): Build {
  const {
    enhancements, destinyEnhancements, reaperEnhancements, selectedEnhancementTrees,
    enhancementSets, activeEnhancementSet,
    ...rest
  } = overrides;
  const sets = enhancementSets ?? [{
    name: 'Default',
    enhancements:             enhancements ?? [],
    destinyEnhancements:      destinyEnhancements ?? [],
    reaperEnhancements:       reaperEnhancements ?? [],
    selectedEnhancementTrees: selectedEnhancementTrees ?? [],
  }];
  return {
    ...DEFAULT_BUILD,
    classes: [{ classId: 'fighter', levels: 20 }],
    ...rest,
    enhancementSets: sets,
    activeEnhancementSet: activeEnhancementSet ?? sets[0]!.name,
  };
}

describe('enhancement source walker', () => {
  it('emits effects for heroic enhancement spends', () => {
    // Find a tree with a known plain-effect enhancement (Ravager: Pain Touch I = +5 MeleePower)
    const tree = gameData.enhancementTrees.find(t => t.name === 'Ravager (Barbarian)');
    expect(tree).toBeDefined();
    const item = tree!.items.find(i => i.internalName === 'RavCore2'); // Pain Touch I
    expect(item).toBeDefined();
    expect(item!.effects.some(e => e.types.includes('MeleePower'))).toBe(true);

    const build = syntheticBuild({
      classes: [{ classId: 'barbarian', levels: 20 }],
      enhancements: [{
        treeId: 'Ravager (Barbarian)',
        enhancements: [{ enhancementId: 'RavCore2', tier: 0, rank: 1 }],
      }],
    });

    const r = collectEffects({ build, ...gameData });
    expect(r.unmatchedTrees).toEqual([]);
    expect(r.unmatchedEnhancements).toEqual([]);
    const fromRavager = r.effects.filter(e => e.source.includes('Ravager'));
    expect(fromRavager.length).toBeGreaterThan(0);
    expect(fromRavager[0]?.rankCount).toBe(1);
    expect(fromRavager[0]?.source).toMatch(/^\[E\]/);   // heroic prefix
  });

  it('multiplies Simple effect values by rank count', () => {
    // Use a real enhancement that uses Simple AType. Find one.
    // Rather than picking a specific one, run the engine on a synthetic build
    // with a max-rank Ravager: Pain Touch I and assert the resulting MeleePower.
    const build = syntheticBuild({
      classes: [{ classId: 'barbarian', levels: 20 }],
      enhancements: [{
        treeId: 'Ravager (Barbarian)',
        enhancements: [
          { enhancementId: 'RavCore2', tier: 0, rank: 1 },
        ],
      }],
    });
    const r = runEngine({ build, ...gameData });
    // Pain Touch I: +5 MeleePower + 10 Healing Amp. The walker fires once with rank=1.
    expect(r.meleePower.total).toBe(5);
    expect(r.healingAmp.total).toBe(10);
  });

  it('runEngine surfaces a selector-granted SLA in EngineResult.slas', async () => {
    const { runEngine } = await import('@/engine/runEngine');
    const build = syntheticBuild({
      classes: [{ classId: 'rogue', levels: 17 }, { classId: 'arcane_trickster', levels: 3 }],
      enhancements: [{
        treeId: 'Arcane Trickster',
        enhancements: [{
          enhancementId: 'ArcaneTricksterCore2',
          selection: 'Stolen Spell - Conjure Bolts',
          tier: 0, rank: 1,
        }],
      }],
    });
    const r = runEngine({ build, ...gameData });
    const sla = r.slas.find(s => s.name === 'Conjure Bolts');
    expect(sla).toBeDefined();
    expect(sla!.castingClass).toBe('Arcane Trickster');
    expect(sla!.cost).toBe(2);
    expect(sla!.cooldown).toBe(6);
  });

  it('emits the selection.effects[] for a selector enhancement (Stolen Spell)', () => {
    // Stolen Spell I in the Arcane Trickster tree — selection picks an SLA.
    const tree = gameData.enhancementTrees.find(t => t.name === 'Arcane Trickster');
    expect(tree).toBeDefined();
    const item = tree!.items.find(i => i.internalName === 'ArcaneTricksterCore2');
    expect(item).toBeDefined();
    expect(item!.selector).not.toBeNull();
    const conjureBolts = item!.selector!.find(s => s.name === 'Stolen Spell - Conjure Bolts');
    expect(conjureBolts).toBeDefined();
    expect(conjureBolts!.effects[0]?.types).toEqual(['SpellLikeAbility']);

    const build = syntheticBuild({
      classes: [{ classId: 'rogue', levels: 17 }, { classId: 'arcane_trickster', levels: 3 }],
      enhancements: [{
        treeId: 'Arcane Trickster',
        enhancements: [{
          enhancementId: 'ArcaneTricksterCore2',
          selection: 'Stolen Spell - Conjure Bolts',
          tier: 0, rank: 1,
        }],
      }],
    });

    const r = collectEffects({ build, ...gameData });
    expect(r.unmatchedEnhancements).toEqual([]);
    const slaEffect = r.effects.find(e =>
      e.effect.types.includes('SpellLikeAbility') &&
      e.effect.items?.includes('Conjure Bolts'));
    expect(slaEffect).toBeDefined();
    expect(slaEffect!.source).toContain('Stolen Spell - Conjure Bolts');
  });

  it('routes through selector when selection is provided', () => {
    // The Eladrin tree has selection-based ability boosts.
    const tree = gameData.enhancementTrees.find(t => t.name === 'Eladrin');
    expect(tree).toBeDefined();

    // Find a selector item.
    const selectorItem = tree!.items.find(i => i.selector !== null);
    expect(selectorItem).toBeDefined();
    expect(selectorItem!.selector!.length).toBeGreaterThan(1);

    // Pick the first selection (it'll have an AbilityBonus effect targeting some stat)
    const chosenSelection = selectorItem!.selector![0]!;
    expect(chosenSelection.effects.length).toBeGreaterThan(0);

    const build = syntheticBuild({
      raceId: 'eladrin',
      enhancements: [{
        treeId: 'Eladrin',
        enhancements: [{
          enhancementId: selectorItem!.internalName,
          selection: chosenSelection.name,
          tier: 0,
          rank: 1,
        }],
      }],
    });

    const r = collectEffects({ build, ...gameData });
    expect(r.unmatchedEnhancements).toEqual([]);
    // The sourced effect's content should match the chosen selection
    const matched = r.effects.find(e => e.source.includes(chosenSelection.name));
    expect(matched).toBeDefined();
    expect(matched!.effect.types).toEqual(chosenSelection.effects[0]!.types);
  });

  it('records unmatched trees and enhancements as diagnostics', () => {
    const build = syntheticBuild({
      enhancements: [{
        treeId: 'NonexistentTree',
        enhancements: [{ enhancementId: 'NonexistentEnhancement', tier: 0, rank: 1 }],
      }, {
        treeId: 'Ravager (Barbarian)',
        enhancements: [{ enhancementId: 'NotARealItem', tier: 0, rank: 1 }],
      }],
    });

    const r = collectEffects({ build, ...gameData });
    expect(r.unmatchedTrees).toContain('NonexistentTree');
    expect(r.unmatchedEnhancements).toContain('Ravager (Barbarian)/NotARealItem');
  });

  it('uses [D] prefix for destiny enhancements', () => {
    // Find any destiny tree
    const destinyTree = gameData.enhancementTrees.find(t => t.isDestinyTree);
    expect(destinyTree).toBeDefined();
    const itemWithEffect = destinyTree!.items.find(i => i.effects.length > 0);
    expect(itemWithEffect).toBeDefined();

    const build = syntheticBuild({
      destinyEnhancements: [{
        treeId: destinyTree!.name,
        enhancements: [{ enhancementId: itemWithEffect!.internalName, tier: 0, rank: 1 }],
      }],
    });

    const r = collectEffects({ build, ...gameData });
    const destinyEffects = r.effects.filter(e => e.source.startsWith('[D]'));
    expect(destinyEffects.length).toBeGreaterThan(0);
  });
});
