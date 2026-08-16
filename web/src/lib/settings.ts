import { createContext, useContext } from 'react'

import { clampPaneWidth, DETAIL_PANE, NAVIGATOR_PANE } from '@/lib/panes'
import { SETTINGS_KEY } from '@/lib/storage'

/** How the app chooses light or dark: fixed, or following the operating system. */
export type Theme = 'light' | 'dark' | 'system'

/** What the ER map shows on first load: the centre's neighbourhood, or the whole schema. */
export type DefaultView = 'neighbourhood' | 'all'

/** The languages the interface ships in. */
export type Language = 'en' | 'ja'

export const LANGUAGES: readonly Language[] = ['en', 'ja']

/**
 * The best language for a first-time visitor: Japanese for a Japanese browser, English for
 * everyone else. Only a first guess — once the user has settings saved (or picks a language
 * in Settings), that stored choice wins and the browser is no longer consulted.
 */
export function detectLanguage(): Language {
  return navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

/** User preferences, persisted across sessions. */
export interface Settings {
  theme: Theme
  /** The interface language. Seeded from the browser on a first visit, then user-controlled. */
  language: Language
  /** Draw the dashed view→table dependency edges (and count them in the panel). */
  showViewDependencies: boolean
  defaultView: DefaultView
  /** Width of the floating table-detail card, in pixels (see panes). */
  detailWidth: number
  /** Width of the AI navigator pane, in pixels (see panes). */
  navigatorWidth: number
}

export const DEFAULTS: Settings = {
  theme: 'system',
  // A static fallback only; `loadSettings` seeds the language from the browser (see below).
  language: 'en',
  showViewDependencies: true,
  defaultView: 'neighbourhood',
  detailWidth: DETAIL_PANE.default,
  navigatorWidth: NAVIGATOR_PANE.default,
}

/** Read settings from storage, filling any missing keys with defaults. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw === null ? {} : (JSON.parse(raw) as Partial<Settings>)
    const stored = { ...DEFAULTS, ...parsed }
    // Pane widths come back as plain numbers, so hold them to their bounds — a stale or
    // hand-edited value must not leave a pane unusably narrow or wide.
    return {
      ...stored,
      // Seed the language from the browser when the user has never chosen one — including
      // older saved settings from before this field existed. A stored choice always wins.
      language: parsed.language ?? detectLanguage(),
      detailWidth: clampPaneWidth(stored.detailWidth, DETAIL_PANE),
      navigatorWidth: clampPaneWidth(stored.navigatorWidth, NAVIGATOR_PANE),
    }
  } catch {
    return { ...DEFAULTS, language: detectLanguage() }
  }
}

export interface SettingsContextValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

/** The settings context, provided by {@link SettingsProvider} and read via {@link useSettings}. */
export const SettingsContext = createContext<SettingsContextValue | null>(null)

/** Read and update the user's settings. Must be used within a `SettingsProvider`. */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (context === null) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
