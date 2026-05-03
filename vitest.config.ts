import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// `react()` is typed against the standalone vite version while vitest
// bundles its own. The plugin works at runtime regardless — cast to skip
// the structural compare. See PORT_PLAN §8 / Phase 0 for context.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reactPlugin = react() as any

export default defineConfig({
  plugins: [reactPlugin],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
