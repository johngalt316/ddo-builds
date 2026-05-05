// Build → share-URL hash compression.
//
// Encoder uses browser-native gzip via `CompressionStream` + base64url.
// On a real-world build (kemton, ~34 kB JSON) this comes out around 9 kB
// versus 16 kB with the previous lz-string scheme — keeps the share URL
// under most server / browser URL limits.
//
// Encoded values carry a one-character version tag so we can tell formats
// apart and add new schemes later without breaking old links:
//
//   "g" + <base64url(gzip(json))>     — current (since 2026-05).
//   <lz-string-uri-component>         — legacy. Detected when no known
//                                       version tag matches.
//
// The legacy lz-string path stays in for `decodeBuild` so previously-
// shared URLs keep working. New encodes always use gzip.

import LZString from 'lz-string';
import type { Build } from '@/types/build';

const VERSION_GZIP = 'g';

// ── base64url helpers ───────────────────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  // btoa expects a binary string. Build it from bytes; chunk to avoid
  // call-stack issues on large arrays.
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  // Re-pad and translate the URL-safe alphabet back to standard base64.
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Encode (gzip via CompressionStream) ─────────────────────────────

async function gzipString(s: string): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const blob = new Blob([s]);
  const stream = blob.stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeBuild(build: Build): Promise<string> {
  const json = JSON.stringify(build);
  const gz = await gzipString(json);
  return VERSION_GZIP + bytesToBase64Url(gz);
}

// ── Decode (gzip first, then lz-string legacy fallback) ─────────────

async function gunzipBytes(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip');
  // Convert the typed array into a plain ArrayBuffer to satisfy strict
  // BlobPart typing in Node test environments.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

export async function decodeBuild(encoded: string): Promise<Build | null> {
  // Current scheme first.
  if (encoded.startsWith(VERSION_GZIP)) {
    try {
      const json = await gunzipBytes(base64UrlToBytes(encoded.slice(1)));
      return JSON.parse(json) as Build;
    } catch {
      return null;
    }
  }
  // Legacy lz-string path — kept so old share URLs still resolve.
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return JSON.parse(json) as Build;
  } catch {
    return null;
  }
}
