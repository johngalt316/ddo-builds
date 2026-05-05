#!/usr/bin/env node
//
// sync-upstream — compares the upstream DDOBuilderV2 clone against
// external/ddobuilderv2/ and reports what's changed. With --apply,
// refreshes external/ddobuilderv2/ to match upstream and updates
// SYNC.md with the new commit hash + date.
//
// Usage:
//   node scripts/syncUpstream.mjs                 # dry-run
//   node scripts/syncUpstream.mjs --apply         # write changes
//   node scripts/syncUpstream.mjs --source=<path> # override upstream
//
// Workflow after --apply:
//   git diff external/ddobuilderv2/   shows what THEY changed.
//   git diff public/data/             still empty — public/data/
//                                     is authoritative. Manually
//                                     apply the curated upstream
//                                     changes you want.

import {
  readFileSync, writeFileSync, readdirSync, statSync, existsSync,
  copyFileSync, mkdirSync, rmSync,
} from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args      = process.argv.slice(2);
const APPLY     = args.includes('--apply');
const sourceArg = args.find(a => a.startsWith('--source='));

const HERE       = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(HERE, '..');
const EXTERNAL   = resolve(ROOT, 'external/ddobuilderv2');
const SOURCE_ABS = resolve(ROOT, sourceArg
  ? sourceArg.split('=')[1]
  : '../DDOBuilderV2/Output/DataFiles');

const SYNC_MD = join(EXTERNAL, 'SYNC.md');

// Folders inside upstream Output/DataFiles/ that we DON'T snapshot —
// either too large (Items), already mirrored elsewhere (image dirs),
// or templates (Blank Trees).
const SKIP_DIRS = new Set(['Items', 'Blank Trees']);
const isImageDir = (name) => name.endsWith('Images');

if (!existsSync(SOURCE_ABS)) {
  console.error(`Upstream source not found: ${SOURCE_ABS}`);
  console.error(`Pass --source=<path-to-Output/DataFiles> or clone DDOBuilderV2 alongside ddo-builds.`);
  process.exit(1);
}

// ── Resolve upstream commit metadata ──────────────────────────────────

function gitInfo() {
  // Walk upward from SOURCE_ABS to find the repo root.
  let dir = SOURCE_ABS;
  while (dir && !existsSync(join(dir, '.git'))) {
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  if (!dir) return null;
  try {
    const sha  = execSync(`git -C "${dir}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
    const date = execSync(`git -C "${dir}" log -1 --format=%ai`, { encoding: 'utf8' }).trim().split(' ')[0];
    return { sha, date };
  } catch {
    return null;
  }
}

const upstreamGit = gitInfo();

// ── Walk file trees ───────────────────────────────────────────────────

function walkSnapshot(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'SYNC.md' && base === '') continue;
    if (entry === 'README.md' && base === '') continue;
    const full = join(dir, entry);
    const rel  = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      out.push(...walkSnapshot(full, rel));
    } else {
      out.push({ rel, full });
    }
  }
  return out;
}

function walkUpstream(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel  = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      if (isImageDir(entry))    continue;
      out.push(...walkUpstream(full, rel));
    } else {
      out.push({ rel, full });
    }
  }
  return out;
}

const ourFiles      = walkSnapshot(EXTERNAL);
const upstreamFiles = walkUpstream(SOURCE_ABS);
const upstreamMap   = new Map(upstreamFiles.map(f => [f.rel, f.full]));
const ourMap        = new Map(ourFiles.map(f => [f.rel, f.full]));

// ── Diff ──────────────────────────────────────────────────────────────

const lfNormalize = (s) => s.replace(/\r\n?/g, '\n');

const added    = [];   // in upstream, not in external/
const modified = [];   // in both, content differs
const removed  = [];   // in external/, not in upstream
let identical  = 0;

for (const { rel, full: srcPath } of upstreamFiles) {
  const ourPath = ourMap.get(rel);
  if (!ourPath) {
    added.push({ rel, srcPath });
    continue;
  }
  const srcNorm = lfNormalize(readFileSync(srcPath, 'utf8'));
  const ourNorm = lfNormalize(readFileSync(ourPath, 'utf8'));
  if (srcNorm === ourNorm) {
    identical++;
  } else {
    modified.push({ rel, srcPath, ourPath, srcLen: srcNorm.length, ourLen: ourNorm.length });
  }
}
for (const { rel, full: ourPath } of ourFiles) {
  if (!upstreamMap.has(rel)) {
    removed.push({ rel, ourPath });
  }
}

// ── Report ────────────────────────────────────────────────────────────

console.log(`Upstream:  ${SOURCE_ABS}`);
console.log(`Snapshot:  external/ddobuilderv2/`);
if (upstreamGit) {
  console.log(`Pinned at: ${upstreamGit.sha.slice(0, 12)} (${upstreamGit.date})`);
}
console.log();
console.log(`  ${String(added.length).padStart(4)} new files upstream`);
console.log(`  ${String(modified.length).padStart(4)} modified`);
console.log(`  ${String(removed.length).padStart(4)} removed from upstream`);
console.log(`  ${String(identical).padStart(4)} unchanged`);

const lineCount = (s) => s.split('\n').length;

function diffNumstat(srcPath, ourPath) {
  const a = lfNormalize(readFileSync(ourPath, 'utf8')).split('\n');
  const b = lfNormalize(readFileSync(srcPath, 'utf8')).split('\n');
  // O(n*m) LCS would be prohibitive on big files; use a fast hash-set
  // approximation: count lines unique to each side.
  const aSet = new Map();
  for (const l of a) aSet.set(l, (aSet.get(l) ?? 0) + 1);
  let ins = 0, del = 0;
  for (const l of b) {
    const c = aSet.get(l) ?? 0;
    if (c > 0) aSet.set(l, c - 1);
    else ins++;
  }
  for (const c of aSet.values()) del += c;
  return { ins, del };
}

if (added.length) {
  console.log('\nNew upstream files (would be copied in on --apply):');
  for (const f of added) {
    const lines = lineCount(readFileSync(f.srcPath, 'utf8'));
    console.log(`  + ${f.rel}  (${lines} lines)`);
  }
}

if (removed.length) {
  console.log('\nRemoved from upstream (would be deleted on --apply):');
  for (const f of removed) {
    console.log(`  - ${f.rel}`);
  }
}

if (modified.length) {
  console.log('\nModified upstream:');
  for (const f of modified) {
    const { ins, del } = diffNumstat(f.srcPath, f.ourPath);
    console.log(`  ~ ${f.rel.padEnd(56)} +${ins} -${del}`);
  }
}

// ── Apply ─────────────────────────────────────────────────────────────

if (APPLY) {
  console.log('\nApplying...');
  for (const f of added) {
    const dst = join(EXTERNAL, f.rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(f.srcPath, dst);
  }
  for (const f of modified) {
    copyFileSync(f.srcPath, f.ourPath);
  }
  for (const f of removed) {
    rmSync(f.ourPath);
  }
  if (upstreamGit && existsSync(SYNC_MD)) {
    const today = new Date().toISOString().slice(0, 10);
    const md = readFileSync(SYNC_MD, 'utf8')
      .replace(/(\| Upstream commit \| `)([^`]+)(` \|)/, `$1${upstreamGit.sha}$3`)
      .replace(/(\| Upstream date\s+\| )([\d-]+)( \|)/,   `$1${upstreamGit.date}$3`)
      .replace(/(\| Pulled into ddo-builds \| )([\d-]+)( \|)/, `$1${today}$3`);
    writeFileSync(SYNC_MD, md);
  }
  console.log(`Done. external/ddobuilderv2/ now matches upstream @ ${upstreamGit ? upstreamGit.sha.slice(0, 12) : 'HEAD'}.`);
  console.log(`Next: review with 'git diff external/ddobuilderv2/' and curate which`);
  console.log(`changes to merge into public/data/.`);
} else if (added.length || modified.length || removed.length) {
  console.log('\nDry-run only. Re-run with --apply to write changes.');
} else {
  console.log('\nIn sync.');
}
