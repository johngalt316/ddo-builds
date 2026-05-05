#!/usr/bin/env node
//
// measureShareUrl.mjs — given the kemton fixture, run it through the
// build parser and measure how many bytes the share-URL hash takes
// across several encoding strategies. Helps decide which scheme to
// adopt for shortening the share URL.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import LZString from 'lz-string';

const HERE     = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(HERE, '..');
const FIXTURE  = resolve(ROOT, 'tests/fixtures/kemton.DDOBuild');
const SNAPSHOT = resolve(ROOT, 'tests/snapshots/kemton.DDOBuild.snap.json');

void readdirSync; void readFileSync; void FIXTURE;

// We can't easily run the full TS parser in raw node — but the parsed
// snapshot is a 1:1 of the parser output, so use it as the input Build.
const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
// snap shape: { build, notes, warnings }
const build = snap.build;

const json = JSON.stringify(build);

function pct(after, before) {
  return ((1 - after / before) * 100).toFixed(1) + '%';
}

function row(label, bytes) {
  return `  ${label.padEnd(46)} ${String(bytes).padStart(7)} bytes  (${pct(bytes, json.length).padStart(7)} smaller than raw JSON)`;
}

console.log(`Raw build (JSON): ${json.length} bytes\n`);

// ── Current scheme: lz-string compressToEncodedURIComponent
const lzEncoded = LZString.compressToEncodedURIComponent(json);
console.log('Current production scheme:');
console.log(row('lz-string compressToEncodedURIComponent', lzEncoded.length));
console.log();

// ── Alternative: gzip + base64url
function toBase64Url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const gzip = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
const gzipEncoded = toBase64Url(gzip);
console.log('Alternative encodings:');
console.log(row('gzip(level=9) + base64url', gzipEncoded.length));

// ── brotli + base64url
const brotli = brotliCompressSync(Buffer.from(json, 'utf8'));
const brotliEncoded = toBase64Url(brotli);
console.log(row('brotli + base64url', brotliEncoded.length));

// ── Trimming defaults — strip empty arrays / undefined / default-ish fields
function trim(value) {
  if (Array.isArray(value)) {
    const out = value.map(trim).filter(v => v !== undefined);
    return out.length === 0 ? undefined : out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    let any = false;
    for (const [k, v] of Object.entries(value)) {
      const t = trim(v);
      if (t === undefined) continue;
      out[k] = t;
      any = true;
    }
    return any ? out : undefined;
  }
  // Drop common no-op leaf values.
  if (value === null) return undefined;
  if (value === false) return undefined;
  if (value === 0)    return undefined;
  if (value === '')   return undefined;
  return value;
}

const trimmed = trim(build) ?? {};
const trimmedJson = JSON.stringify(trimmed);
console.log();
console.log(`Trimmed JSON (drops empty/default leaves): ${trimmedJson.length} bytes`);
console.log(row('lz-string of trimmed JSON',                 LZString.compressToEncodedURIComponent(trimmedJson).length));
console.log(row('gzip(9) of trimmed JSON + base64url',       toBase64Url(gzipSync(Buffer.from(trimmedJson, 'utf8'), { level: 9 })).length));
console.log(row('brotli of trimmed JSON + base64url',        toBase64Url(brotliCompressSync(Buffer.from(trimmedJson, 'utf8'))).length));

console.log('\nFor reference, common URL length thresholds:');
console.log('  - SMS / Twitter share: ~2 kB');
console.log('  - Most browsers / servers: 8 kB');
console.log('  - Cloudflare Workers limit: 16 kB hash + path');
