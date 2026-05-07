// Phase 6.4.3 — Proc catalog tests.

import { describe, it, expect } from 'vitest';
import {
  MAGICAL_AMBUSH,
  DRIPPING_WITH_MAGMA,
  WOEFUL_ENERGY,
  WOEFUL_ECHOES,
  REVEL_IN_BLOOD_MAGIC,
  expandActiveProcs,
} from '@/engine/dps/procs';
import type { Build, GearSet, GearItem, GearBuff, ItemAugmentSlot, EnhancementSelection } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';

// Minimal build factory — only the fields procs actually inspect.
function build(opts: {
  classes?: { classId: string; levels: number }[];
  gearSets?: GearSet[];
  activeGearSet?: string;
  destinyEnhancements?: EnhancementSelection[];
} = {}): Build {
  return {
    classes:             opts.classes             ?? [],
    gearSets:            opts.gearSets            ?? [],
    activeGearSet:       opts.activeGearSet       ?? '',
    enhancementSets:     [{
      name: 'Default',
      enhancements:             [],
      destinyEnhancements:      opts.destinyEnhancements ?? [],
      reaperEnhancements:       [],
      selectedEnhancementTrees: [],
    }],
    activeEnhancementSet: 'Default',
  } as unknown as Build;
}

function gearItem(opts: { buffs?: GearBuff[]; augments?: ItemAugmentSlot[] } = {}): GearItem {
  return {
    slot: 'Helmet', name: '', icon: '',
    buffs: opts.buffs ?? [],
    augmentSlots: opts.augments,
  };
}

function gearSet(items: GearItem[], name = 'Standard'): GearSet {
  return { name, items };
}

// Procs don't read EngineResult yet — the typed dummy keeps tests honest
// against the real interface so we'll catch it if a proc reaches in later.
const ENGINE = {} as unknown as EngineResult;

describe('MAGICAL_AMBUSH.isActive', () => {
  it('true with Arcane Trickster level 8+', () => {
    expect(MAGICAL_AMBUSH.isActive(build({ classes: [{ classId: 'arcane_trickster', levels: 8 }] }),  ENGINE)).toBe(true);
    expect(MAGICAL_AMBUSH.isActive(build({ classes: [{ classId: 'arcane_trickster', levels: 18 }] }), ENGINE)).toBe(true);
  });
  it('false below AT 8', () => {
    expect(MAGICAL_AMBUSH.isActive(build({ classes: [{ classId: 'arcane_trickster', levels: 7 }] }), ENGINE)).toBe(false);
  });
  it('false without AT', () => {
    expect(MAGICAL_AMBUSH.isActive(build({ classes: [{ classId: 'wizard', levels: 20 }] }), ENGINE)).toBe(false);
  });
});

describe('MAGICAL_AMBUSH.toComponents', () => {
  const at = build({ classes: [{ classId: 'arcane_trickster', levels: 18 }] });
  const ctx38 = { sneakAttackDice: 38 };

  it('emits one component per active spell, sized to projectileCount', () => {
    const comps = MAGICAL_AMBUSH.toComponents(at, ENGINE, ctx38, [
      { name: 'Magic Missile',   casterLevel: 20 },
      { name: 'Arcane Initiate', casterLevel: 20 },
      { name: 'Force Missiles',  casterLevel: 12 },
      { name: 'Scorching Ray',   casterLevel: 11 },
      { name: 'Fireball',        casterLevel: 20 },
    ]);
    // Magical Ambush is per-MISSILE: each component carries qty=1 and
    // trigger.kind='per-hit'. The engine multiplies cpm by the spell's
    // projectileCount at trigger resolution, so a 5-missile MM cast
    // yields 5 triggers/cast. avg = sneakDice × d6 = 38 × 3.5 = 133.
    expect(comps).toHaveLength(5);
    expect(comps[0]).toMatchObject({
      label: 'Magical Ambush (Magic Missile)',
      trigger: { kind: 'per-hit', spell: 'Magic Missile' },
      qtyPerTrigger: 1, avgDicePerHit: 133,
      damageType: 'Force', scaleProfile: 'sneak',     // baseline: 50% Force SP
    });
    // All five spell instances emit qty=1 components (per-missile model);
    // the projectile-count multiplier is applied via componentTriggersPerMinute
    // — the per-spell missile counts (5/10/4/3/1) used to live here, but
    // they're now expressed through that path instead of qtyPerTrigger.
    for (const c of comps.slice(1)) {
      expect(c).toMatchObject({ qtyPerTrigger: 1, avgDicePerHit: 133 });
    }
  });

  it("Master of Trickery capstone bumps scale profile to 'spell' (full Force SP)", () => {
    const withCapstone = build({
      classes: [{ classId: 'arcane_trickster', levels: 20 }],
      destinyEnhancements: [],
    });
    // Inject the capstone into the build's enhancement set.
    const sets = (withCapstone as unknown as { enhancementSets: { name: string; enhancements: { treeId: string; enhancements: { enhancementId: string; tier: number; rank: number }[] }[] }[] }).enhancementSets;
    sets[0]!.enhancements.push({
      treeId: 'Arcane Trickster',
      enhancements: [{ enhancementId: 'ArcaneTricksterCore6', tier: 0, rank: 1 }],
    });
    const comps = MAGICAL_AMBUSH.toComponents(withCapstone, ENGINE, ctx38,
      [{ name: 'Magic Missile', casterLevel: 20 }]);
    expect(comps[0]?.scaleProfile).toBe('spell');
  });

  it('avgDicePerHit scales linearly with sneak dice', () => {
    const a = MAGICAL_AMBUSH.toComponents(at, ENGINE, { sneakAttackDice: 10 },
      [{ name: 'Magic Missile', casterLevel: 9 }]);
    expect(a[0]?.avgDicePerHit).toBe(35);    // 10 × 3.5
  });

  it('emits nothing when sneak dice is 0', () => {
    const comps = MAGICAL_AMBUSH.toComponents(at, ENGINE, { sneakAttackDice: 0 },
      [{ name: 'Magic Missile', casterLevel: 9 }]);
    expect(comps).toEqual([]);
  });

  it('emits nothing when no active spells', () => {
    expect(MAGICAL_AMBUSH.toComponents(at, ENGINE, ctx38, [])).toEqual([]);
  });

  it('sets debuff flags matching the spreadsheet', () => {
    const [c] = MAGICAL_AMBUSH.toComponents(at, ENGINE, ctx38,
      [{ name: 'Magic Missile', casterLevel: 9 }]);
    expect(c).toMatchObject({ useGenericVuln: true, useMRR: true });
    expect(c?.useSonicVuln).toBeUndefined();
  });
});

describe('expandActiveProcs', () => {
  it('routes through isActive — AT 18 build with sneak dice gets ambush components', () => {
    const comps = expandActiveProcs(
      build({ classes: [{ classId: 'arcane_trickster', levels: 18 }] }),
      ENGINE,
      { sneakAttackDice: 38 },
      [{ name: 'Magic Missile', casterLevel: 9 }],
    );
    expect(comps).toHaveLength(1);
    expect(comps[0]?.label).toBe('Magical Ambush (Magic Missile)');
  });

  it('non-AT build with no item buffs emits nothing', () => {
    const comps = expandActiveProcs(
      build({ classes: [{ classId: 'wizard', levels: 20 }] }),
      ENGINE,
      { sneakAttackDice: 5 },
      [{ name: 'Magic Missile', casterLevel: 9 }],
    );
    expect(comps).toEqual([]);
  });

  it('stacks Ambush + global per-cast procs when both are active', () => {
    const buildWithEverything = build({
      classes: [{ classId: 'arcane_trickster', levels: 18 }],
      gearSets: [gearSet([
        gearItem({ buffs: [{ type: 'Dripping with Magma' }] }),
        gearItem({ augments: [
          { slotType: 'Woeful', selectedAugment: 'Woeful Energy (Legendary)' },
          { slotType: 'Woeful', selectedAugment: 'Woeful Echoes (Legendary)' },
        ] }),
      ])],
      activeGearSet: 'Standard',
    });
    const comps = expandActiveProcs(buildWithEverything, ENGINE,
      { sneakAttackDice: 38 },
      [{ name: 'Magic Missile', casterLevel: 9 }],
    );
    const labels = comps.map(c => c.label);
    expect(labels).toEqual([
      'Magical Ambush (Magic Missile)',
      'Dripping with Magma',
      'Woeful Energy',
      'Woeful Echoes',
    ]);
  });
});

describe('global per-cast procs (50d20 / 50d10 globals)', () => {
  it('Dripping with Magma fires when an item carries the buff', () => {
    const b = build({
      gearSets: [gearSet([gearItem({ buffs: [{ type: 'Dripping with Magma' }] })])],
      activeGearSet: 'Standard',
    });
    expect(DRIPPING_WITH_MAGMA.isActive(b, ENGINE)).toBe(true);
    const [c] = DRIPPING_WITH_MAGMA.toComponents(b, ENGINE, { sneakAttackDice: 0 }, []);
    expect(c).toMatchObject({
      trigger: { kind: 'per-cast' },
      qtyPerTrigger: 1,
      avgDicePerHit: 525,            // 50d20 avg = 50 × 10.5
      damageType: 'Fire',
      scaleProfile: 'proc',
      useGenericVuln: true,
      useMRR: true,
    });
    expect(c?.useSonicVuln).toBeUndefined();
  });

  it('Dripping with Magma is inactive without the item buff', () => {
    expect(DRIPPING_WITH_MAGMA.isActive(build({ gearSets: [gearSet([gearItem()])] }), ENGINE))
      .toBe(false);
  });

  it('Woeful Energy fires when the augment is slotted', () => {
    const b = build({
      gearSets: [gearSet([gearItem({ augments: [
        { slotType: 'Woeful Slot (Weapon)', selectedAugment: 'Woeful Energy (Legendary)' },
      ] })])],
      activeGearSet: 'Standard',
    });
    expect(WOEFUL_ENERGY.isActive(b, ENGINE)).toBe(true);
    const [c] = WOEFUL_ENERGY.toComponents(b, ENGINE, { sneakAttackDice: 0 }, []);
    expect(c).toMatchObject({ damageType: 'Force', avgDicePerHit: 525 });
  });

  it('Woeful Echoes flags Sonic vulnerability', () => {
    const b = build({
      gearSets: [gearSet([gearItem({ augments: [
        { slotType: 'Woeful Slot (Weapon)', selectedAugment: 'Woeful Echoes (Legendary)' },
      ] })])],
      activeGearSet: 'Standard',
    });
    expect(WOEFUL_ECHOES.isActive(b, ENGINE)).toBe(true);
    const [c] = WOEFUL_ECHOES.toComponents(b, ENGINE, { sneakAttackDice: 0 }, []);
    expect(c).toMatchObject({ damageType: 'Sonic', useSonicVuln: true });
  });

  it('Revel in Blood (Magic) — 2d6 Force, item-buff sourced', () => {
    const b = build({
      gearSets: [gearSet([gearItem({ buffs: [{ type: 'Revel in Blood (Magic)' }] })])],
      activeGearSet: 'Standard',
    });
    expect(REVEL_IN_BLOOD_MAGIC.isActive(b, ENGINE)).toBe(true);
    const [c] = REVEL_IN_BLOOD_MAGIC.toComponents(b, ENGINE, { sneakAttackDice: 0 }, []);
    expect(c).toMatchObject({
      damageType: 'Force',
      avgDicePerHit: 7,             // 2d6 avg = 2 × 3.5
      scaleProfile: 'proc',
    });
    // Spreadsheet flags: ignores generic vuln, sonic vuln, MRR.
    expect(c?.useGenericVuln).toBeUndefined();
    expect(c?.useSonicVuln).toBeUndefined();
    expect(c?.useMRR).toBeUndefined();
  });

  it('augment-sourced procs respect activeGearSet (skip non-active sets)', () => {
    const b = build({
      gearSets: [
        gearSet([gearItem({ augments: [
          { slotType: 'X', selectedAugment: 'Woeful Energy (Legendary)' },
        ] })], 'OldSet'),
        gearSet([gearItem()], 'NewSet'),
      ],
      activeGearSet: 'NewSet',
    });
    expect(WOEFUL_ENERGY.isActive(b, ENGINE)).toBe(false);
  });
});
