// @vitest-environment happy-dom
//
// Verifies the setLevelClass / setTotalLevels store actions keep
// build.classes and build.levelClasses coherent. Engine logic still reads
// build.classes, so these actions are responsible for re-aggregating.
import { describe, it, expect, beforeEach } from 'vitest';
import { useBuildStore } from '@/store/buildStore';
import { DEFAULT_BUILD } from '@/types/build';

describe('setLevelClass', () => {
  beforeEach(() => {
    useBuildStore.setState({
      build: {
        ...structuredClone(DEFAULT_BUILD),
        classes: [{ classId: 'fighter', levels: 3 }],
        levelClasses: ['fighter', 'fighter', 'fighter'],
      },
    });
  });

  it('updates a single level and re-aggregates classes[]', () => {
    useBuildStore.getState().setLevelClass(2, 'rogue');
    const b = useBuildStore.getState().build;
    expect(b.levelClasses).toEqual(['fighter', 'rogue', 'fighter']);
    // Order-of-first-appearance: fighter then rogue
    expect(b.classes).toEqual([
      { classId: 'fighter', levels: 2 },
      { classId: 'rogue', levels: 1 },
    ]);
  });

  it('changing all levels to one class collapses to a single ClassLevel entry', () => {
    useBuildStore.getState().setLevelClass(1, 'rogue');
    useBuildStore.getState().setLevelClass(2, 'rogue');
    useBuildStore.getState().setLevelClass(3, 'rogue');
    expect(useBuildStore.getState().build.classes)
      .toEqual([{ classId: 'rogue', levels: 3 }]);
  });

  it('rejects out-of-range levels (negative)', () => {
    const before = useBuildStore.getState().build;
    useBuildStore.getState().setLevelClass(0, 'rogue');
    useBuildStore.getState().setLevelClass(-1, 'rogue');
    expect(useBuildStore.getState().build).toEqual(before);
  });

  it('extends by exactly one level when level === current length + 1', () => {
    useBuildStore.getState().setLevelClass(4, 'rogue');
    const b = useBuildStore.getState().build;
    expect(b.levelClasses).toEqual(['fighter', 'fighter', 'fighter', 'rogue']);
    expect(b.classes).toEqual([
      { classId: 'fighter', levels: 3 },
      { classId: 'rogue', levels: 1 },
    ]);
  });
});

describe('setTotalLevels', () => {
  beforeEach(() => {
    useBuildStore.setState({
      build: {
        ...structuredClone(DEFAULT_BUILD),
        classes: [{ classId: 'fighter', levels: 3 }],
        levelClasses: ['fighter', 'fighter', 'fighter'],
      },
    });
  });

  it('grows by repeating the last assigned class', () => {
    useBuildStore.getState().setTotalLevels(5);
    const b = useBuildStore.getState().build;
    expect(b.levelClasses).toHaveLength(5);
    expect(b.classes).toEqual([{ classId: 'fighter', levels: 5 }]);
  });

  it('shrinks from the end', () => {
    useBuildStore.setState({
      build: {
        ...DEFAULT_BUILD,
        classes: [{ classId: 'fighter', levels: 2 }, { classId: 'rogue', levels: 1 }],
        levelClasses: ['fighter', 'fighter', 'rogue'],
      },
    });
    useBuildStore.getState().setTotalLevels(2);
    const b = useBuildStore.getState().build;
    expect(b.levelClasses).toEqual(['fighter', 'fighter']);
    expect(b.classes).toEqual([{ classId: 'fighter', levels: 2 }]);
  });

  it('clamps to [1, 40]', () => {
    useBuildStore.getState().setTotalLevels(0);
    expect(useBuildStore.getState().build.levelClasses).toHaveLength(1);

    useBuildStore.getState().setTotalLevels(99);
    expect(useBuildStore.getState().build.levelClasses).toHaveLength(40);
  });
});

describe('updateClasses re-derives levelClasses', () => {
  it('keeps levelClasses in sync when classes[] is replaced', () => {
    useBuildStore.setState({ build: structuredClone(DEFAULT_BUILD) });
    useBuildStore.getState().updateClasses([
      { classId: 'rogue', levels: 2 },
      { classId: 'wizard', levels: 1 },
    ]);
    const b = useBuildStore.getState().build;
    expect(b.levelClasses).toEqual(['rogue', 'rogue', 'wizard']);
  });
});
