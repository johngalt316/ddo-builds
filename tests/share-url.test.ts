// @vitest-environment happy-dom
//
// End-to-end check that the new gzip-based share URL encoding round-trips
// the kemton fixture, lands well under common URL limits, and the legacy
// lz-string format still decodes (back-compat for old shared links).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import LZString from 'lz-string';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';
import { parseClassXml } from '@/utils/ddoXmlParser';
import { nameToId, skillNameToId } from '@/utils/classAdapter';
import { encodeBuild, decodeBuild } from '@/utils/compression';

const ROOT = resolve(__dirname, '..');
const FIXTURES = resolve(__dirname, 'fixtures');
const DATA = resolve(ROOT, 'public/data');

function classSkillsLookup(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of readdirSync(resolve(DATA, 'Classes'))) {
    if (!f.endsWith('.xml')) continue;
    const parsed = parseClassXml(readFileSync(resolve(DATA, 'Classes', f), 'utf8'));
    if (!parsed) continue;
    out[nameToId(parsed.name)] = parsed.classSkills.map(skillNameToId);
  }
  return out;
}

function loadKemton() {
  const xml = readFileSync(resolve(FIXTURES, 'kemton.DDOBuild'), 'utf8');
  const parsed = parseDDOBuildFile(xml, { classSkillsByClassId: classSkillsLookup() });
  if (!parsed) throw new Error('Could not parse kemton fixture');
  return parsed.build;
}

describe('share-url compression', () => {
  it('encodes the kemton build well under typical URL length limits', async () => {
    const build = loadKemton();
    const encoded = await encodeBuild(build);
    // Real-world thresholds: modern browsers handle 16-32 kB URLs; the
    // conservative 8 kB number is a server-default-ish line. Kemton is a
    // worst-case fully-geared L34 build and lands in the high single-digit
    // kB range with gzip — far below browser limits, well below the
    // ~16 kB the previous lz-string scheme produced.
    expect(encoded.length).toBeLessThan(12 * 1024);
    // Sanity floor: encoded value should still be a meaningful payload.
    expect(encoded.length).toBeGreaterThan(1024);
    // Carries the version tag.
    expect(encoded.startsWith('g')).toBe(true);
  });

  it('beats the legacy lz-string scheme by a comfortable margin', async () => {
    const build = loadKemton();
    const json = JSON.stringify(build);
    const legacy = LZString.compressToEncodedURIComponent(json);
    const gzip = await encodeBuild(build);
    // Expect at least a 30% reduction — kemton sees ~43% in practice.
    expect(gzip.length).toBeLessThan(legacy.length * 0.7);
  });

  it('round-trips the kemton build losslessly', async () => {
    const build = loadKemton();
    const encoded = await encodeBuild(build);
    const decoded = await decodeBuild(encoded);
    expect(decoded).not.toBeNull();
    // JSON-equality (objects are deep-equal regardless of key order).
    expect(JSON.parse(JSON.stringify(decoded))).toEqual(JSON.parse(JSON.stringify(build)));
  });

  it('legacy lz-string-encoded hashes still decode', async () => {
    const build = loadKemton();
    const legacy = LZString.compressToEncodedURIComponent(JSON.stringify(build));
    expect(legacy.startsWith('g')).toBe(false);  // make sure the test isn't accidentally a gzip path
    const decoded = await decodeBuild(legacy);
    expect(decoded).not.toBeNull();
    expect(JSON.parse(JSON.stringify(decoded))).toEqual(JSON.parse(JSON.stringify(build)));
  });

  it('returns null on garbage input rather than throwing', async () => {
    expect(await decodeBuild('this-is-not-a-valid-encoded-build')).toBeNull();
    expect(await decodeBuild('g!!!not-base64!!!')).toBeNull();
  });
});
