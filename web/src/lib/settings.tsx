import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

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

const DEFAULTS: Settings = {
  theme: 'system',
  showViewDependencies: true,
  defaultView: 'neighbourhood',
  detailWidth: DETAIL_PANE.default,
  navigatorWidth: NAVIGATOR_PANE.default,
}

/** Read settings from storage, filling any missing keys with defaults. */
function loadSettings(): Settings {
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

interface SettingsContextValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

/**
 * Holds the user's settings, persists them, and keeps the document's theme in step —
 * toggling the ``dark`` class on the root element, and following the OS while the theme
 * is set to "system". Wrap the app in this so any component can read or change settings.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    // Only track the OS while actually following it.
    if (settings.theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [settings.theme])

  function update(patch: Partial<Settings>): void {
    setSettings((current) => ({ ...current, ...patch }))
  }

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}

/** Read and update the user's settings. Must be used within a {@link SettingsProvider}. */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (context === null) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
