// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

// The landing + docs site. Static output; React is used only for the interactive demo
// island, so the rest of the page ships no JavaScript and paints fast — the first
// impression the site is built to make.
//
// `site` and `base` are set for GitHub Pages project hosting by default; if we host
// elsewhere (Cloudflare Pages, a custom domain) drop `base` and point `site` at it.
export default defineConfig({
  site: 'https://shou-taro.github.io',
  base: '/shirube',
  integrations: [react()],
})
