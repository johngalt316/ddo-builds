#!/usr/bin/env node
//
// applySpellCooldowns.mjs — merges manual spell-cooldown values into
// public/data/Spells.xml.
//
// The upstream DDOBuilderV2 / wiki XML never carries <Cooldown> on damaging
// <Spell> entries — cooldowns only show up in description prose. This
// script keeps cooldowns in scripts/spell-cooldowns.json (the source of
// truth) and idempotently injects them into Spells.xml.
//
// Workflow:
//   • Edit scripts/spell-cooldowns.json to add or change a cooldown.
//   • Run `node scripts/applySpellCooldowns.mjs`.
//   • The script rewrites Spells.xml with <Cooldown>N</Cooldown> children
//     placed just before the closing </Spell> tag of each matched spell.
//
// Idempotent: re-running won't duplicate elements. Safe after upstream
// data refreshes — pull the new Spells.xml, then re-run this script to
// reapply cooldowns. Tracked in docs/DATA_PATCHES.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE      = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(HERE, '..');
const XML_PATH  = resolve(ROOT, 'public/data/Spells.xml');
const JSON_PATH = resolve(HERE, 'spell-cooldowns.json');

function loadCooldowns() {
  const raw = readFileSync(JSON_PATH, 'utf8');
  const json = JSON.parse(raw);
  if (!json.cooldowns || typeof json.cooldowns !== 'object') {
    throw new Error(`Expected { "cooldowns": { "<Spell Name>": <seconds>, ... } } in ${JSON_PATH}`);
  }
  return json.cooldowns;
}

/**
 * Iterate every <Spell>…</Spell> block in the XML. Returns the spell name
 * (read from a direct-child <Name> element) and a callback that splices a
 * replacement block back into the source string.
 */
function* eachSpellBlock(xml) {
  const openRe = /<Spell>/g;
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    const start = m.index;
    const closeIdx = xml.indexOf('</Spell>', start);
    if (closeIdx < 0) break;
    const end = closeIdx + '</Spell>'.length;
    const block = xml.slice(start, end);
    // Direct-child Name (avoid nested matches in <DC><Name>…)
    // Look for the first <Name>X</Name> line — for <Spell> blocks, this is
    // the spell's own name on the second line.
    const nameMatch = block.match(/<Spell>\s*<Name>([^<]+)<\/Name>/);
    if (!nameMatch) continue;
    yield {
      name: nameMatch[1].trim(),
      start,
      end,
      block,
    };
  }
}

/**
 * Inject or replace a <Cooldown> element directly inside a <Spell>…</Spell>
 * block. Mirrors the indentation of the existing closing tag for tidy diffs.
 */
function rewriteBlockWithCooldown(block, seconds) {
  // Already has a <Cooldown>? Replace its value.
  const existing = block.match(/<Cooldown>[\d.]+<\/Cooldown>/);
  if (existing) {
    return block.replace(existing[0], `<Cooldown>${seconds}</Cooldown>`);
  }
  // Otherwise insert before </Spell>, copying the </Spell>'s leading indent.
  const closeMatch = block.match(/(\n[ \t]*)<\/Spell>$/);
  const indent = closeMatch ? closeMatch[1] : '\n  ';
  return block.replace(/<\/Spell>$/, `${indent.replace(/^\n/, '')}<Cooldown>${seconds}</Cooldown>${indent}</Spell>`);
}

function main() {
  const cooldowns = loadCooldowns();
  const requested = new Map(Object.entries(cooldowns));
  const original = readFileSync(XML_PATH, 'utf8');

  // We rewrite blocks back into the source from RIGHT to LEFT so earlier
  // offsets stay valid after each edit.
  const blocks = [...eachSpellBlock(original)];
  let xml = original;
  let updated = 0;
  let unchanged = 0;
  const matched = new Set();

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!requested.has(b.name)) continue;
    matched.add(b.name);
    const seconds = requested.get(b.name);
    const rewritten = rewriteBlockWithCooldown(b.block, seconds);
    if (rewritten === b.block) { unchanged++; continue; }
    xml = xml.slice(0, b.start) + rewritten + xml.slice(b.end);
    updated++;
  }

  if (xml !== original) {
    writeFileSync(XML_PATH, xml, 'utf8');
  }

  const missing = [...requested.keys()].filter(n => !matched.has(n));
  console.log(`Spell cooldowns merged: ${updated} updated, ${unchanged} already current.`);
  if (missing.length > 0) {
    console.warn(`⚠ ${missing.length} spell name(s) in ${JSON_PATH} not found in Spells.xml:`);
    for (const n of missing) console.warn(`  - ${n}`);
  }
}

main();
