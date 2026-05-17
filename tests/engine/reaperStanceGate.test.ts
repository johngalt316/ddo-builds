// @vitest-environment happy-dom
//
// Validates that the `withReaperStance(build, inReaper)` helper unlocks
// reaper-conditional enhancement bonuses (the ones gated by a
// <Stance>Reaper</Stance> requirement in their XML) when called with
// `inReaper=true`. Engine semantics — the DPS panel's difficulty slider
// drives this flag; this test exercises the underlying engine path.
//
// Canonical example: Dire Thaumaturge's "Reaper's Arcanum I" (DireCore1)
// emits a +50 SpellPoints Reaper-typed bonus that's stance-gated. Without
// the Reaper stance the bonus is correctly skipped; with it, the bonus
// fires and lands on the build's SP breakdown.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEngine } from '@/engine/runEngine';
import { withReaperStance } from '@/hooks/useBreakdowns';
import {
  parseClassXml, parseRaceXml, parseFeatsXml, parseBonusTypesXml,
  parseEnhancementTreeXml, parseSetBonusesXml, parseAugmentsXml,
} from '@/utils/ddoXmlParser';
import { DEFAULT_BUILD } from '@/types/build';
import type { Build } from '@/types/build';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData,
  ItemBuffCatalog, DDOAugmentData,
} from '@/types/ddoData';

const DATA = resolve(__dirname, '../../public/data');
function read(rel: string) { return readFileSync(resolve(DATA, rel), 'utf8'); }
function readJson<T>(rel: string): T {
  const raw = read(rel);
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw) as T;
}

function loadMin() {
  const classFiles = readJson<string[]>('classes.json');
  const raceFiles  = readJson<string[]>('races.json');
  const augmentFiles = readJson<string[]>('augments.json');
  const classXmls = classFiles.map(f => read(`Classes/${f}`));
  const raceXmls  = raceFiles.map(f => read(`Races/${f}`));
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
  const treeFiles = readJson<string[]>('enhancementTrees.json');
  const enhancementTrees = treeFiles
    .map(f => parseEnhancementTreeXml(read(`EnhancementTrees/${f}`)))
    .filter((t): t is EnhancementTreeData => t !== null);
  const itemBuffs = readJson<ItemBuffCatalog>('items/itemBuffs.json');
  const setBonuses = parseSetBonusesXml(read('SetBonuses.xml'));
  const augments: DDOAugmentData[] = [];
  for (const f of augmentFiles) {
    augments.push(...parseAugmentsXml(read(`Augments/${f}`)));
  }
  return {
    classes, races, feats, bonusTypes, enhancementTrees,
    itemBuffs, setBonuses, itemSetIndex: {}, augments,
    filigrees: [], filigreeSetBonuses: [], selfPartyBuffs: [],
  };
}

// Module-level cache — game-data parse is slow.
const gameData = loadMin();

function buildWithDireCore1(): Build {
  // Engine reads reaper enhancements from the *active* enhancement set.
  // Spell up an enhancementSets wrapper so getActiveEnhancementSet finds it.
  return {
    ...DEFAULT_BUILD,
    classes: [{ classId: 'wizard', levels: 20 }],
    levelClasses: Array(20).fill('wizard'),
    epicLevels: 14,
    activeEnhancementSet: 'Default',
    enhancementSets: [{
      name: 'Default',
      enhancements: [],
      destinyEnhancements: [],
      reaperEnhancements: [{
        treeId: 'Dire Thaumaturge',
        enhancements: [{ enhancementId: 'DireCore1', tier: 0, rank: 1 }],
      }],
      selectedEnhancementTrees: [],
      treesManuallyOverridden: false,
    }],
  };
}

describe('withReaperStance — gating reaper-conditional enhancement effects', () => {
  it('helper adds "Reaper" to activeStances when inReaper=true', () => {
    const base: Build = { ...DEFAULT_BUILD, activeStances: ['Heavy Armor'] };
    expect(withReaperStance(base, false).activeStances).toEqual(['Heavy Armor']);
    expect(withReaperStance(base, true).activeStances).toEqual(['Heavy Armor', 'Reaper']);
  });

  it('helper is idempotent — already-Reaper builds pass through unchanged', () => {
    const base: Build = { ...DEFAULT_BUILD, activeStances: ['Reaper', 'Heavy Armor'] };
    const out = withReaperStance(base, true);
    expect(out).toBe(base); // same reference — no re-creation
  });

  it('DireCore1 +50 SP gate fires only when Reaper stance is active', () => {
    const build = buildWithDireCore1();

    // Without Reaper stance: DireCore1's +50 SP effect is skipped (failed
    // requirements). The HitpointsReaper effect IS emitted but isn't in
    // the standard HP breakdown either (intentionally excluded — see
    // breakdowns.ts HP_TYPES comment).
    const baseline = runEngine({ build, ...gameData });
    const baseSP = baseline.spellPoints.total;

    // With Reaper stance: DireCore1's +50 SP effect fires.
    const reaper  = runEngine({ build: withReaperStance(build, true), ...gameData });
    const reaperSP = reaper.spellPoints.total;

    expect(reaperSP - baseSP).toBe(50);

    // And the breakdown should show the new contributor.
    const newSource = reaper.spellPoints.contributors.find(
      c => c.source.includes('Dire Thaumaturge') && c.source.includes('Reaper'),
    );
    expect(newSource).toBeDefined();
    expect(newSource!.value).toBe(50);
  });
});
