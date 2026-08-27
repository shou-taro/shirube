/**
 * Demo bootstrap — runs before i18n and the app.
 *
 * Installs the API mock, then seeds the language and theme the embedding page asked for
 * (via `?lang=` / `?theme=` on the iframe src) into the settings store, so the real
 * `SettingsProvider` and i18n pick them up on first render with no flash. Imported first
 * from `main.tsx`, so its side effects land before anything reads settings or fetches.
 */
import { SETTINGS_KEY } from '@/lib/storage'

import { installApiMock } from './api-mock'

installApiMock()

const params = new URLSearchParams(location.search)
const lang = params.get('lang') === 'ja' ? 'ja' : 'en'
const themeParam = params.get('theme')
const theme = themeParam === 'dark' || themeParam === 'light' ? themeParam : 'system'

try {
  const raw = localStorage.getItem(SETTINGS_KEY)
  const parsed = raw ? JSON.parse(raw) : {}
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...parsed, language: lang, theme }))
} catch {
  // A blocked localStorage just means the app falls back to its defaults — fine for a demo.
}
