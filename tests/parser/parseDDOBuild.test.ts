// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDDOBuildFile } from '@/utils/ddoBuildParser';

const FIXTURES = resolve(__dirname, '../fixtures');
const SNAPSHOTS = resolve(__dirname, '../snapshots');

function parseFixture(filename: string) {
  const xml = readFileSync(resolve(FIXTURES, filename), 'utf8');
  const result = parseDDOBuildFile(xml);
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
