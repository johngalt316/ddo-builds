import LZString from 'lz-string';
import type { Build } from '@/types/build';

export function encodeBuild(build: Build): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(build));
}

export function decodeBuild(encoded: string): Build | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return JSON.parse(json) as Build;
  } catch {
    return null;
  }
}
