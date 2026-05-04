import { describe, it, expect } from 'vitest';
import { requiredReaperXp } from '@/engine/reaperXp';

// DDOBuilderV2 reference (ReaperEnhancementsPane.cpp):
//   for (i = 0; i < totalReaperPoints; ++i) reaperXp += (i*2 + 1);
// Sum of first N odd numbers = N², expressed in thousands of XP.
describe('requiredReaperXp', () => {
  it('0 RAPs requires 0 XP', () => expect(requiredReaperXp(0)).toBe(0));
  it('1 RAP requires 1k', () => expect(requiredReaperXp(1)).toBe(1));
  it('2 RAPs requires 4k', () => expect(requiredReaperXp(2)).toBe(4));
  it('5 RAPs requires 25k', () => expect(requiredReaperXp(5)).toBe(25));
  it('10 RAPs requires 100k', () => expect(requiredReaperXp(10)).toBe(100));
  it('grows quadratically (matches sum of first N odd numbers)', () => {
    let sum = 0;
    for (let n = 1; n <= 50; n++) {
      sum += (2 * n - 1);
      expect(requiredReaperXp(n)).toBe(sum);
    }
  });
});
