#!/usr/bin/env node
//
// scanSpellCooldowns.mjs — extracts every damaging spell from Spells.xml
// along with any cooldown hint mined out of its description, so we can
// quickly review what's in the data and what needs manual values.
//
// Output: JSON to stdout with one entry per damaging spell:
//   {
//     "<Spell Name>": {
//       "school":             "Evocation",
//       "explicitCooldown":   2,        // null if not mentioned
//       "descriptionSnippet": "...Cooldown: 2 seconds..."
//     }
//   }
//
// Use this to seed scripts/spell-cooldowns.json without manually paging
// through Spells.xml.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE     = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(HERE, '..');
const XML_PATH = resolve(ROOT, 'public/data/Spells.xml');

function readBetween(block, openTag, closeTag) {
  const i = block.indexOf(openTag);
  if (i < 0) return undefined;
  const start = i + openTag.length;
  const end = block.indexOf(closeTag, start);
  if (end < 0) return undefined;
  return block.slice(start, end);
}

function* eachSpell(xml) {
  const re = /<Spell>([\s\S]*?)<\/Spell>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    yield m[1];
  }
}

/** Mine a cooldown hint from a description string. Looks for patterns like
 *  "Cooldown: 6 seconds", "Cooldown: 1.5s", "30 second cooldown" etc. */
function mineCooldown(desc) {
  if (!desc) return null;
  // Most consistent DDO description format.
  const m = desc.match(/Cooldown\s*:?\s*([\d.]+)\s*(?:second|sec|s)\b/i);
  if (m) return parseFloat(m[1]);
  // Some descriptions phrase it as "X-second cooldown".
  const m2 = desc.match(/([\d.]+)\s*[-\s](?:second|sec|s)\s+cooldown/i);
  if (m2) return parseFloat(m2[1]);
  // Minutes ("Cooldown: 5 minutes" → 300).
  const mMin = desc.match(/Cooldown\s*:?\s*([\d.]+)\s*minute/i);
  if (mMin) return parseFloat(mMin[1]) * 60;
  return null;
}

function main() {
  const xml = readFileSync(XML_PATH, 'utf8');
  const out = {};
  for (const block of eachSpell(xml)) {
    const name = readBetween(block, '<Name>', '</Name>')?.trim();
    if (!name) continue;
    // Damaging spells only — at least one <SpellDamage> child.
    if (!block.includes('<SpellDamage>')) continue;
    const desc   = readBetween(block, '<Description>', '</Description>') ?? '';
    const school = readBetween(block, '<School>',     '</School>') ?? '';
    // Existing structured cooldown (after the merge script runs).
    const cdRaw  = readBetween(block, '<Cooldown>',   '</Cooldown>');
    const cdNum  = cdRaw ? parseFloat(cdRaw) : null;
    const explicit = mineCooldown(desc);
    out[name] = {
      school: school.trim(),
      structuredCooldown: cdNum,
      explicitCooldown:  explicit,
      // Compact description snippet around any "cooldown" mention for
      // quick eyeballing.
      descriptionSnippet: snippet(desc, 'cooldown'),
    };
  }
  console.log(JSON.stringify(out, null, 2));
  // Summary to stderr so callers can pipe stdout cleanly.
  const total = Object.keys(out).length;
  const withExplicit  = Object.values(out).filter(v => v.explicitCooldown != null).length;
  const withStructured = Object.values(out).filter(v => v.structuredCooldown != null).length;
  console.error(`\nDamaging spells: ${total}`);
  console.error(`  with structured <Cooldown>: ${withStructured}`);
  console.error(`  with description-text hint: ${withExplicit}`);
  console.error(`  needing manual values:      ${total - Math.max(withStructured, withExplicit)}`);
}

function snippet(text, keyword) {
  const lc = text.toLowerCase();
  const idx = lc.indexOf(keyword.toLowerCase());
  if (idx < 0) return '';
  const start = Math.max(0, idx - 20);
  const end   = Math.min(text.length, idx + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

main();
