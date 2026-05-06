#!/usr/bin/env node
// One-shot migration: walk every tree XML in public/data/EnhancementTrees
// and bake the runtime-derived clickie metadata (cooldown, category,
// charge flags) into structured child tags so the engine can drop its
// description-regex fallbacks.
//
// Idempotent — items that already carry the new tags are left alone.
//
// Run: node scripts/bakeClickieMetadata.mjs
//
// The rewrite is line-based and conservative:
//   • Inserts after `<Clickie/>` (the only line we anchor on).
//   • Indents new tags to match existing tree-item children.
//   • Skips items without `<Clickie/>` so non-clickie passives stay
//     untouched.
//   • Preserves existing tags — never overwrites a hand-edited value.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TREES_DIR = resolve(HERE, '../public/data/EnhancementTrees');

// ── Rule helpers (mirror src/engine/dps/abilities.ts) ───────────────────

function parseCooldownSeconds(description) {
  if (!description) return undefined;
  const colon = description.match(/Cooldown:\s*([\d.]+)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/i);
  if (colon) return /^m/i.test(colon[2]) ? parseFloat(colon[1]) * 60 : parseFloat(colon[1]);
  const inline = description.match(/([\d.]+)\s*(seconds?|secs?|s|minutes?|mins?|m)\s+cooldown/i);
  if (inline) return /^m/i.test(inline[2]) ? parseFloat(inline[1]) * 60 : parseFloat(inline[1]);
  return undefined;
}

function classifyClickie(description) {
  const desc = (description || '').toLowerCase();
  if (!desc) return null;
  const hasDamage = /\bdamage\b|\d+d\d+|deal[s]? \w+ damage|\bnecrotic\b|\beldritch\b/.test(desc)
                 && !/^passive[: ]/.test(desc);
  const hasHeal   = /\b(heal|cure|restore[s]? \d|positive energy|hit points per caster level)\b/.test(desc);
  const hasCC     = /\b(stun|paralyze|hold|daze|fear|sleep|charm|incapacit|knockdown|trip|petrif|flat-?footed|helpless)\w*/.test(desc);
  const hasDebuff = /\b(vulnerab|fortification reduc|threat|hate|more likely to attack|expos|reduces? .* (?:armor|prr|saving|ac|dr))\w*/.test(desc);
  const hasDuration = /\bfor (?:up to )?\d+(?:\.\d+)? (?:second|minute|turn)s?\b|action boost/.test(desc);

  if (hasDamage)   return { category: 'damage',  placeholderDamage: true };
  if (hasHeal)     return { category: 'heal',    placeholderDamage: true };
  if (hasCC)       return { category: 'cc',      placeholderDamage: false };
  if (hasDebuff)   return { category: 'debuff',  placeholderDamage: false };
  if (hasDuration) return { category: 'boost',   placeholderDamage: false };
  if (/\b(teleport|jaunt|misty step|dimension door|invisibil|displacement|summon|find familiar|conjure|stoneskin|mage armor|spell resistance|deathward|death ward|true seeing|freedom of movement|haste|expeditious)\w*/.test(desc)) {
    return { category: 'utility', placeholderDamage: false };
  }
  return null;     // passive — no annotation needed (engine filters it out anyway)
}

// ── XML rewrite ─────────────────────────────────────────────────────────

function bakeFile(path) {
  const original = readFileSync(path, 'utf8');
  const lines = original.split('\n');
  const out = [];
  let changed = 0;

  // Track current EnhancementTreeItem state as we walk lines.
  let inItem = false;
  let itemBuffer = [];          // raw lines of the current item
  let itemDescription = '';
  let itemName = '';
  let itemHasClickie = false;
  let itemHasCooldown = false;
  let itemHasCategory = false;
  let itemHasActionBoostFlag = false;
  let itemHasReaperFlag = false;
  let itemHasPlaceholder = false;

  function reset() {
    itemBuffer = [];
    itemDescription = '';
    itemName = '';
    itemHasClickie = false;
    itemHasCooldown = false;
    itemHasCategory = false;
    itemHasActionBoostFlag = false;
    itemHasReaperFlag = false;
    itemHasPlaceholder = false;
  }

  for (const line of lines) {
    if (!inItem) {
      out.push(line);
      if (/<EnhancementTreeItem>\s*$/.test(line)) {
        inItem = true;
        reset();
      }
      continue;
    }

    // Inside an item — buffer; we'll emit at </EnhancementTreeItem>.
    itemBuffer.push(line);

    // Single-line <Description>…</Description>.
    const descSingle = line.match(/<Description>([\s\S]*?)<\/Description>/);
    if (descSingle) itemDescription = descSingle[1];
    else if (/<Description>/.test(line)) {
      // Multi-line description — accumulate until closing tag.
      itemDescription = line.replace(/.*<Description>/, '');
    } else if (itemDescription !== '' && /<\/Description>/.test(line)) {
      itemDescription += ' ' + line.replace(/<\/Description>.*/, '');
    } else if (itemDescription !== '' && !/<\w+>/.test(line)) {
      itemDescription += ' ' + line.trim();
    }

    const nameMatch = line.match(/<Name>([^<]+)<\/Name>/);
    if (nameMatch && !itemName) itemName = nameMatch[1];

    if (/<Clickie\s*\/>/.test(line))                  itemHasClickie = true;
    if (/<Cooldown[\s>]/.test(line))                  itemHasCooldown = true;
    if (/<Category>/.test(line))                      itemHasCategory = true;
    if (/<UsesActionBoostCharge\s*\/>/.test(line))    itemHasActionBoostFlag = true;
    if (/<UsesReaperCharge\s*\/>/.test(line))         itemHasReaperFlag = true;
    if (/<PlaceholderDamage\s*\/>/.test(line))        itemHasPlaceholder = true;

    if (/<\/EnhancementTreeItem>/.test(line)) {
      inItem = false;

      if (!itemHasClickie) {
        // Non-clickie passive — nothing to bake.
        out.push(...itemBuffer);
        itemBuffer = [];
        continue;
      }

      // Compute additions.
      const additions = [];
      const indent = '         ';     // matches existing tree-item child indent

      if (!itemHasCooldown) {
        const cd = parseCooldownSeconds(itemDescription);
        if (cd !== undefined) additions.push(`${indent}<Cooldown>${cd}</Cooldown>`);
      }

      if (!itemHasCategory) {
        const c = classifyClickie(itemDescription);
        if (c) {
          additions.push(`${indent}<Category>${c.category}</Category>`);
          if (c.placeholderDamage && !itemHasPlaceholder) {
            additions.push(`${indent}<PlaceholderDamage/>`);
          }
        }
      }

      if (!itemHasActionBoostFlag &&
          /\baction boost\b/i.test(itemName + ' ' + itemDescription)) {
        additions.push(`${indent}<UsesActionBoostCharge/>`);
      }

      if (additions.length === 0) {
        out.push(...itemBuffer);
        itemBuffer = [];
        continue;
      }

      // Insert additions just before the closing </EnhancementTreeItem>.
      const closeIdx = itemBuffer.length - 1;
      const merged = [
        ...itemBuffer.slice(0, closeIdx),
        ...additions,
        itemBuffer[closeIdx],
      ];
      out.push(...merged);
      changed += additions.length;
      itemBuffer = [];
    }
  }

  if (changed > 0) {
    writeFileSync(path, out.join('\n'), 'utf8');
  }
  return changed;
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const files = readdirSync(TREES_DIR).filter(f => f.endsWith('.tree.xml'));
  let totalChanges = 0;
  let touchedFiles = 0;
  for (const f of files) {
    const path = resolve(TREES_DIR, f);
    const n = bakeFile(path);
    if (n > 0) {
      console.log(`  ${f.padEnd(60)} +${n} tags`);
      touchedFiles++;
      totalChanges += n;
    }
  }
  console.log(`\nDone. ${totalChanges} tags inserted across ${touchedFiles} files.`);
}

main();
