// Universal <Effect> / <Buff> / <Requirements> parsers.
//
// Used by every XML-loaded data type that carries effects: feats, items,
// set bonuses, stances, spells, augments, filigrees. Phase 2's engine
// consumes the resulting DDOEffect[] arrays directly — no per-XML-type
// custom parsing past this layer.
//
// Schema reference: DDOBuilderV2/DDOBuilder/Effect.cpp + Bonus.cpp
import type {
  DDOEffect,
  DDOBuffBlock,
  DDORequirement,
  DDORequirements,
  EffectAmountType,
} from '@/types/ddoData';
import { KNOWN_EFFECT_TYPES } from '@/types/effectTypes';
import { CUSTOM_EFFECT_TYPES } from '@/types/extendedEffectTypes';

// ── DOM helpers (work for both DOM and Element parents) ──────────────────

function directChildren(parent: Element, tag: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n && n.nodeType === 1 && (n as Element).tagName === tag) {
      out.push(n as Element);
    }
  }
  return out;
}

function firstChild(parent: Element, tag: string): Element | null {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n && n.nodeType === 1 && (n as Element).tagName === tag) {
      return n as Element;
    }
  }
  return null;
}

function textOf(parent: Element, tag: string): string {
  return firstChild(parent, tag)?.textContent?.trim() ?? '';
}

function numOf(parent: Element, tag: string): number | undefined {
  const el = firstChild(parent, tag);
  if (!el) return undefined;
  const v = parseFloat(el.textContent?.trim() ?? '');
  return Number.isFinite(v) ? v : undefined;
}

// ── <Requirements> parser ─────────────────────────────────────────────────

export function parseRequirement(el: Element): DDORequirement {
  const value = numOf(el, 'Value');
  return {
    type: textOf(el, 'Type'),
    item: textOf(el, 'Item') || undefined,
    value,
  };
}

/** Parse a <Requirements> block, or an empty result if `block` is null. */
export function parseRequirements(block: Element | null): DDORequirements {
  if (!block) return { allOf: [], oneOf: [], noneOf: [] };

  const allOf: DDORequirement[] = directChildren(block, 'Requirement').map(parseRequirement);

  const oneOf: DDORequirement[][] = directChildren(block, 'RequiresOneOf').map(group =>
    directChildren(group, 'Requirement').map(parseRequirement),
  );

  const noneOf: DDORequirement[][] = directChildren(block, 'RequiresNoneOf').map(group =>
    directChildren(group, 'Requirement').map(parseRequirement),
  );

  return { allOf, oneOf, noneOf };
}

// ── <Effect> parser ───────────────────────────────────────────────────────

const KNOWN_AMOUNT_TYPES: ReadonlySet<string> = new Set([
  'Unknown', 'NotNeeded', 'Simple', 'Stacks',
  'TotalLevel', 'BaseClassLevel', 'ClassLevel', 'ClassCasterLevel',
  'APCount', 'AbilityValue', 'AbilityTotal', 'AbilityTotalIndex',
  'AbilityMod', 'HalfAbilityMod', 'ThirdAbilityMod',
  'Slider', 'SliderValue', 'SliderValueLookup',
  'FeatCount', 'SetBonusCount', 'SLA', 'SpellInfo',
  'Dice', 'CriticalDice', 'BAB',
]);

function parseAmountText(raw: string): number[] {
  if (!raw) return [];
  return raw.trim().split(/\s+/)
    .map(s => parseFloat(s))
    .filter(n => Number.isFinite(n));
}

export function parseEffect(el: Element): DDOEffect {
  // <Type> may appear multiple times — capture all.
  const types = directChildren(el, 'Type')
    .map(t => t.textContent?.trim() ?? '')
    .filter(Boolean);

  // <Item> may appear multiple times (e.g. SkillBonus targeting multiple skills)
  const items = directChildren(el, 'Item')
    .map(t => t.textContent?.trim() ?? '')
    .filter(Boolean);

  const aTypeRaw = textOf(el, 'AType');
  const amountType: EffectAmountType | undefined = KNOWN_AMOUNT_TYPES.has(aTypeRaw)
    ? (aTypeRaw as EffectAmountType)
    : undefined;

  const amountEl = firstChild(el, 'Amount');
  const amount = amountEl ? parseAmountText(amountEl.textContent ?? '') : [];

  // Some XMLs use <Value1>..<Value4> instead of (or alongside) <Amount>
  const values: number[] = [];
  for (const k of ['Value1', 'Value2', 'Value3', 'Value4'] as const) {
    const v = numOf(el, k);
    if (v !== undefined) values.push(v);
  }

  const reqBlock = firstChild(el, 'Requirements');

  const displayName = textOf(el, 'DisplayName');
  const bonus = textOf(el, 'Bonus');
  const description = textOf(el, 'Description');
  const isPercent = firstChild(el, 'Percent') !== null;
  const isApplyAsItemEffect = firstChild(el, 'ApplyAsItemEffect') !== null;
  const rankRaw = textOf(el, 'Rank');
  const minRank = rankRaw ? parseInt(rankRaw, 10) : undefined;
  const stackSource = textOf(el, 'StackSource');

  return {
    displayName: displayName || undefined,
    types,
    bonus: bonus || undefined,
    amountType,
    amount,
    items,
    requirements: parseRequirements(reqBlock),
    values,
    description: description || undefined,
    ...(isPercent && { isPercent: true }),
    ...(isApplyAsItemEffect && { isApplyAsItemEffect: true }),
    ...(minRank !== undefined && Number.isFinite(minRank) && { minRank }),
    ...(stackSource && { stackSource }),
  };
}

/** Parse all <Effect> direct children of `parent` into a typed array. */
export function parseEffectsIn(parent: Element): DDOEffect[] {
  return directChildren(parent, 'Effect').map(parseEffect);
}

// ── <Buff> parser (used by items, set bonuses, clickies, spells) ─────────

export function parseBuff(el: Element): DDOBuffBlock {
  return {
    equippedCount: numOf(el, 'EquippedCount') ?? 0,
    description: textOf(el, 'Description'),
    effects: parseEffectsIn(el),
  };
}

/** Parse all <Buff> direct children of `parent`. */
export function parseBuffsIn(parent: Element): DDOBuffBlock[] {
  return directChildren(parent, 'Buff').map(parseBuff);
}

// ── Diagnostic — flag effect types we don't recognize ────────────────────
// Useful in tests + during development to catch new effect types added
// upstream. Returns the set of unknown type strings encountered.

export function findUnknownEffectTypes(effects: DDOEffect[]): Set<string> {
  const unknown = new Set<string>();
  for (const e of effects) {
    for (const t of e.types) {
      if (KNOWN_EFFECT_TYPES.has(t)) continue;
      if ((CUSTOM_EFFECT_TYPES as readonly string[]).includes(t)) continue;
      unknown.add(t);
    }
  }
  return unknown;
}
