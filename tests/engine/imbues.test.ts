// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parseImbueRider } from '@/engine/dps/imbues';

describe('parseImbueRider', () => {
  it('parses standard 1d6 element-specific SP imbue', () => {
    const r = parseImbueRider('BE: Thundershock', 'Imbue Toggle: Your weapons hum with Electricity, dealing an extra 1d6 Electric damage on each hit, scaling with Electric Spell Power.');
    expect(r).toMatchObject({ diceNum: 1, diceSides: 6, diceBonus: 0, damageType: 'Electric', scalingPct: 100, scalingStat: 'sp' });
  });

  it('parses AA 1d8 75% Spell Power imbue', () => {
    const r = parseImbueRider('AA: Flaming Arrows', 'Imbue Toggle: Your arrows gain the Flaming, dealing 1d8 fire damage on hit, scaling with 75% of your Spell Power.');
    expect(r).toMatchObject({ diceNum: 1, diceSides: 8, damageType: 'Fire', scalingPct: 75, scalingStat: 'universal_sp' });
  });

  it('parses higher-of-MP/RP imbue', () => {
    const r = parseImbueRider('NS: Sting', 'Imbue Toggle: ... you deal an additional 1d6 Poison damage on hit scaling with 100% of the higher of Melee or Ranged power...');
    expect(r).toMatchObject({ diceNum: 1, diceSides: 6, damageType: 'Poison', scalingPct: 100, scalingStat: 'higher_mr_p' });
  });

  it('parses per-Imbue-Die rank-bracket dice', () => {
    const r = parseImbueRider('Drow: Poison', 'On hit: 1d[4/6/8] poison damage per Imbue Dice scaling with Melee or Ranged power.');
    expect(r).toMatchObject({ diceNum: 1, diceSides: 8, damageType: 'Poison', diceMultiplier: 'imbueDie', scalingStat: 'higher_mr_p' });
  });

  it('returns null for non-damage imbue (Aligned Arrows)', () => {
    const r = parseImbueRider('AA: Aligned Arrows', 'Imbue Toggle: Your arrows bypass all alignment based damage reduction. Activation Cost: 20 spell points. Cooldown: 10 seconds.');
    expect(r).toBeNull();
  });

  it('parses 1d6 fire with Melee Power scaling', () => {
    const r = parseImbueRider('HM: Lighting Candle', 'Imbue Toggle: While you are centered, you enhance your attacks with Ki flame. dealing +1d6 Fire damage on hit, ... scale with Melee Power.');
    expect(r).toMatchObject({ diceNum: 1, diceSides: 6, damageType: 'Fire', scalingPct: 100, scalingStat: 'mp' });
  });

  it('parses Inquisitive Law on your Side — picks the "all other creatures" default clause', () => {
    // Conditional imbue: 1d10 per Imbue Die vs chaotic, 1d6 flat for
    // all others. Per-DPS general case uses the "all other creatures"
    // clause since fights aren't 100% chaotic targets.
    const r = parseImbueRider('Law on your side',
      'Imbue Toggle: Your Light and Heavy (non-repeating) Crossbow attacks deal 1d10 Law damage per Imbue Dice on hit to Chaotic creatures and 1d6 Law damage on hit to all other creatures, scaling with 200% Ranged Power.',
    );
    expect(r).toMatchObject({
      diceNum: 1, diceSides: 6, diceBonus: 0,
      damageType: 'Law',
      diceMultiplier: 'flat',
      scalingPct: 200, scalingStat: 'rp',
    });
  });
});
