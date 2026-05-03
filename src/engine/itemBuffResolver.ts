// Item buff resolver — turns an item's buff *reference* into concrete Effect[].
//
// Items in .DDOBuild files (and in the items preprocess output) carry a
// flat reference schema:
//
//   { type: "AbilityBonus", value1: 4, bonusType: "Insight", item: "Strength" }
//
// This is a reference to the canonical "AbilityBonus" template in
// ItemBuffs.xml (preprocessed to public/data/items/itemBuffs.json).
//
// The catalog stores templated effects with placeholder values:
//   - bonus: "Not Set"    → fill with itemBuff.bonusType
//   - amount: [0]         → fill with [itemBuff.value1, value2?]
//   - items: ["Unknown"]  → fill with [itemBuff.item]
//
// Substitution rule we adopt: **only override when the item buff explicitly
// provides a value.** Catalog entries that hardcode meaningful defaults
// (Vorpal: amount=[0.5], items=["All"]) are preserved when the item buff
// doesn't supply matching parameters.

import type { GearBuff } from '@/types/build';
import type { DDOEffect, ItemBuffCatalog, ItemBuffCatalogEntry } from '@/types/ddoData';

/**
 * Instantiate a catalog buff template with the parameters from an item's
 * buff reference. Returns the concrete Effect[] this buff produces.
 *
 * Returns an empty array if the catalog has no template for this buff
 * type — the caller should record that as an unmatched-item-buff diagnostic.
 */
export function instantiateItemBuff(
  entry: ItemBuffCatalogEntry,
  itemBuff: GearBuff,
): DDOEffect[] {
  return entry.effects.map(effect => {
    const out: DDOEffect = { ...effect };

    // Bonus type override
    if (itemBuff.bonusType) {
      out.bonus = itemBuff.bonusType;
    }

    // Numeric value override — value1 (and optionally value2) become the amount table
    if (itemBuff.value1 !== undefined) {
      out.amount = itemBuff.value2 !== undefined
        ? [itemBuff.value1, itemBuff.value2]
        : [itemBuff.value1];
    }

    // Sub-target override (skill name, ability name, weapon group, etc.)
    if (itemBuff.item) {
      out.items = [itemBuff.item];
    }

    return out;
  });
}

/**
 * Look up a buff in the catalog by type. Case-sensitive match (catalog
 * keys preserve the upstream casing).
 */
export function lookupItemBuff(
  catalog: ItemBuffCatalog,
  type: string,
): ItemBuffCatalogEntry | undefined {
  return catalog[type];
}
