// Thin client for the KV-backed share API exposed by the Worker.
//
//   POST /api/share       body: encoded build ("g…")     → { id }
//   GET  /api/share/:id                                  → encoded build text
//
// Both helpers swallow errors and return null so callers can fall back
// gracefully to the inline hash-encoded scheme.

export async function createShareId(encoded: string): Promise<string | null> {
  try {
    const r = await fetch('/api/share', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: encoded,
    });
    if (!r.ok) return null;
    const { id } = (await r.json()) as { id?: string };
    return id ?? null;
  } catch {
    return null;
  }
}

export async function fetchSharedEncoded(id: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/share/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const text = (await r.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}
