import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { encodeBuild, decodeBuild } from '@/utils/compression';
import type { Build } from '@/types/build';

export function useShareUrl() {
  const navigate = useNavigate();
  const location = useLocation();

  const getShareUrl = useCallback(async (build: Build): Promise<string> => {
    const encoded = await encodeBuild(build);
    const url = new URL(window.location.href);
    url.hash = encoded;
    return url.toString();
  }, []);

  const copyShareUrl = useCallback(async (build: Build): Promise<boolean> => {
    try {
      const url = await getShareUrl(build);
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }, [getShareUrl]);

  const loadBuildFromHash = useCallback(async (): Promise<Build | null> => {
    const hash = location.hash.slice(1);
    if (!hash) return null;
    return decodeBuild(hash);
  }, [location.hash]);

  const clearHash = useCallback(() => {
    navigate(location.pathname, { replace: true });
  }, [navigate, location.pathname]);

  return { getShareUrl, copyShareUrl, loadBuildFromHash, clearHash };
}
