import { createContext, useContext } from 'react'

import { clampPaneWidth, DETAIL_PANE, NAVIGATOR_PANE } from '@/lib/panes'
import { SETTINGS_KEY } from '@/lib/storage'

/** How the app chooses light or dark: fixed, or following the operating system. */
export type Theme = 'light' | 'dark' | 'system'

/** What the ER map shows on first load: the centre's neighbourhood, or the whole schema. */
export type DefaultView = 'neighbourhood' | 'all'

/** User preferences, persisted across sessions. */
export interface Settings {
  theme: Theme
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
  showViewDependencies: true,
  defaultView: 'neighbourhood',
  detailWidth: DETAIL_PANE.default,
  navigatorWidth: NAVIGATOR_PANE.default,
}

/** Read settings from storage, filling any missing keys with defaults. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw === null) {
      return DEFAULTS
    }
    const stored = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
    // Pane widths come back as plain numbers, so hold them to their bounds — a stale or
    // hand-edited value must not leave a pane unusably narrow or wide.
    return {
      ...stored,
      detailWidth: clampPaneWidth(stored.detailWidth, DETAIL_PANE),
      navigatorWidth: clampPaneWidth(stored.navigatorWidth, NAVIGATOR_PANE),
    }
  } catch {
    return DEFAULTS
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
