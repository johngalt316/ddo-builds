import { useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { encodeBuild, decodeBuild } from '@/utils/compression';
import { createShareId, fetchSharedEncoded } from '@/utils/shareApi';
import type { Build } from '@/types/build';
import { migrateEnhancementSets } from '@/types/build';

// Tries to mint a short `/b/:id` URL via the KV-backed share API, and
// falls back to the inline `#<encoded>` form if the API is unavailable
// or rate-limited. The hash form is also what we keep for direct sharing
// when KV isn't reachable (offline preview, etc.).
export function useShareUrl() {
  const navigate = useNavigate();
  const location = useLocation();
  const params   = useParams<{ id?: string }>();

  const getShareUrl = useCallback(async (build: Build): Promise<string> => {
    const encoded = await encodeBuild(build);
    const id = await createShareId(encoded);
    const url = new URL(window.location.href);
    if (id) {
      url.pathname = `/b/${id}`;
      url.hash = '';
      url.search = '';
    } else {
      // Fallback: inline hash-encoded build.
      url.pathname = '/builder';
      url.hash = encoded;
      url.search = '';
    }
    return url.toString();
  }, []);

  const copyShareUrl = useCallback(async (build: Build): Promise<boolean> => {
    // iOS Safari quirk: navigator.clipboard.writeText() refuses to fire
    // when there's been any async await between the user gesture (click)
    // and the clipboard call. We do an encode + POST /api/share roundtrip
    // before we have the URL, which breaks that gesture chain.
    //
    // The workaround that does still preserve gesture context is
    // ClipboardItem with a Promise body — Safari accepts it because the
    // *promise* was created synchronously inside the click handler. Use
    // that path when available, fall back to the plain writeText path
    // (Firefox / older browsers that don't implement ClipboardItem).
    const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    const hasAsyncClipboard = typeof ClipboardItemCtor === 'function'
      && typeof navigator.clipboard?.write === 'function';

    try {
      if (hasAsyncClipboard) {
        const blob = getShareUrl(build).then(url => new Blob([url], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItemCtor({ 'text/plain': blob })]);
        return true;
      }
      const url = await getShareUrl(build);
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      // Last-ditch fallback: surface the URL via a prompt so the user
      // can copy manually. Better than a silent no-op when the browser
      // blocks both clipboard paths.
      try {
        const url = await getShareUrl(build);
        window.prompt('Copy this share URL (clipboard access was blocked):', url);
        return false;
      } catch {
        return false;
      }
    }
  }, [getShareUrl]);

  // Loads a build from whichever share-pointer is on the URL: either
  // `/b/:id` (fetched from KV) or `#<encoded>` (decoded inline).
  const loadBuildFromHash = useCallback(async (): Promise<Build | null> => {
    let build: Build | null = null;
    if (params.id) {
      const encoded = await fetchSharedEncoded(params.id);
      if (!encoded) return null;
      build = await decodeBuild(encoded);
    } else {
      const hash = location.hash.slice(1);
      if (!hash) return null;
      build = await decodeBuild(hash);
    }
    // Bring legacy share-URL payloads (pre EnhancementSet) into the
    // current shape so the engine + UI don't trip on missing
    // enhancementSets / activeEnhancementSet.
    return build ? migrateEnhancementSets(build) : null;
  }, [params.id, location.hash]);

  const clearHash = useCallback(() => {
    navigate(location.pathname, { replace: true });
  }, [navigate, location.pathname]);

  return { getShareUrl, copyShareUrl, loadBuildFromHash, clearHash };
}
