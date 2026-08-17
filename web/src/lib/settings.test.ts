import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectLanguage, loadSettings } from '@/lib/settings'
import { SETTINGS_KEY } from '@/lib/storage'

// The real navigator, restored after each test. Only its `language` is stubbed below; the
// shared localStorage / matchMedia stubs from the test setup must be left in place, so this
// restores navigator alone rather than unstubbing every global.
const realNavigator = globalThis.navigator

afterEach(() => {
  localStorage.clear()
  vi.stubGlobal('navigator', realNavigator)
})

/** Point `navigator.language` at a given tag for one test. */
function stubBrowserLanguage(tag: string): void {
  vi.stubGlobal('navigator', { language: tag })
}

describe('detectLanguage', () => {
  it('chooses Japanese for a Japanese browser', () => {
    stubBrowserLanguage('ja-JP')
    expect(detectLanguage()).toBe('ja')
  })

  it('chooses Japanese for a bare "ja" tag, case-insensitively', () => {
    stubBrowserLanguage('JA')
    expect(detectLanguage()).toBe('ja')
  })

  it('falls back to English for any other browser', () => {
    stubBrowserLanguage('en-GB')
    expect(detectLanguage()).toBe('en')
  })

  it('falls back to English for an unrelated language', () => {
    stubBrowserLanguage('fr-FR')
    expect(detectLanguage()).toBe('en')
  })
})

describe('loadSettings — language', () => {
  it('seeds the language from the browser when nothing is stored', () => {
    stubBrowserLanguage('ja-JP')
    expect(loadSettings().language).toBe('ja')
  })

  it('honours a stored language over the browser', () => {
    // A Japanese browser, but the user has chosen English — the saved choice wins.
    stubBrowserLanguage('ja-JP')
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: 'en' }))
    expect(loadSettings().language).toBe('en')
  })

  it('fills in a detected language for settings saved before the field existed', () => {
    // An older stored blob with no `language` key falls back to detection, not a fixed default.
    stubBrowserLanguage('ja-JP')
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }))
    expect(loadSettings().language).toBe('ja')
  })
})
