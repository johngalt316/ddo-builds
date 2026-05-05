#!/usr/bin/env node
//
// seedSpellCooldowns.mjs — generates a comprehensive scripts/spell-cooldowns.json
// covering every damaging spell in Spells.xml.
//
// The upstream DDOBuilderV2 / wiki XML never carries <Cooldown> on damaging
// spells. For each spell this script picks a value in the following priority:
//
//   1. Mined cooldown from the spell's description prose
//      (e.g. "Cooldown: 6 seconds", "12 second cooldown", "Cooldown: 1 minute").
//   2. Explicit override from `scripts/spell-cooldown-overrides.json`
//      (where you record verified cooldowns the description doesn't mention).
//   3. Level-based default — using the LOWEST class spell level any class
//      lists for that spell, mapped to a typical DDO cooldown:
//        cantrip / L1 / L2 → 2s
//        L3                → 4s
//        L4 / L5           → 6s
//        L6                → 8s
//        L7                → 12s
//        L8                → 15s
//        L9                → 30s
//      These defaults are *guesses* for unverified spells — fix specific
//      values by adding them to scripts/spell-cooldown-overrides.json and
//      re-running this seeder.
//
// Run: `node scripts/seedSpellCooldowns.mjs` → writes scripts/spell-cooldowns.json.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE          = dirname(fileURLToPath(import.meta.url));
const ROOT          = resolve(HERE, '..');
const SPELLS_XML    = resolve(ROOT, 'public/data/Spells.xml');
const CLASSES_DIR   = resolve(ROOT, 'public/data/Classes');
const OUT_JSON      = resolve(HERE, 'spell-cooldowns.json');
const OVERRIDE_JSON = resolve(HERE, 'spell-cooldown-overrides.json');

const LEVEL_DEFAULTS = { 0: 2, 1: 2, 2: 2, 3: 4, 4: 6, 5: 6, 6: 8, 7: 12, 8: 15, 9: 30 };

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
  while ((m = re.exec(xml)) !== null) yield m[1];
}

/** Mine a cooldown from a description string. Returns seconds, or null. */
function mineCooldown(desc) {
  if (!desc) return null;
  const m = desc.match(/Cooldown\s*:?\s*([\d.]+)\s*(?:second|sec|s)\b/i);
  if (m) return parseFloat(m[1]);
  const m2 = desc.match(/([\d.]+)\s*[-\s](?:second|sec|s)\s+cooldown/i);
  if (m2) return parseFloat(m2[1]);
  const mMin = desc.match(/Cooldown\s*:?\s*([\d.]+)\s*minute/i);
  if (mMin) return parseFloat(mMin[1]) * 60;
  return null;
}

/**
 * Walk every class XML and build a map of spell name → lowest spell level
 * any class lists for it. Cantrips are level 0.
 */
function buildSpellLevels() {
  const out = new Map();
  for (const f of readdirSync(CLASSES_DIR)) {
    if (!f.endsWith('.xml')) continue;
    const xml = readFileSync(resolve(CLASSES_DIR, f), 'utf8');
    const re = /<ClassSpell>([\s\S]*?)<\/ClassSpell>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const name  = readBetween(block, '<Name>',  '</Name>')?.trim();
      const lvl   = readBetween(block, '<Level>', '</Level>')?.trim();
      if (!name || lvl == null) continue;
      const n = Number(lvl);
      if (!Number.isFinite(n)) continue;
      const prev = out.get(name);
      if (prev === undefined || n < prev) out.set(name, n);
    }
  }
  return out;
}

function main() {
  const spellsXml = readFileSync(SPELLS_XML, 'utf8');
  const levels = buildSpellLevels();
  const overrides = existsSync(OVERRIDE_JSON)
    ? (JSON.parse(readFileSync(OVERRIDE_JSON, 'utf8')).cooldowns ?? {})
    : {};

  const cooldowns = {};
  let mined = 0;
  let overrode = 0;
  let defaulted = 0;
  let unknown = 0;

  for (const block of eachSpell(spellsXml)) {
    const name = readBetween(block, '<Name>', '</Name>')?.trim();
    if (!name) continue;
    if (!block.includes('<SpellDamage>')) continue;
    const desc = readBetween(block, '<Description>', '</Description>') ?? '';

    let cd;
    let source;
    if (overrides[name] != null) {
      cd = overrides[name];
      source = 'override';
      overrode++;
    } else {
      const fromDesc = mineCooldown(desc);
      if (fromDesc != null) {
        cd = fromDesc;
        source = 'description';
        mined++;
      } else {
        const lvl = levels.get(name);
        if (lvl !== undefined && LEVEL_DEFAULTS[lvl] !== undefined) {
          cd = LEVEL_DEFAULTS[lvl];
          source = `default-L${lvl}`;
          defaulted++;
        } else {
          // Unknown level — skip rather than guess wildly.
          unknown++;
          continue;
        }
      }
    }
    cooldowns[name] = cd;
    void source; // (kept for any future audit-output mode)
  }

  // Sort alphabetically for stable diffs.
  const sorted = Object.fromEntries(
    Object.entries(cooldowns).sort(([a], [b]) => a.localeCompare(b)),
  );

  const output = {
    _comment: [
      'Spell cooldowns in seconds (BASE; the engine\'s SpellCooldownReduction',
      'multiplier still applies on top). Source-of-truth file applied by',
      '`node scripts/applySpellCooldowns.mjs` into public/data/Spells.xml.',
      '',
      'Many entries here are level-based defaults (cantrip/1/2 → 2s, 3 → 4s,',
      '4/5 → 6s, 6 → 8s, 7 → 12s, 8 → 15s, 9 → 30s). Verified values from',
      'description prose or the override file beat defaults. To pin a verified',
      'cooldown, add it to scripts/spell-cooldown-overrides.json and re-run',
      '`node scripts/seedSpellCooldowns.mjs`.',
    ].join(' '),
    cooldowns: sorted,
  };

  writeFileSync(OUT_JSON, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${Object.keys(sorted).length} cooldowns to ${OUT_JSON}`);
  console.log(`  override:    ${overrode}`);
  console.log(`  description: ${mined}`);
  console.log(`  default:     ${defaulted}`);
  console.log(`  skipped (unknown level): ${unknown}`);
}

main();
