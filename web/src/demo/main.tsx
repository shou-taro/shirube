import './pre' // Side effects first: install the API mock and seed language/theme.
import '@/i18n' // Then initialise i18next (reads the seeded language).
import '@/index.css'
import './demo.css' // Demo-only overrides, after the app's styles so they win.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { SettingsProvider } from '@/components/settings-provider'

import { DemoApp } from './DemoApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <DemoApp />
    </SettingsProvider>
  </StrictMode>,
)
