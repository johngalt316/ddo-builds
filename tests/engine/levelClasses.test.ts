import { describe, it, expect } from 'vitest';
import { resolveLevelClasses, aggregateClasses } from '../../src/utils/levelClasses';
import { DEFAULT_BUILD } from '../../src/types/build';

describe('resolveLevelClasses', () => {
  it('uses build.levelClasses when length matches charLevel', () => {
    const build = {
      ...DEFAULT_BUILD,
      classes: [{ classId: 'fighter', levels: 3 }],
      levelClasses: ['fighter', 'rogue', 'fighter'],
    };
    expect(resolveLevelClasses(build)).toEqual(['fighter', 'rogue', 'fighter']);
  });

  it('falls back to deriving from classes[] when levelClasses is empty', () => {
    const build = {
      ...DEFAULT_BUILD,
      classes: [{ classId: 'fighter', levels: 3 }, { classId: 'rogue', levels: 2 }],
      levelClasses: [],
    };
    expect(resolveLevelClasses(build))
      .toEqual(['fighter', 'fighter', 'fighter', 'rogue', 'rogue']);
  });

  it('falls back to deriving when stored length mismatches charLevel', () => {
    const build = {
      ...DEFAULT_BUILD,
      classes: [{ classId: 'fighter', levels: 5 }],
      levelClasses: ['fighter', 'rogue'],   // length 2, but charLevel = 5
    };
    expect(resolveLevelClasses(build))
      .toEqual(['fighter', 'fighter', 'fighter', 'fighter', 'fighter']);
  });

  it('returns [] for charLevel = 0', () => {
    const build = { ...DEFAULT_BUILD, classes: [], levelClasses: undefined };
    expect(resolveLevelClasses(build)).toEqual([]);
  });
});

describe('aggregateClasses', () => {
  it('counts identical adjacent ids', () => {
    expect(aggregateClasses(['fighter', 'fighter', 'rogue']))
      .toEqual([{ classId: 'fighter', levels: 2 }, { classId: 'rogue', levels: 1 }]);
  });

  it('preserves order-of-first-appearance even when interleaved', () => {
    expect(aggregateClasses(['rogue', 'fighter', 'rogue', 'fighter']))
      .toEqual([{ classId: 'rogue', levels: 2 }, { classId: 'fighter', levels: 2 }]);
  });

  it('returns [] for empty input', () => {
    expect(aggregateClasses([])).toEqual([]);
  });
});
