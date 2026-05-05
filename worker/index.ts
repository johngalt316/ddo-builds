// Cloudflare Worker entrypoint. Handles the share-link API and falls
// through to the static SPA assets for everything else.
//
//   POST /api/share        — body is the encoded build ("g…"), returns { id }
//   GET  /api/share/:id    — returns the encoded build as text/plain
//
// Storage is KV with a sliding 90-day TTL: every successful GET re-writes
// the entry with a fresh expiry, so popular builds live indefinitely while
// untouched ones expire on their own (no cleanup job needed).
//
// POSTs are rate-limited per client IP (10/minute) using the Workers
// Rate Limiting binding. Static assets are served via the ASSETS binding.

export interface Env {
  SHARE_KV: KVNamespace;
  SHARE_LIMITER: RateLimit;
  ASSETS: Fetcher;
}

const TTL_SECONDS = 60 * 60 * 24 * 90;
const MAX_BODY    = 32 * 1024;
const ID_BYTES    = 6;

function makeId(): string {
  const buf = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 8);
}

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'unknown';
}

async function handlePost(req: Request, env: Env): Promise<Response> {
  const { success } = await env.SHARE_LIMITER.limit({ key: clientIp(req) });
  if (!success) return new Response('rate-limited', { status: 429 });

  const lenHeader = req.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > MAX_BODY) {
    return new Response('payload too large', { status: 413 });
  }

  const body = (await req.text()).trim();
  if (body.length === 0 || body.length > MAX_BODY) {
    return new Response('invalid body', { status: 400 });
  }
  if (!body.startsWith('g')) {
    return new Response('invalid encoding', { status: 400 });
  }

  let id = makeId();
  if (await env.SHARE_KV.get(id, 'text')) id = makeId();
  await env.SHARE_KV.put(id, body, { expirationTtl: TTL_SECONDS });

  return Response.json({ id });
}

async function handleGet(id: string, env: Env): Promise<Response> {
  const value = await env.SHARE_KV.get(id, 'text');
  if (!value) return new Response('not found', { status: 404 });
  // Sliding TTL — touch the entry so popular shares don't expire.
  await env.SHARE_KV.put(id, value, { expirationTtl: TTL_SECONDS });
  return new Response(value, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/share' && req.method === 'POST') {
      return handlePost(req, env);
    }
    const m = url.pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{6,12})$/);
    if (m && req.method === 'GET') {
      return handleGet(m[1], env);
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
