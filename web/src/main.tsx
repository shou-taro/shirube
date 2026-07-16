import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { SettingsProvider } from '@/lib/settings'
import App from './App.tsx'
import './index.css'
import './i18n' // Side-effect import: initialises i18next before App first renders.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
)
