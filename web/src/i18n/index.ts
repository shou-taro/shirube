/**
 * i18next initialisation.
 *
 * The UI ships in English, but every string goes through i18next (never hard-coded), so
 * further languages can be added later just by supplying a dictionary. Resources are
 * bundled inline rather than fetched, which makes initialisation synchronous — hence
 * Suspense is turned off, and importing this module for its side effect (see
 * `main.tsx`) is enough to have translations ready before the app renders.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes interpolated values.
  react: { useSuspense: false },
})

export default i18n
