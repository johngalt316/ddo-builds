#!/usr/bin/env node
// Compound dev helper. Wraps the recurring "verify everything still works"
// and "regenerate snapshots cleanly" workflows so they're a single command
// instead of a chain of `cd && rm && npm test && npm run build`.
//
// Subcommands:
//   verify              tsc --noEmit + vitest run
//   verify:full         verify + vite build (+ size summary)
//   snapshots:reset [pattern]
//                       delete tests/snapshots/* matching pattern (default: all)
//                       then run vitest to regenerate
//   debug:fixture <file>
//                       parse tests/fixtures/<file>.DDOBuild and dump key fields
//                       (race, classes, abilityScores, tomes, levelUps, gear-set sizes,
//                        specialFeats sample, parser warnings)
//
// Usage:
//   npm run verify
//   npm run verify:full
//   npm run snapshots:reset            # all
//   npm run snapshots:reset engine     # only engine.snap.json files
//   npm run snapshots:reset BuildEditor
//   npm run debug:fixture kemton

import { spawnSync } from 'node:child_process';
import { readdirSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SNAPSHOTS = resolve(ROOT, 'tests/snapshots');

function run(cmd, args, label) {
  if (label) console.log(`\n▸ ${label}`);
  // shell:true is needed on Windows so commands like `npm` resolve via .cmd,
  // so we pre-join args into the command string to dodge the Node 22
  // DEP0190 deprecation warning about passing args under shell mode.
  const joined = args.length ? `${cmd} ${args.join(' ')}` : cmd;
  const r = spawnSync(joined, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`✘ ${label ?? cmd} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function npmRun(script, label) {
  run('npm', ['run', script], label ?? `npm run ${script}`);
}

function snapshotFiles(pattern) {
  const all = readdirSync(SNAPSHOTS);
  if (!pattern) return all.map(f => resolve(SNAPSHOTS, f));
  const lc = pattern.toLowerCase();
  return all.filter(f => f.toLowerCase().includes(lc)).map(f => resolve(SNAPSHOTS, f));
}

function deleteSnapshots(files) {
  for (const f of files) {
    try { unlinkSync(f); } catch { /* missing → fine */ }
  }
  console.log(`  removed ${files.length} snapshot file${files.length === 1 ? '' : 's'}`);
}

const sub = process.argv[2];
const arg = process.argv[3];

switch (sub) {
  case 'verify': {
    npmRun('typecheck', 'typecheck');
    run('npx', ['vitest', 'run'], 'vitest run');
    break;
  }

  case 'verify:full': {
    npmRun('typecheck', 'typecheck');
    run('npx', ['vitest', 'run'], 'vitest run');
    npmRun('build', 'production build');
    break;
  }

  case 'snapshots:reset': {
    const files = snapshotFiles(arg);
    if (files.length === 0) {
      console.error(`No snapshot files match "${arg ?? '*'}" — nothing to do.`);
      process.exit(1);
    }
    console.log(`Resetting ${files.length} snapshot${files.length === 1 ? '' : 's'}` +
      (arg ? ` matching "${arg}"` : ' (all)') + '…');
    deleteSnapshots(files);
    run('npx', ['vitest', 'run'], 'vitest run (regenerates)');
    break;
  }

  case 'debug:fixture': {
    if (!arg) {
      console.error('Usage: npm run debug:fixture <name>  (e.g. kemton, zentek)');
      process.exit(1);
    }
    const path = resolve(ROOT, `tests/fixtures/${arg}.DDOBuild`);
    const xml = readFileSync(path, 'utf8');
    // Lazy-load happy-dom + the parser so the script loads quickly when
    // not exercising this path.
    const { Window } = await import('happy-dom');
    const w = new Window();
    globalThis.DOMParser = w.DOMParser;
    const { parseDDOBuildFile } = await import('../src/utils/ddoBuildParser.ts');
    const result = parseDDOBuildFile(xml);
    if (!result) {
      console.error('parseDDOBuildFile returned null');
      process.exit(1);
    }
    const b = result.build;
    console.log(`── ${arg}.DDOBuild ──`);
    console.log(`  name:           ${b.name}`);
    console.log(`  race:           ${b.raceId}`);
    console.log(`  alignment:      ${b.alignment}`);
    console.log(`  classes:        ${b.classes.map(c => `${c.classId} ${c.levels}`).join(', ')}`);
    console.log(`  charLevel:      ${b.classes.reduce((s, c) => s + c.levels, 0)}`);
    console.log(`  abilityScores:  ${JSON.stringify(b.abilityScores)}`);
    console.log(`  abilityTomes:   ${JSON.stringify(b.abilityTomes ?? {})}`);
    console.log(`  levelUps:       ${JSON.stringify(b.levelUps ?? {})}`);
    console.log(`  feats:          ${b.feats.length} selected`);
    console.log(`  enhancements:   ${(b.enhancements ?? []).reduce((n, t) => n + t.enhancements.length, 0)} ranks across ${(b.enhancements ?? []).length} trees`);
    console.log(`  destinies:      ${(b.destinyEnhancements ?? []).reduce((n, t) => n + t.enhancements.length, 0)} ranks across ${(b.destinyEnhancements ?? []).length} trees`);
    console.log(`  gear sets:      ${b.gearSets.map(s => `${s.name}(${s.items.length})`).join(', ')}`);
    console.log(`  active gear:    ${b.activeGearSet}`);
    console.log(`  specialFeats:   ${(b.specialFeats ?? []).length} entries`);
    if ((b.specialFeats ?? []).length) {
      const byType = new Map();
      for (const sf of b.specialFeats ?? []) {
        byType.set(sf.type, (byType.get(sf.type) ?? 0) + 1);
      }
      for (const [type, count] of byType) {
        console.log(`     ${type}: ${count} distinct feats`);
      }
    }
    if (result.warnings?.length) {
      console.log(`  warnings:`);
      for (const w of result.warnings) console.log(`     ! ${w}`);
    }
    break;
  }

  default: {
    console.error([
      'Unknown subcommand. Available:',
      '  verify              typecheck + tests',
      '  verify:full         typecheck + tests + production build',
      '  snapshots:reset [pattern]',
      '                      delete matching snapshots and regenerate',
      '  debug:fixture <name>',
      '                      pretty-print parsed .DDOBuild fixture',
    ].join('\n'));
    process.exit(1);
  }
}
