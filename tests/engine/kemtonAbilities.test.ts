// @vitest-environment happy-dom
//
// End-to-end check that getMagicAbilities returns sensible values for the
// kemton fixture — specifically that trained-spell cooldowns survive the
// pipeline (Spells.xml → parser → ability builder).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import { parseClassXml, parseSpellsXml } from '@/utils/ddoXmlParser';
import { nameToId, skillNameToId } from '@/utils/classAdapter';
import { getMagicAbilities } from '@/engine/dps/abilities';

const ROOT = resolve(__dirname, '../..');
const FIXTURES = resolve(__dirname, '../fixtures');
const DATA = resolve(ROOT, 'public/data');

function readData(rel: string) {
  return readFileSync(resolve(DATA, rel), 'utf8');
}

describe('getMagicAbilities — kemton', () => {
  // Load classes + spells once.
  const classFiles = readdirSync(resolve(DATA, 'Classes')).filter(f => f.endsWith('.xml'));
  const classes = classFiles.map(f => parseClassXml(readData(`Classes/${f}`)))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const spells = parseSpellsXml(readData('Spells.xml'));

  // Build the classSkills lookup (parser needs it for SP→ranks conversion).
  const classSkillsByClassId: Record<string, string[]> = {};
  for (const c of classes) {
    classSkillsByClassId[nameToId(c.name)] = c.classSkills.map(skillNameToId);
  }

  const xml = readFileSync(resolve(FIXTURES, 'kemton.DDOBuild'), 'utf8');
  const parsed = parseDDOBuildFile(xml, { classSkillsByClassId });
  if (!parsed) throw new Error('Could not parse kemton fixture');
  const build = parsed.build;

  it('parses trained spells', () => {
    expect(build.trainedSpells).toBeDefined();
    expect(build.trainedSpells?.['Arcane Trickster']?.['1']).toContain('Magic Missile');
    expect(build.trainedSpells?.['Arcane Trickster']?.['2']).toContain('Scorching Ray');
    expect(build.trainedSpells?.['Arcane Trickster']?.['4']).toContain('Force Missiles');
  });

  it('damaging trained spells carry cooldowns from Spells.xml', () => {
    const abilities = getMagicAbilities(build, spells, classes, []);
    const magicMissile = abilities.find(a =>
      a.source === 'spell' && a.name === 'Magic Missile');
    expect(magicMissile).toBeDefined();
    expect(magicMissile!.cooldown).toBe(2);

    const scorchingRay = abilities.find(a =>
      a.source === 'spell' && a.name === 'Scorching Ray');
    expect(scorchingRay).toBeDefined();
    expect(scorchingRay!.cooldown).toBe(2);

    const forceMissiles = abilities.find(a =>
      a.source === 'spell' && a.name === 'Force Missiles');
    expect(forceMissiles).toBeDefined();
    expect(forceMissiles!.cooldown).toBe(4);
  });

  it('trained spells are marked as unlimited charges', () => {
    const abilities = getMagicAbilities(build, spells, classes, []);
    const magicMissile = abilities.find(a => a.source === 'spell' && a.name === 'Magic Missile');
    expect(magicMissile!.charges).toBe(0);
  });

  it('Wellspring of Power is selectable as a utility ability when trained', () => {
    // Sanity check: kemton has the feat in their build.feats list.
    expect(build.feats.some(f => f.featId === 'Wellspring of Power')).toBe(true);

    const abilities = getMagicAbilities(build, spells, classes, []);
    const wellspring = abilities.find(a =>
      a.source === 'sla' && a.name === 'Wellspring of Power');
    expect(wellspring).toBeDefined();
    expect(wellspring!.isUtility).toBe(true);
    expect(wellspring!.damages.length).toBe(0);
    expect(wellspring!.cooldown).toBe(180);
    expect(wellspring!.cost).toBe(0);
    expect(wellspring!.icon).toBe('WellspringOfPower');
  });

  it('Wellspring is omitted when the feat isn\'t trained', () => {
    const stripped = { ...build, feats: build.feats.filter(f => f.featId !== 'Wellspring of Power') };
    const abilities = getMagicAbilities(stripped, spells, classes, []);
    expect(abilities.find(a => a.name === 'Wellspring of Power')).toBeUndefined();
  });

  it('SLA cooldowns and charges fall back / patch correctly', () => {
    const abilities = getMagicAbilities(build, spells, classes, [
      // Stolen Spell - Magic Missile (AT enhancement) — provides own values.
      {
        name: 'Magic Missile',
        castingClass: 'Arcane Trickster',
        category: 'enhancement',
        cost: 2, maxCasterLevel: 5, cooldown: 4, charges: 0,
        source: '[E] Arcane Trickster: Stolen Spell I → Stolen Spell - Magic Missile',
      },
      // Past Life: Arcane Initiate — granting effect ships `<Amount>0 0 0 0</Amount>`,
      // CollectedSLA leaves cost/cd at 0. We expect cooldown to fall back to
      // the spell catalog (2s) and charges to be 10 from the manual patch.
      {
        name: 'Magic Missile',
        castingClass: 'Character',
        category: 'feat',
        cost: 0, maxCasterLevel: 0, cooldown: 0, charges: 10,
        source: '[PL] Past Life: Arcane Initiate ×3',
      },
    ]);
    const stolen = abilities.find(a =>
      a.source === 'sla' && a.slaSource?.includes('Stolen Spell I'));
    expect(stolen!.cooldown).toBe(4);
    expect(stolen!.charges).toBe(0);   // unlimited

    const pastLife = abilities.find(a =>
      a.source === 'sla' && a.slaSource?.includes('Arcane Initiate'));
    expect(pastLife!.cooldown).toBe(2);    // falls back to spell catalog
    expect(pastLife!.charges).toBe(10);    // from SLA_CHARGE_PATCHES
  });
});
