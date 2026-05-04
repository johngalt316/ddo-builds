// Format a GearBuff (or shard buff record) as a single line of text.
// Used by tooltips and picker rows where we want a compact stat preview.

import type { GearBuff } from '@/types/build';
import type { DDOBuffBlock, DDOEffect, ItemBuffCatalog } from '@/types/ddoData';

/** A signed integer string with a leading `+` for non-negative values. */
function withSign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * Substitute the catalog's `displayText` placeholders with the buff's actual
 * parameters. The template uses %v1/%v2 (numeric values), %b1 (bonus type),
 * and %i1 (sub-target item). Numeric placeholders are signed (`+13`, `+12%`).
 * Returns the headline (text before the first colon) and an optional detail
 * (the lore that follows) so callers can render them with different weight.
 *
 * Falls back to the decoded-by-fields formatter when no catalog template
 * matches the buff's type.
 */
export function formatBuffFriendly(
  buff: GearBuff,
  catalog: ItemBuffCatalog,
): { headline: string; detail?: string } {
  const entry = catalog[buff.type];
  if (!entry?.displayText) return { headline: formatBuff(buff) };

  const filled = entry.displayText
    .replace(/%v1/g, buff.value1 !== undefined ? withSign(buff.value1) : '')
    .replace(/%v2/g, buff.value2 !== undefined ? withSign(buff.value2) : '')
    .replace(/%b1/g, buff.bonusType ?? '')
    .replace(/%i1/g, buff.item ?? buff.description1 ?? '');

  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const colon = filled.indexOf(':');
  if (colon < 0) return { headline: collapse(filled) };
  return {
    headline: collapse(filled.slice(0, colon)),
    detail:   collapse(filled.slice(colon + 1)) || undefined,
  };
}

export function formatBuff(b: GearBuff): string {
  const parts: string[] = [];

  if (b.value1 !== undefined) {
    const range = b.value2 !== undefined && b.value2 !== b.value1
      ? `${b.value1}-${b.value2}`
      : `${b.value1}`;
    parts.push(`+${range}`);
  }
  if (b.bonusType && b.bonusType !== 'Stacking') parts.push(b.bonusType);

  // Prefer the human-readable target ("Strength") over the raw type ("AbilityBonus").
  const subject = b.item ?? b.description1 ?? b.type;
  parts.push(subject);

  // If we used `item`, still surface the buff family so e.g. "+4 Insightful Strength
  // (AbilityBonus)" reads cleanly. Keep it short.
  if (b.item && b.type && b.type !== b.item && b.type !== 'AbilityBonus') {
    parts.push(`(${b.type})`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Format the full buff list as a multiline string for `title` attributes. */
export function formatBuffsAsTitle(buffs: GearBuff[]): string {
  if (buffs.length === 0) return '';
  return buffs.map(formatBuff).join('\n');
}

/** Format a single parsed `<Effect>` block as one human-readable line. Used
 *  for set-bonus tooltips. Unlike GearBuff, DDOEffect targets specific stat
 *  types (`types[]`) and may carry multiple amounts indexed by amountType. */
export function formatEffect(eff: DDOEffect): string {
  // Prefer the inline description if the XML supplied one — those are
  // already DDO-canonical wording.
  if (eff.description) return eff.description;

  const parts: string[] = [];
  const amount = eff.amount?.[0];
  if (amount !== undefined && amount !== 0) {
    parts.push(amount > 0 ? `+${amount}` : `${amount}`);
  }
  if (eff.bonus && eff.bonus !== 'Stacking') parts.push(eff.bonus);
  // Items are usually the specific target ("Strength") for a generic type
  // ("AbilityBonus"). Show them when present, else fall back to types[].
  const target = eff.items?.length ? eff.items.join(', ') : eff.types?.join('/');
  if (target) parts.push(target);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Format a tiered buff block (set-bonus tier) as `Npc: effect; effect; …`. */
export function formatBuffBlock(buff: DDOBuffBlock): string {
  const effects = (buff.effects ?? []).map(formatEffect).filter(Boolean);
  return effects.join(' · ');
}

/** Summarize a filigree's rare-tagged effects (e.g. "+2 MRR"). Returns
 *  undefined when the filigree has no rare effects. */
export function formatRareBonus(
  effects: ReadonlyArray<DDOEffect & { rare?: boolean }>,
): string | undefined {
  const rare = effects.filter(e => e.rare).map(formatEffect).filter(Boolean);
  return rare.length ? rare.join(', ') : undefined;
}

/**
 * Format a set's full tier list for tooltip display. `currentCount` is how
 * many pieces are equipped — tiers at or below that count are tagged ACTIVE.
 *
 * Prefers the canonical `<Description>` from each tier's <Buff> when it's
 * present (filigree XML uses friendly wording like "+3 Turn Undead Charges"
 * rather than the raw effect type name). Falls back to a decoded effect list
 * for set XMLs that omit the description.
 */
export function formatSetTiersAsTitle(
  setName: string,
  currentCount: number,
  buffs: DDOBuffBlock[],
): string {
  const lines: string[] = [setName];
  const sorted = [...buffs].sort((a, b) => a.equippedCount - b.equippedCount);
  for (const buff of sorted) {
    const active = buff.equippedCount <= currentCount ? ' ✓' : '';
    const body = (buff.description?.trim())
              || formatBuffBlock(buff)
              || '(no effects)';
    lines.push(`${buff.equippedCount} pieces${active}: ${body}`);
  }
  return lines.join('\n');
}
