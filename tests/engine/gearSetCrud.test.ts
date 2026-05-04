// @vitest-environment happy-dom
//
// Unit tests for the gear-set CRUD actions: createGearSet, renameGearSet,
// duplicateGearSet, deleteGearSet. These mutate build.gearSets and keep
// build.activeGearSet pointing at a valid (or empty) entry.
import { describe, it, expect, beforeEach } from 'vitest';
import { useBuildStore } from '@/store/buildStore';
import { DEFAULT_BUILD } from '@/types/build';
import type { GearItem } from '@/types/build';

const SAMPLE_HELM: GearItem = {
  slot: 'Helmet', name: 'Test Helm', icon: '', buffs: [],
};

beforeEach(() => {
  useBuildStore.setState({
    build: { ...structuredClone(DEFAULT_BUILD), gearSets: [], activeGearSet: '' },
  });
});

describe('createGearSet', () => {
  it('appends a new empty set and makes it active', () => {
    useBuildStore.getState().createGearSet('Standard');
    const { gearSets, activeGearSet } = useBuildStore.getState().build;
    expect(gearSets).toEqual([{ name: 'Standard', items: [] }]);
    expect(activeGearSet).toBe('Standard');
  });

  it('rejects duplicate names', () => {
    useBuildStore.getState().createGearSet('A');
    useBuildStore.getState().createGearSet('A');
    expect(useBuildStore.getState().build.gearSets).toHaveLength(1);
  });

  it('trims whitespace and rejects blank', () => {
    useBuildStore.getState().createGearSet('  ');
    expect(useBuildStore.getState().build.gearSets).toHaveLength(0);

    useBuildStore.getState().createGearSet('  Trimmed  ');
    expect(useBuildStore.getState().build.gearSets[0]?.name).toBe('Trimmed');
  });
});

describe('renameGearSet', () => {
  it('renames a set and updates activeGearSet if it matched', () => {
    useBuildStore.getState().createGearSet('A');
    useBuildStore.getState().renameGearSet('A', 'B');
    const b = useBuildStore.getState().build;
    expect(b.gearSets[0]?.name).toBe('B');
    expect(b.activeGearSet).toBe('B');
  });

  it('refuses to rename to an existing name', () => {
    useBuildStore.getState().createGearSet('A');
    useBuildStore.getState().createGearSet('B');
    useBuildStore.getState().renameGearSet('A', 'B');
    const names = useBuildStore.getState().build.gearSets.map(g => g.name);
    expect(names).toEqual(['A', 'B']);
  });

  it('preserves activeGearSet when renaming a non-active set', () => {
    useBuildStore.getState().createGearSet('A');
    useBuildStore.getState().createGearSet('B');   // B becomes active
    useBuildStore.getState().renameGearSet('A', 'AA');
    expect(useBuildStore.getState().build.activeGearSet).toBe('B');
  });
});

describe('duplicateGearSet', () => {
  beforeEach(() => {
    useBuildStore.getState().createGearSet('Original');
    useBuildStore.getState().equipItem('Helmet', SAMPLE_HELM);
  });

  it('clones items into a new set and makes it active', () => {
    useBuildStore.getState().duplicateGearSet('Original', 'Copy');
    const b = useBuildStore.getState().build;
    expect(b.gearSets.map(g => g.name)).toEqual(['Original', 'Copy']);
    expect(b.activeGearSet).toBe('Copy');
    expect(b.gearSets[1]?.items).toHaveLength(1);
    expect(b.gearSets[1]?.items[0]?.name).toBe('Test Helm');
  });

  it('clones items by value (cloning then unequipping in original keeps copy intact)', () => {
    useBuildStore.getState().duplicateGearSet('Original', 'Copy');
    // Switch back to Original and unequip the helm there.
    useBuildStore.getState().setActiveGearSet('Original');
    useBuildStore.getState().unequipItem('Helmet');

    const sets = useBuildStore.getState().build.gearSets;
    const original = sets.find(g => g.name === 'Original');
    const copy     = sets.find(g => g.name === 'Copy');
    expect(original?.items).toHaveLength(0);
    expect(copy?.items).toHaveLength(1);
  });

  it('rejects duplicate target names', () => {
    useBuildStore.getState().duplicateGearSet('Original', 'Original');
    expect(useBuildStore.getState().build.gearSets).toHaveLength(1);
  });
});

describe('deleteGearSet', () => {
  it('removes the set and falls back to first remaining when active was deleted', () => {
    useBuildStore.getState().createGearSet('A');
    useBuildStore.getState().createGearSet('B');   // B is now active
    useBuildStore.getState().deleteGearSet('B');
    const built = useBuildStore.getState().build;
    expect(built.gearSets.map(g => g.name)).toEqual(['A']);
    expect(built.activeGearSet).toBe('A');
  });

  it('preserves activeGearSet when deleting a non-active set', () => {
    useBuildStore.getState().createGearSet('A');
    useBuildStore.getState().createGearSet('B');   // B is active
    useBuildStore.getState().deleteGearSet('A');
    expect(useBuildStore.getState().build.activeGearSet).toBe('B');
  });

  it('clears activeGearSet to empty when deleting the only set', () => {
    useBuildStore.getState().createGearSet('Only');
    useBuildStore.getState().deleteGearSet('Only');
    const built = useBuildStore.getState().build;
    expect(built.gearSets).toHaveLength(0);
    expect(built.activeGearSet).toBe('');
  });
});
