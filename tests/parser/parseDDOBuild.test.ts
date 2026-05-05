// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import { parseClassXml } from '@/utils/ddoXmlParser';
import { nameToId, skillNameToId } from '@/utils/classAdapter';

const FIXTURES = resolve(__dirname, '../fixtures');
const SNAPSHOTS = resolve(__dirname, '../snapshots');
const CLASSES_DIR = resolve(__dirname, '../../public/data/Classes');

// Load classSkills from class XMLs so the parser can correctly halve cross-
// class skill SP into ranks (1 SP/rank for class skills, 2 SP/rank otherwise).
function buildClassSkillsLookup(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of readdirSync(CLASSES_DIR)) {
    if (!f.endsWith('.xml')) continue;
    const parsed = parseClassXml(readFileSync(resolve(CLASSES_DIR, f), 'utf8'));
    if (!parsed) continue;
    out[nameToId(parsed.name)] = parsed.classSkills.map(skillNameToId);
  }
  return out;
}

const classSkillsByClassId = buildClassSkillsLookup();

function parseFixture(filename: string) {
  const xml = readFileSync(resolve(FIXTURES, filename), 'utf8');
  const result = parseDDOBuildFile(xml, { classSkillsByClassId });
  if (!result) throw new Error(`parseDDOBuildFile returned null for ${filename}`);
  return result;
}

describe('parseDDOBuildFile snapshots', () => {
  it('kemton.DDOBuild parses to a stable build object', async () => {
    const result = parseFixture('kemton.DDOBuild');
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(
      resolve(SNAPSHOTS, 'kemton.DDOBuild.snap.json'),
    );
  });

  it('zentek.DDOBuild parses to a stable build object', async () => {
    const result = parseFixture('zentek.DDOBuild');
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(
      resolve(SNAPSHOTS, 'zentek.DDOBuild.snap.json'),
    );
  });
});
