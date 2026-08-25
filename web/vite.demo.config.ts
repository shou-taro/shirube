import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// A standalone build of the embeddable landing-page demo: the real Explorer running on the
// bundled Chinook fixtures (see src/demo/). It shares the app's source, alias and plugins,
// but emits a self-contained bundle into the site's public/ so the landing can iframe it at
// `/shirube/demo/`. Kept separate from the app build so neither disturbs the other.
export default defineConfig({
  base: '/shirube/demo/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../site/public/demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'demo.html'),
    },
  },
})
