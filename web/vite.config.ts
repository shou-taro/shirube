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
    // Tests import their own helpers rather than relying on globals — kinder to the
    // linter and the type checker.
    globals: false,
    css: false,
  },
})
