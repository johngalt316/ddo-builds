// Snapshot test for the items preprocess output.
//
// The preprocess script runs manually (`npm run import-items`) and writes
// to public/data/items/. This test asserts that the committed output is
// internally consistent — counts match between the master index and the
// per-slot shards, every item has a non-empty name, etc. It does NOT
// re-run the preprocess; that's a build-machine concern.
//
// If this test fails after `npm run import-items`, either the upstream
// item set changed (update the snapshot) or the preprocess script has
// a bug.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ITEMS_DIR = resolve(__dirname, '../../public/data/items');
const SNAPSHOTS = resolve(__dirname, '../snapshots');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface IndexEntry {
  name: string;
  slots: string[];
  minLevel?: number;
  setBonus?: string;
  icon: string;
}

interface SlotItem {
  name: string;
  slots: string[];
  buffs?: unknown[];
}

describe('items preprocess output', () => {
  it('has the expected files', () => {
    expect(existsSync(resolve(ITEMS_DIR, 'index.json'))).toBe(true);
    expect(existsSync(resolve(ITEMS_DIR, 'itemBuffs.json'))).toBe(true);
    expect(existsSync(resolve(ITEMS_DIR, 'stats.json'))).toBe(true);
    expect(existsSync(resolve(ITEMS_DIR, 'by-slot'))).toBe(true);
  });

  it('master index is internally consistent', async () => {
    const index = readJson<IndexEntry[]>(resolve(ITEMS_DIR, 'index.json'));
    const stats = readJson<{ totalItems: number; bySlot: Record<string, number> }>(
      resolve(ITEMS_DIR, 'stats.json'),
    );

    expect(index.length).toBe(stats.totalItems);
    expect(index.every(i => i.name.length > 0)).toBe(true);
    expect(index.every(i => Array.isArray(i.slots) && i.slots.length > 0)).toBe(true);

    // Per-slot shard counts should match index counts when summed
    const slotCounts: Record<string, number> = {};
    for (const item of index) {
      for (const slot of item.slots) {
        slotCounts[slot] = (slotCounts[slot] ?? 0) + 1;
      }
    }
    expect(slotCounts).toEqual(stats.bySlot);
  });

  it('per-slot shards match the index', () => {
    const stats = readJson<{ bySlot: Record<string, number> }>(
      resolve(ITEMS_DIR, 'stats.json'),
    );
    for (const [slot, expectedCount] of Object.entries(stats.bySlot)) {
      const shardPath = resolve(ITEMS_DIR, 'by-slot', `${slot}.json`);
      expect(existsSync(shardPath), `missing shard ${slot}`).toBe(true);
      const shard = readJson<SlotItem[]>(shardPath);
      expect(shard.length, `${slot} shard length`).toBe(expectedCount);
      expect(shard.every(item => item.slots.includes(slot))).toBe(true);
    }
  });

  it('item count summary is stable', async () => {
    const stats = readJson<unknown>(resolve(ITEMS_DIR, 'stats.json'));
    await expect(JSON.stringify(stats, null, 2))
      .toMatchFileSnapshot(resolve(SNAPSHOTS, 'items.stats.snap.json'));
  });
});
