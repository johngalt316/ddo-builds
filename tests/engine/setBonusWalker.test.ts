// @vitest-environment happy-dom
//
// Focused unit test for the set-bonus walker.
//
// Strategy: pick a real set from SetBonuses.xml + a real item from
// itemBuffs+itemIndex that belongs to that set. Then construct synthetic
// builds equipping varying piece counts and verify that:
//   - Below threshold → tier doesn't fire
//   - At/above threshold → tier fires
//   - Higher tiers stack with lower tiers
//   - itemSetIndex fallback works for items lacking item.setBonus

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml, parseAugmentsXml,
} from '@/utils/ddoXmlParser';
import { collectEffects } from '@/engine/collectEffects';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build, GearItem } from '@/types/build';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData, ItemBuffCatalog,
  DDOAugmentData,
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

  // Load all augments so the augment-granted set-bonus test below has the
  // real Lost Purpose catalog to draw from.
  const augmentFiles = readJson<string[]>('augments.json');
  const augments: DDOAugmentData[] = [];
  for (const f of augmentFiles) {
    augments.push(...parseAugmentsXml(readData(`Augments/${f}`)));
  }

  return { classes, races, feats, bonusTypes, enhancementTrees, itemBuffs, setBonuses, itemSetIndex, augments, filigrees: [], filigreeSetBonuses: [], selfPartyBuffs: [] };
}

const gameData = loadGameData();

function makeItem(slot: GearItem['slot'], name: string, setBonus?: string): GearItem {
  return { slot, name, icon: '', buffs: [], setBonus };
}

function buildWith(items: GearItem[]): Build {
  return {
    ...DEFAULT_BUILD,
    classes: [{ classId: 'fighter', levels: 20 }],
    activeGearSet: 'Standard',
    gearSets: [{ name: 'Standard', items }],
  };
}

describe('set-bonus walker', () => {
  // Pick the simplest possible target: "Anger's Wrath" — 2-piece tier with
  // a clear Weapon_Attack +2 effect.
  const targetSet = gameData.setBonuses.find(s => s.type === "Anger's Wrath");

  it("reference data: Anger's Wrath is loaded with a 2-piece tier", () => {
    expect(targetSet).toBeDefined();
    expect(targetSet!.buffs.length).toBeGreaterThan(0);
    expect(targetSet!.buffs[0]?.equippedCount).toBe(2);
  });

  it('below threshold: 1 piece does not fire the 2-piece tier', () => {
    const build = buildWith([
      makeItem('Helmet', 'Pretend Helm', "Anger's Wrath"),
    ]);
    const r = collectEffects({ build, ...gameData });
    const setEffects = r.effects.filter(e => e.source.startsWith('[S]'));
    expect(setEffects).toHaveLength(0);
  });

  it('at threshold: 2 pieces fires the 2-piece tier', () => {
    const build = buildWith([
      makeItem('Helmet',   'Pretend Helm',     "Anger's Wrath"),
      makeItem('Necklace', 'Pretend Necklace', "Anger's Wrath"),
    ]);
    const r = collectEffects({ build, ...gameData });
    const setEffects = r.effects.filter(e => e.source.startsWith('[S]'));
    expect(setEffects.length).toBeGreaterThan(0);
    expect(setEffects[0]?.source).toContain("Anger's Wrath");
    // Anger's Wrath 2pc grants Weapon_Attack +2 untyped
    expect(setEffects[0]?.effect.types).toContain('Weapon_Attack');
  });

  it('records unmatched set names as diagnostics', () => {
    const build = buildWith([
      makeItem('Helmet',   'Item A', 'Nonexistent Set'),
      makeItem('Necklace', 'Item B', 'Nonexistent Set'),
    ]);
    const r = collectEffects({ build, ...gameData });
    expect(r.unmatchedSets).toContain('Nonexistent Set');
  });

  it('itemSetIndex fallback fires when item.setBonus is missing on the gear item', () => {
    // Forbidden Knowledge has 40 indexed items + a SetBonuses.xml entry —
    // perfect for exercising the name-based fallback.
    const fkSet = gameData.setBonuses.find(s => s.type === 'Forbidden Knowledge');
    expect(fkSet).toBeDefined();

    // Two items known to be in the index for this set.
    const items = ['Absorption Gauntlet', 'Azure Buckler'];
    for (const n of items) {
      expect(gameData.itemSetIndex[n]).toBe('Forbidden Knowledge');
    }

    // Build them WITHOUT specifying setBonus — the walker should resolve via the index.
    const build = buildWith([
      makeItem('Gloves',  items[0]!),
      makeItem('OffHand' as never, items[1]!),
    ]);
    const r = collectEffects({ build, ...gameData });

    // Find the lowest tier in this set; if 2 ≤ that tier, expect the tier to fire.
    const lowestTier = Math.min(...fkSet!.buffs.map(b => b.equippedCount));
    if (lowestTier <= 2) {
      const setEffects = r.effects.filter(e => e.source.startsWith('[S] Forbidden Knowledge'));
      expect(setEffects.length).toBeGreaterThan(0);
    }
    // Either way, the set name should NOT be in unmatchedSets.
    expect(r.unmatchedSets).not.toContain('Forbidden Knowledge');
  });

  // Lost Purpose augments grant set bonuses to their host item rather than
  // emitting effects directly. Without engine-side support the Infernal Dance
  // / Armaments of the Archons / Wild Fortitude sets never fire even when
  // the player has 3 augments slotted across 3 items.
  describe('augment-granted set bonuses', () => {
    const augName = "Legendary Devil's Infernal Dance";
    const setName = "Legendary Devil's Infernal Dance";

    it('reference data: the Lost Purpose augment has setBonus=set name', () => {
      const aug = gameData.augments.find(a => a.name === augName);
      expect(aug).toBeDefined();
      expect(aug!.setBonus).toBe(setName);
    });

    it('3 items each carrying the augment fire the 3-piece tier', () => {
      const mkItemWithAug = (slot: GearItem['slot'], name: string): GearItem => ({
        slot, name, icon: '', buffs: [],
        augmentSlots: [{
          slotType: 'Lost Purpose',
          selectedAugment: augName,
        }],
      });
      const build = buildWith([
        mkItemWithAug('Trinket',  'Item A'),
        mkItemWithAug('Necklace', 'Item B'),
        mkItemWithAug('Ring1',    'Item C'),
      ]);
      const r = collectEffects({ build, ...gameData });
      const setEffects = r.effects.filter(e => e.source.includes(setName));
      // The set has 4 buff tiers all at 3 pieces — so all 4 fire here.
      expect(setEffects.length).toBeGreaterThanOrEqual(4);
      // Spot-check the Artifact-typed Doublestrike +15 buff is present.
      expect(setEffects.some(
        e => e.effect.types.includes('Doublestrike')
          && e.effect.bonus === 'Artifact'
          && e.effect.amount?.[0] === 15,
      )).toBe(true);
    });

    it('2 items with the augment do NOT fire the 3-piece tier', () => {
      const mkItemWithAug = (slot: GearItem['slot'], name: string): GearItem => ({
        slot, name, icon: '', buffs: [],
        augmentSlots: [{ slotType: 'Lost Purpose', selectedAugment: augName }],
      });
      const build = buildWith([
        mkItemWithAug('Trinket',  'Item A'),
        mkItemWithAug('Necklace', 'Item B'),
      ]);
      const r = collectEffects({ build, ...gameData });
      const setEffects = r.effects.filter(e => e.source.includes(setName));
      expect(setEffects).toHaveLength(0);
    });

    it('two augments on the same item count as ONE tick toward the set', () => {
      // DDO rule: each equipped item contributes 1 tick per set name regardless
      // of how many slots / augments claim that set. Without per-item dedup
      // the engine would over-count and fire the tier from a single item.
      const item: GearItem = {
        slot: 'Trinket', name: 'Item A', icon: '', buffs: [],
        augmentSlots: [
          { slotType: 'Lost Purpose',  selectedAugment: augName },
          { slotType: 'Lost Purpose ', selectedAugment: augName }, // second slot
        ],
      };
      const build = buildWith([item]);
      const r = collectEffects({ build, ...gameData });
      const setEffects = r.effects.filter(e => e.source.includes(setName));
      expect(setEffects).toHaveLength(0);   // 1 tick, well below 3-piece tier
    });
  });
});
