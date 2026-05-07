import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Build-time version probe. Patch number auto-bumps with every commit
// (= `git rev-list --count HEAD`) so each push lands a unique version
// without anyone hand-editing package.json. Falls back gracefully when
// git isn't available (Docker build context, fresh tarball).
function gitOutput(args: string, fallback: string): string {
  try { return execSync(`git ${args}`, { encoding: 'utf8' }).trim(); }
  catch { return fallback; }
}
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));
const [pkgMajor, pkgMinor] = (pkg.version as string).split('.');
const commitCount      = gitOutput('rev-list --count HEAD', '0');
const commitShaShort   = gitOutput('rev-parse --short HEAD', 'unknown');
const commitDateRaw    = gitOutput('log -1 --format=%ci HEAD', '');
// Format as "YYYY-MM-DD HH:MM" (drop seconds + tz offset for brevity).
const APP_VERSION      = `${pkgMajor}.${pkgMinor}.${commitCount}`;
const APP_SHA          = commitShaShort;
const APP_COMMIT_DATE  = commitDateRaw.slice(0, 16);   // "2026-05-07 19:33"

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__:     JSON.stringify(APP_VERSION),
    __APP_SHA__:         JSON.stringify(APP_SHA),
    __APP_COMMIT_DATE__: JSON.stringify(APP_COMMIT_DATE),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          gameData: [
            './src/data/feats.json',
            './src/data/enhancements.json',
            './src/data/classes.json',
          ],
        },
      },
    },
  },
})
