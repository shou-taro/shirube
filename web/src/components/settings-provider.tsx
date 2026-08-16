import { type ReactNode, useEffect, useState } from 'react'

import i18n from '@/i18n'
import { loadSettings, type Settings, SettingsContext } from '@/lib/settings'
import { SETTINGS_KEY } from '@/lib/storage'

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

  // Switch the interface language, and mark it on the document for assistive tech and the
  // browser's own text handling. i18next starts in this language (see i18n init); this keeps
  // it in step with a later change.
  useEffect(() => {
    void i18n.changeLanguage(settings.language)
    document.documentElement.lang = settings.language
  }, [settings.language])

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
