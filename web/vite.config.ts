import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Proxy API calls to the backend (default port 7472) during development.
      '/api': { target: 'http://127.0.0.1:7472', changeOrigin: true },
    },
  },
  test: {
    // Unit/component tests live in src; the e2e specs (./e2e) run under Playwright.
    include: ['src/**/*.test.{ts,tsx}'],
    // Component and DOM-touching tests need a browser-like environment.
    environment: 'jsdom',
    // A concrete origin (rather than the default opaque about:blank) so localStorage
    // actually works under test.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: './src/test/setup.ts',
    // The default 5s is tight for the first component test on a cold, slow CI runner
    // (Windows especially), where module load and JIT warm-up land on that first render.
    testTimeout: 15000,
    // Tests import their own helpers rather than relying on globals — kinder to the
    // linter and the type checker.
    globals: false,
    css: false,
    coverage: {
      provider: 'v8',
      // Report on the source, not the tests or the wiring that only runs a browser.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Bootstraps the real app against a live backend — exercised by the e2e suite.
        'src/main.tsx',
        // Plain data with no logic to cover.
        'src/i18n/**',
        // The ER map's React Flow rendering — nodes, routed edges and the diagram wiring
        // itself. These are exercised by the e2e suite against the real library, where the
        // rendering actually happens, not unit-tested in jsdom (which can't lay out or draw
        // a flow). Their logic-bearing siblings layout.ts and neighbourhood.ts stay counted.
        'src/components/er/er-diagram.tsx',
        'src/components/er/routed-edge.tsx',
        'src/components/er/table-node.tsx',
      ],
      // text-summary for the console, html for local browsing, lcov for Codecov (CI).
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
})
