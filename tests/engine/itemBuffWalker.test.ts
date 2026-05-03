// @vitest-environment happy-dom
//
// Focused unit test for the item-buff source walker.
// Both reference fixture builds (kemton/zentek) have zero gear in their
// *active* life — only past lives carry gear in those .DDOBuild files —
// so we exercise the walker via synthetic builds with known item buffs.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml,
} from '@/utils/ddoXmlParser';
import { collectEffects } from '@/engine/collectEffects';
import { runEngine } from '@/engine/runEngine';
import { instantiateItemBuff } from '@/engine/itemBuffResolver';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build, GearSet } from '@/types/build';
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

  return {
    classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex,
  };
}

const gameData = loadGameData();

function gearOnly(name: string, items: GearSet['items']): Build {
  return {
    ...DEFAULT_BUILD,
    classes: [{ classId: 'fighter', levels: 20 }],
    activeGearSet: name,
    gearSets: [{ name, items }],
  };
}

describe('instantiateItemBuff (template substitution)', () => {
  it('AbilityBonus: fills bonus + amount + items from item buff', () => {
    const entry = gameData.itemBuffs['AbilityBonus'];
    expect(entry).toBeDefined();
    const result = instantiateItemBuff(entry!, {
      type: 'AbilityBonus', value1: 4, bonusType: 'Insightful', item: 'Strength',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.types).toEqual(['AbilityBonus']);
    expect(result[0]?.bonus).toBe('Insightful');
    expect(result[0]?.amount).toEqual([4]);
    expect(result[0]?.items).toEqual(['Strength']);
  });

  it('Vorpal: keeps catalog defaults when item buff has no overrides', () => {
    const entry = gameData.itemBuffs['Vorpal'];
    expect(entry).toBeDefined();
    const result = instantiateItemBuff(entry!, {
      type: 'Vorpal', bonusType: 'Enhancement', item: 'All',
    });
    expect(result[0]?.amount).toEqual([0.5]);   // catalog default preserved
    expect(result[0]?.bonus).toBe('Enhancement');
    expect(result[0]?.items).toEqual(['All']);
  });

  it('value2 contributes to amount table when present', () => {
    const entry = gameData.itemBuffs['AbilityBonus'];
    const result = instantiateItemBuff(entry!, {
      type: 'AbilityBonus', value1: 3, value2: 5, bonusType: 'Quality', item: 'Dexterity',
    });
    expect(result[0]?.amount).toEqual([3, 5]);
  });
});

describe('item buff source walker', () => {
  it('emits effects for active gear set items', () => {
    const build = gearOnly('Standard', [{
      slot: 'Necklace',
      name: 'Test Insight Strength Necklace',
      icon: '',
      buffs: [
        { type: 'AbilityBonus', value1: 4, bonusType: 'Insightful', item: 'Strength' },
      ],
    }]);

    const r = collectEffects({ build, ...gameData });
    expect(r.unmatchedItemBuffs).toEqual([]);
    const gearEffects = r.effects.filter(e => e.source.startsWith('[G]'));
    expect(gearEffects.length).toBeGreaterThan(0);
    expect(gearEffects[0]?.effect.bonus).toBe('Insightful');
    expect(gearEffects[0]?.effect.items).toEqual(['Strength']);
    expect(gearEffects[0]?.source).toContain('Necklace');
  });

  it('STR ability score breakdown picks up the +4 Insight bonus', () => {
    const build = gearOnly('Standard', [{
      slot: 'Necklace',
      name: 'Insight STR +4 Necklace',
      icon: '',
      buffs: [
        { type: 'AbilityBonus', value1: 4, bonusType: 'Insightful', item: 'Strength' },
      ],
    }]);

    const r = runEngine({ build, ...gameData });
    expect(r.abilityScores.STR.total).toBe(8 + 4);   // base 8 + Insight 4
    const insightBonus = r.abilityScores.STR.contributors.find(c => c.bonusType === 'Insightful');
    expect(insightBonus?.value).toBe(4);
    expect(insightBonus?.applied).toBe(true);
  });

  it('competing same-type bonuses: only the highest applies', () => {
    const build = gearOnly('Standard', [{
      slot: 'Necklace', name: 'Necklace +4', icon: '',
      buffs: [{ type: 'AbilityBonus', value1: 4, bonusType: 'Insightful', item: 'Constitution' }],
    }, {
      slot: 'Trinket', name: 'Trinket +6', icon: '',
      buffs: [{ type: 'AbilityBonus', value1: 6, bonusType: 'Insightful', item: 'Constitution' }],
    }]);
    const r = runEngine({ build, ...gameData });
    expect(r.abilityScores.CON.total).toBe(8 + 6);   // higher Insight wins
    const dominated = r.abilityScores.CON.contributors.filter(c => !c.applied);
    expect(dominated.length).toBe(1);
    expect(dominated[0]?.value).toBe(4);
  });

  it('different bonus types stack', () => {
    const build = gearOnly('Standard', [{
      slot: 'Necklace', name: 'Insight CON +4', icon: '',
      buffs: [{ type: 'AbilityBonus', value1: 4, bonusType: 'Insightful', item: 'Constitution' }],
    }, {
      slot: 'Goggles', name: 'Quality CON +2', icon: '',
      buffs: [{ type: 'AbilityBonus', value1: 2, bonusType: 'Quality', item: 'Constitution' }],
    }]);
    const r = runEngine({ build, ...gameData });
    expect(r.abilityScores.CON.total).toBe(8 + 4 + 2);
  });

  it('records unmatched item buffs as diagnostics', () => {
    const build = gearOnly('Standard', [{
      slot: 'Helmet', name: 'Bogus', icon: '',
      buffs: [{ type: 'NotARealBuffType', value1: 99 }],
    }]);
    const r = collectEffects({ build, ...gameData });
    expect(r.unmatchedItemBuffs).toContain('NotARealBuffType');
  });

  it('only walks the active gear set', () => {
    const build: Build = {
      ...DEFAULT_BUILD,
      classes: [{ classId: 'fighter', levels: 20 }],
      activeGearSet: 'Standard',
      gearSets: [
        {
          name: 'Standard',
          items: [{
            slot: 'Necklace', name: 'Active Set Item', icon: '',
            buffs: [{ type: 'AbilityBonus', value1: 4, bonusType: 'Insightful', item: 'Strength' }],
          }],
        },
        {
          name: 'Leveling',
          items: [{
            slot: 'Necklace', name: 'Inactive Set Item', icon: '',
            buffs: [{ type: 'AbilityBonus', value1: 999, bonusType: 'Stacking', item: 'Strength' }],
          }],
        },
      ],
    };
    const r = collectEffects({ build, ...gameData });
    const gearEffects = r.effects.filter(e => e.source.startsWith('[G]'));
    expect(gearEffects).toHaveLength(1);
    expect(gearEffects[0]?.source).toContain('Active Set Item');
  });
});
