/**
 * i18next initialisation.
 *
 * The UI ships in English and Japanese, and every string goes through i18next (never
 * hard-coded), so further languages can be added later just by supplying a dictionary.
 * Resources are bundled inline rather than fetched, which makes initialisation synchronous —
 * hence Suspense is turned off, and importing this module for its side effect (see
 * `main.tsx`) is enough to have translations ready before the app renders.
 *
 * The starting language is the user's saved choice, or the browser's language on a first
 * visit (see {@link loadSettings}). Reading it here, before React mounts, means the app
 * renders in the right language from the first frame rather than flashing English first.
 * The settings provider keeps i18next in step afterwards when the user changes it.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { loadSettings } from '@/lib/settings'
import en from './locales/en'
import ja from './locales/ja'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ja: { translation: ja } },
  lng: loadSettings().language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes interpolated values.
  react: { useSuspense: false },
})

export default i18n
