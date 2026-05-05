#!/usr/bin/env node
//
// One-shot patcher: wires <Effect><Type>SpellLikeAbility</Type></Effect>
// onto specific <Clickie/> enhancements that DDOBuilderV2 codes as
// active abilities but never wires the SLA effect upstream.
//
// Conservative on purpose — we DON'T blanket-patch every <Clickie/>
// because many of them are passive feature toggles, weapon-only
// attacks, action boosts, summon clickies, etc. that don't belong in
// the magic SLA list. Instead the script keys off two whitelists:
//
//   1. Every "Epic Strike" selection across all destiny trees
//      (description contains the literal words "Epic Strike").
//   2. An EXTRA_NAMES array of standalone clickies surfaced by users
//      (Hunt's End, Boulder's Might, Conjure Stone, etc.).
//
// Run once after upstream tree XML refresh; reports which entries were
// already wired vs newly patched.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE_DIR = resolve(HERE, '../public/data/EnhancementTrees');

// Enhancement Selections / Items by exact `<Name>` that should be wired
// as SLAs even though their description doesn't mention "Epic Strike".
// Add new names here as users surface them.
const EXTRA_NAMES = new Set([
  "Hunt's End",
  "Beguiling Charm",
  "Boulder's Might",
  "Deep Gnome: Conjure Stone",
]);

// Pull the cooldown / SP cost out of an Epic Strike description prose.
function readNumber(re, desc) {
  const m = desc.match(re);
  return m ? Number(m[1]) : 0;
}
function parseCost(desc)     { return readNumber(/Cost:?\s*(\d+)\s*(?:Spell\s*)?Point/i, desc)
                              || readNumber(/Spell\s*Point\s*Cost:?\s*(\d+)/i, desc); }
function parseCooldown(desc) { return readNumber(/Cooldown:?\s*(\d+)\s*sec/i, desc); }

// Build the SLA Effect XML block — same shape as the existing wired
// entries (e.g. Flame Pillar, Moon Lance, Gloomspear). Amount layout:
//   [0]=charges/rest [1]=cost [2]=maxCL [3]=cooldown
function makeEffect(spellName, cost, cooldown, indent) {
  return `\n${indent}<!-- ddo-builds patch: see docs/DATA_PATCHES.md`
       + ` "Clickie SLA wiring". -->`
       + `\n${indent}<Effect>`
       + `\n${indent}  <Type>SpellLikeAbility</Type>`
       + `\n${indent}  <Bonus>Enhancement</Bonus>`
       + `\n${indent}  <Item>${spellName}</Item>`
       + `\n${indent}  <Item>None</Item>`
       + `\n${indent}  <AType>SpellInfo</AType>`
       + `\n${indent}  <Amount size="4">0 ${cost} 0 ${cooldown}</Amount>`
       + `\n${indent}</Effect>`;
}

let totalPatched = 0;
let totalWired   = 0;
let totalSkipped = 0;

/** Patch every block of `kind` (open/close tags) in `xml` that has
 *  <Clickie/> but not yet a SpellLikeAbility wiring. Returns updated xml. */
function patchBlocks(xml, kind, indent, fileLabel) {
  const openTag  = `<${kind}>`;
  const closeTag = `</${kind}>`;
  let out = xml;
  let cursor = 0;
  let patchedHere = 0;
  while (true) {
    const open  = out.indexOf(openTag, cursor);
    if (open < 0) break;
    const close = out.indexOf(closeTag, open);
    if (close < 0) break;
    const block = out.slice(open, close);

    if (!/<Clickie\s*\/>/.test(block)) { cursor = close; continue; }
    if (/<Type>SpellLikeAbility<\/Type>/.test(block)) {
      totalWired++; cursor = close; continue;
    }

    // EnhancementTreeItems with a nested <Selector> let the inner
    // <EnhancementSelection>s carry the wiring — don't double-emit.
    if (kind === 'EnhancementTreeItem' && /<Selector>/.test(block)) {
      cursor = close; continue;
    }

    const name = (block.match(/<Name>([^<]+)<\/Name>/) ?? [, ''])[1].trim();
    const desc = (block.match(/<Description>([\s\S]*?)<\/Description>/) ?? [, ''])[1];
    if (!name) { totalSkipped++; cursor = close; continue; }

    // Conservative whitelist gate: must look like an Epic Strike or
    // appear in the EXTRA_NAMES allowlist.
    const isEpicStrike = /Epic Strike/i.test(desc);
    const isExtra      = EXTRA_NAMES.has(name);
    if (!isEpicStrike && !isExtra) { cursor = close; continue; }

    const cost     = parseCost(desc);
    const cooldown = parseCooldown(desc);
    const insert   = makeEffect(name, cost, cooldown, indent);

    // Insert just before the close tag. Caller's indent strips the
    // exact whitespace alignment for that block kind.
    const before = out.slice(0, close);
    const after  = out.slice(close);
    out = before + insert + '\n' + indent.slice(2) + after;

    patchedHere++;
    totalPatched++;
    cursor = close + insert.length + indent.length;
    console.log(`  + ${(name + ' · ' + kind).padEnd(60)} (cost=${cost}, cd=${cooldown}s)`);
  }
  if (patchedHere > 0) console.log(`${fileLabel}: patched ${patchedHere} ${kind}(s)`);
  return out;
}

// Walk every tree (destiny + class + racial + universal) since the
// EXTRA_NAMES list can include non-destiny entries (Conjure Stone is
// in DeepGnome, Boulder's Might is in FuryOfTheWild, etc.).
for (const f of readdirSync(TREE_DIR).filter(x => x.endsWith('.tree.xml'))) {
  const path = resolve(TREE_DIR, f);
  const before = readFileSync(path, 'utf8');
  let xml = before;
  // EnhancementSelections sit inside selectors and are deeper-indented.
  xml = patchBlocks(xml, 'EnhancementSelection', '          ', f);
  xml = patchBlocks(xml, 'EnhancementTreeItem',  '      ',     f);
  if (xml !== before) writeFileSync(path, xml, 'utf8');
}

console.log(`\nDone. ${totalPatched} patched, ${totalWired} already wired, ${totalSkipped} skipped.`);
