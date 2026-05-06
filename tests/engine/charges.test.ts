// @vitest-environment happy-dom
//
// Reaper + action-boost charge calculation. Verifies the kemton fixture
// (9 reaper boosts + 3 Reaper's Charge enhancements) lands at 13.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import { parseClassXml, parseEnhancementTreeXml } from '@/utils/ddoXmlParser';
import { nameToId, skillNameToId } from '@/utils/classAdapter';
import {
  computeReaperCharges, computeActionBoostCharges,
} from '@/engine/dps/abilities';
import type { EnhancementTreeData } from '@/types/ddoData';

const ROOT = resolve(__dirname, '../..');
const FIXTURES = resolve(__dirname, '../fixtures');
const DATA = resolve(ROOT, 'public/data');

function readData(rel: string) { return readFileSync(resolve(DATA, rel), 'utf8'); }

describe('charge pools', () => {
  const classFiles = readdirSync(resolve(DATA, 'Classes')).filter(f => f.endsWith('.xml'));
  const classes = classFiles.map(f => parseClassXml(readData(`Classes/${f}`))).filter((c): c is NonNullable<typeof c> => c !== null);
  const treeFiles = readdirSync(resolve(DATA, 'EnhancementTrees')).filter(f => f.endsWith('.xml'));
  const trees = treeFiles.map(f => parseEnhancementTreeXml(readData(`EnhancementTrees/${f}`))).filter((t): t is EnhancementTreeData => t !== null);
  const csbcid: Record<string,string[]> = {};
  for (const c of classes) csbcid[nameToId(c.name)] = c.classSkills.map(skillNameToId);
  const xml = readFileSync(resolve(FIXTURES, 'kemton.DDOBuild'), 'utf8');
  const parsed = parseDDOBuildFile(xml, { classSkillsByClassId: csbcid });
  if (!parsed) throw new Error('kemton fixture failed to parse');
  const build = parsed.build;

  it('kemton has 13 reaper charges (1 base + 9 boosts + 3 Reaper\'s Charge enhancements)', () => {
    expect(computeReaperCharges(build, trees)).toBe(13);
  });

  it('reaper charges fall to 0 when no reaper enhancements are taken', () => {
    const stripped = {
      ...build,
      enhancementSets: build.enhancementSets.map(s =>
        s.name === build.activeEnhancementSet
          ? { ...s, reaperEnhancements: [] }
          : s,
      ),
    };
    expect(computeReaperCharges(stripped, trees)).toBe(0);
  });

  it('action boosts default to 5 baseline charges', () => {
    // Kemton has no action-boost charge augments / Extra Action Boost
    // enhancements, so the count stays at the baseline.
    expect(computeActionBoostCharges(build, trees)).toBe(5);
  });
});
