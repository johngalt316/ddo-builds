#!/usr/bin/env node
//
// generateShareUrl.mjs — emit a ddo-builds.com share URL for the kemton
// fixture using the current gzip + base64url scheme, and write a
// tappable HTML wrapper into OneDrive so we can mobile-test by opening
// the file from the iPhone OneDrive app (avoids iOS clipboard issues
// with very long strings).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE     = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(HERE, '..');
const SNAPSHOT = resolve(ROOT, 'tests/snapshots/kemton.DDOBuild.snap.json');
const OUT_HTML = 'C:/Users/Owner/OneDrive/Documents/kemton-share-test.html';

const snap  = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const build = snap.build;
const json  = JSON.stringify(build);

function toBase64Url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const gz      = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
const encoded = 'g' + toBase64Url(gz);
const url     = `https://ddo-builds.com/builder#${encoded}`;

console.log(`Raw JSON:    ${json.length} bytes`);
console.log(`Encoded:     ${encoded.length} bytes (incl. 'g' tag)`);
console.log(`Total URL:   ${url.length} bytes`);
console.log();

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Kemton share-URL test</title>
<style>body{font-family:system-ui;padding:2em;font-size:18px;line-height:1.4}a{word-break:break-all}</style>
</head><body>
<h1>Kemton share-URL test</h1>
<p>Tap the link to open the kemton build on ddo-builds.com (gzip-encoded share URL, ~9 KB).</p>
<p><a id="link" href="">Open kemton build</a></p>
<script>
document.getElementById("link").href = ${JSON.stringify(url)};
</script>
<p style="color:#888;font-size:14px">If the link 404s or hangs, the gzip-share change probably hasn't auto-deployed yet — wait ~30s and refresh.</p>
</body></html>
`;

writeFileSync(OUT_HTML, html, 'utf8');
console.log(`Wrote tappable wrapper → ${OUT_HTML}`);
console.log();
console.log(url);
