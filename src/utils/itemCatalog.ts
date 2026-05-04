// Lazy loader for the per-slot item shards.
//
// `npm run import-items` writes one JSON file per equipment slot to
// `public/data/items/by-slot/<slot>.json`. We fetch on demand and cache
// in memory across the session so opening the picker stays snappy.
//
// The .item shards were generated using the canonical equipment-slot tags
// from DDOBuilderV2 (Weapon1, Weapon2, Ring, …). Build-side gear slots
// use a slightly different vocabulary (MainHand, OffHand, Ring1, Ring2).
// `slotToShardName` bridges the two.

import type { GearSlot, GearBuff, GearItem } from '@/types/build';

/** Slot names that have a corresponding by-slot shard JSON file. */
const SHARD_SLOTS: GearSlot[] = [
  'Helmet', 'Goggles', 'Necklace', 'Trinket', 'Cloak', 'Belt', 'Bracers',
  'Gloves', 'Boots', 'Armor', 'MainHand', 'OffHand', 'Quiver', 'Ring1',
];

/** Raw shape of an item in the by-slot shards (matches buildItemIndex.mjs output). */
export interface ItemRecord {
  name: string;
  icon: string;
  slots: string[];
  description?: string;
  dropLocation?: string;
  minLevel?: number;
  maxLevel?: number;
  weapon?: string;
  weaponDamage?: number;
  baseDice?: { number: number; sides: number };
  criticalMultiplier?: number;
  criticalThreatRange?: number;
  attackModifier?: string;
  damageModifier?: string;
  drBypass?: string[];
  material?: string;
  setBonus?: string;
  armor?: { type: string; ac?: number; mdb?: number; acp?: number; asf?: number };
  buffs?: {
    type: string;
    value1?: number;
    value2?: number;
    bonusType?: string;
    item?: string;
    description?: string;
  }[];
  augmentSlots?: { type: string; description?: string }[];
}

/**
 * Map a GearSlot (build-side) to the by-slot shard filename. Returns null
 * for slots with no shard (none currently — defensive default).
 */
export function slotToShardName(slot: GearSlot): string | null {
  switch (slot) {
    case 'MainHand': return 'Weapon1';
    case 'OffHand':  return 'Weapon2';
    case 'Ring1':
    case 'Ring2':    return 'Ring';
    case 'Arrow':    return null;   // not preprocessed (no Arrow.json shard)
    default:         return slot;   // Helmet/Goggles/.../Quiver pass through
  }
}

const cache = new Map<string, Promise<ItemRecord[]>>();

/**
 * Load the item shard for a given gear slot. Returns the raw records
 * (cached after first load).
 */
export function loadItemsForSlot(slot: GearSlot): Promise<ItemRecord[]> {
  const shard = slotToShardName(slot);
  if (!shard) return Promise.resolve([]);

  const existing = cache.get(shard);
  if (existing) return existing;

  const p = fetch(`/data/items/by-slot/${shard}.json`)
    .then(r => r.ok ? r.json() as Promise<ItemRecord[]> : [])
    .catch(() => []);
  cache.set(shard, p);
  return p;
}

/**
 * Load every per-slot shard in parallel (cached). Used by FindGearDialog
 * for cross-slot search. The full catalog is ~8 MB raw / ~1.5 MB gzipped;
 * worth it once the user opens the cross-slot search the first time.
 */
export async function loadAllItems(): Promise<ItemRecord[]> {
  const shards = await Promise.all(SHARD_SLOTS.map(loadItemsForSlot));
  // Items can appear in multiple shards (e.g. a longsword in Weapon1 AND
  // Weapon2). Dedupe by name — the records are byte-identical across
  // shards since they came from the same .item file.
  const seen = new Set<string>();
  const out: ItemRecord[] = [];
  for (const shard of shards) {
    for (const item of shard) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      out.push(item);
    }
  }
  return out;
}

/** Convert a catalog ItemRecord into a GearItem to store in the build. */
export function itemRecordToGearItem(record: ItemRecord, slot: GearSlot): GearItem {
  const buffs: GearBuff[] = (record.buffs ?? []).map(b => ({
    type: b.type,
    value1: b.value1,
    value2: b.value2,
    bonusType: b.bonusType,
    item: b.item,
    description1: b.description,
  }));
  // Empty augment slots from the catalog (user fills them via the picker).
  const augmentSlots = (record.augmentSlots ?? []).map(a => ({
    slotType: a.type,
  }));
  return {
    slot,
    name: record.name,
    icon: record.icon,
    description: record.description,
    dropLocation: record.dropLocation,
    minLevel: record.minLevel,
    material: record.material,
    setBonus: record.setBonus,
    buffs,
    augmentSlots: augmentSlots.length > 0 ? augmentSlots : undefined,
  };
}
