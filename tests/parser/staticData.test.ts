// @vitest-environment happy-dom
//
// Snapshots for the Phase 1 static-data XML parsers. We intentionally
// snapshot *summaries* (counts + first few entries) rather than full
// parsed contents — the source XML files are upstream-managed by
// DDOBuilderV2 and a 2,000-line snapshot would churn on every game-data
// refresh, defeating the regression-net purpose. Counts catch "the
// parser dropped half the entries" without flagging "Maetrim added 3
// new items."
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseBonusTypesXml,
  parseStancesXml,
  parseWeaponGroupsXml,
  parseSetBonusesXml,
  parseFeatsXml,
  parseSpellsXml,
  parseClassXml,
} from '@/utils/ddoXmlParser';
import { findUnknownEffectTypes } from '@/utils/effectParser';

const DATA = resolve(__dirname, '../../public/data');
const SNAPSHOTS = resolve(__dirname, '../snapshots');

function readData(name: string) {
  return readFileSync(resolve(DATA, name), 'utf8');
}

describe('static-data parsers', () => {
  it('BonusTypes.xml parses to a stable summary', async () => {
    const types = parseBonusTypesXml(readData('BonusTypes.xml'));
    const summary = {
      count: types.length,
      stackingValues: [...new Set(types.map(t => t.stacking))].sort(),
      first10: types.slice(0, 10),
    };
    await expect(JSON.stringify(summary, null, 2))
      .toMatchFileSnapshot(resolve(SNAPSHOTS, 'BonusTypes.summary.json'));
  });

  it('Stances.xml parses to a stable summary', async () => {
    const stances = parseStancesXml(readData('Stances.xml'));
    const summary = {
      count: stances.length,
      groups: [...new Set(stances.map(s => s.group))].sort(),
      autoControlledCount: stances.filter(s => s.autoControlled).length,
      withRequirements: stances.filter(s =>
        s.requirements.allOf.length || s.requirements.oneOf.length || s.requirements.noneOf.length
      ).length,
      first5Names: stances.slice(0, 5).map(s => s.name),
    };
    await expect(JSON.stringify(summary, null, 2))
      .toMatchFileSnapshot(resolve(SNAPSHOTS, 'Stances.summary.json'));
  });

  it('WeaponGroupings.xml parses to a stable summary', async () => {
    const groups = parseWeaponGroupsXml(readData('WeaponGroupings.xml'));
    const summary = {
      count: groups.length,
      groupSizes: groups.map(g => ({ name: g.name, weaponCount: g.weapons.length })),
    };
    await expect(JSON.stringify(summary, null, 2))
      .toMatchFileSnapshot(resolve(SNAPSHOTS, 'WeaponGroupings.summary.json'));
  });

  it('SetBonuses.xml parses to a stable summary', async () => {
    const sets = parseSetBonusesXml(readData('SetBonuses.xml'));
    const allEffects = sets.flatMap(s => s.buffs.flatMap(b => b.effects));
    const unknownTypes = [...findUnknownEffectTypes(allEffects)].sort();
    const summary = {
      count: sets.length,
      withBuffs: sets.filter(s => s.buffs.length > 0).length,
      maxBuffsPerSet: Math.max(...sets.map(s => s.buffs.length)),
      totalEffects: allEffects.length,
      unknownEffectTypes: unknownTypes,    // should be empty if codegen is current
      first3: sets.slice(0, 3).map(s => ({
        type: s.type,
        buffCount: s.buffs.length,
        firstBuffEquippedCount: s.buffs[0]?.equippedCount,
        firstBuffEffectTypes: s.buffs[0]?.effects.flatMap(e => e.types),
      })),
    };
    await expect(JSON.stringify(summary, null, 2))
      .toMatchFileSnapshot(resolve(SNAPSHOTS, 'SetBonuses.summary.json'));
  });

  it('Feats.xml parses with effect blocks attached', async () => {
    const feats = parseFeatsXml(readData('Feats.xml'));
    const featsWithEffects = feats.filter(f => f.effects.length > 0);
    const allEffects = feats.flatMap(f => f.effects);
    const unknownTypes = [...findUnknownEffectTypes(allEffects)].sort();
    const summary = {
      totalFeats: feats.length,
      featsWithEffects: featsWithEffects.length,
      totalEffects: allEffects.length,
      unknownEffectTypes: unknownTypes,    // should be empty if codegen is current
      sampleFeat: feats.find(f => f.name === 'Adamantine Body'),
    };
    await expect(JSON.stringify(summary, null, 2))
      .toMatchFileSnapshot(resolve(SNAPSHOTS, 'Feats.summary.json'));
  });

  it('Spells.xml parses to a stable summary', async () => {
    const spells = parseSpellsXml(readData('Spells.xml'));
    const schools = [...new Set(spells.map(s => s.school))].sort();
    const withDamage   = spells.filter(s => s.damages.length > 0).length;
    const withDC       = spells.filter(s => s.dcs.length > 0).length;
    const withEffects  = spells.filter(s => s.effects.length > 0).length;
    const metamagicCounts: Record<string, number> = {};
    for (const s of spells) {
      for (const k of Object.keys(s.metamagic)) {
        metamagicCounts[k] = (metamagicCounts[k] ?? 0) + 1;
      }
    }
    const summary = {
      count: spells.length,
      schools,
      withDamage, withDC, withEffects,
      metamagicCounts,
      sample: {
        magicMissile:   spells.find(s => s.name === 'Magic Missile'),
        sleep:          spells.find(s => s.name === 'Sleep'),
        sonicBlast:     spells.find(s => s.name === 'Sonic Blast'),
      },
    };
    await expect(JSON.stringify(summary, null, 2))
      .toMatchFileSnapshot(resolve(SNAPSHOTS, 'Spells.summary.json'));
  });

  it('Wizard class XML carries ClassSpell entries that join to Spells.xml', async () => {
    const wizard = parseClassXml(readData('Classes/Wizard.class.xml'));
    expect(wizard).not.toBeNull();
    expect(wizard!.spells.length).toBeGreaterThan(100);
    // Magic Missile should be a Wizard 1
    const mm = wizard!.spells.find(s => s.name === 'Magic Missile');
    expect(mm).toBeDefined();
    expect(mm!.level).toBe(1);
    expect(mm!.cost).toBe(4);
    expect(mm!.maxCasterLevel).toBe(20);   // ddo-builds patch: raised from upstream 9
    // Catalog has the spell so the join works
    const spells = parseSpellsXml(readData('Spells.xml'));
    expect(spells.find(s => s.name === 'Magic Missile')).toBeDefined();
  });
});
