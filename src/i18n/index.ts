import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Only English ships in the initial bundle — it's both the fallback language and
// almost always the detected one. Every other locale (~24-44KB raw JSON each) is
// fetched on demand below once the actual language is known, instead of forcing
// every visitor to download all 9 locale files regardless of which one they use.
import en from './locales/en.json';

export const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'en-GB', name: 'English (UK)', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'tl', name: 'Tagalog', flag: '🇵🇭' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'fr-CA', name: 'Français (Canada)', flag: '🇨🇦' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
];

// Get supported language codes
const supportedLanguages = languages.map(l => l.code);

// Normalize language code to supported variant
// e.g., fr-CA uses fr translations, es-MX uses es, etc.
export function normalizeLanguageCode(code: string): string {
  // If exact match, use it
  if (supportedLanguages.includes(code)) {
    return code;
  }
  
  // Try base language (e.g., fr-CA → fr)
  const baseCode = code.split('-')[0];
  if (supportedLanguages.includes(baseCode)) {
    return baseCode;
  }
  
  // Fallback to English
  return 'en';
}

// Custom language detector that normalizes codes
const customLanguageDetector = {
  name: 'customLocalStorage',
  lookup() {
    const stored = localStorage.getItem('i18nextLng');
    if (stored) {
      return normalizeLanguageCode(stored);
    }
    return undefined;
  },
  cacheUserLanguage(lng: string) {
    localStorage.setItem('i18nextLng', lng);
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    load: 'currentOnly', // Don't load region variants automatically
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

// Lazy loaders for every locale besides English. fr-CA reuses the fr translations
// (same as the old static resources map did), so it loads the same file.
const lazyLocaleLoaders: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  'en-GB': () => import('./locales/en-GB.json'),
  es: () => import('./locales/es.json'),
  hi: () => import('./locales/hi.json'),
  tl: () => import('./locales/tl.json'),
  de: () => import('./locales/de.json'),
  fr: () => import('./locales/fr.json'),
  'fr-CA': () => import('./locales/fr.json'),
  nl: () => import('./locales/nl.json'),
  pt: () => import('./locales/pt.json'),
};

// Changelog entries are ~80KB per locale — 30% of the whole file — and only
// /changelog ever renders them. They load on demand instead of riding in the
// bundle every visitor downloads before the board can paint (measured
// 2026-07-26: 270KB en.json, 81KB of it release notes).
const changelogLoaders: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('../i18n/changelog/en.json'),
  'en-GB': () => import('../i18n/changelog/en-GB.json'),
  es: () => import('../i18n/changelog/es.json'),
  hi: () => import('../i18n/changelog/hi.json'),
  tl: () => import('../i18n/changelog/tl.json'),
  de: () => import('../i18n/changelog/de.json'),
  fr: () => import('../i18n/changelog/fr.json'),
  'fr-CA': () => import('../i18n/changelog/fr.json'),
  nl: () => import('../i18n/changelog/nl.json'),
  pt: () => import('../i18n/changelog/pt.json'),
};
const changelogLoaded = new Set<string>();

/** Pull in the changelog strings for a language. Called by the /changelog
 *  route; safe to call repeatedly and safe to fail (the page falls back to
 *  English, and English itself is one small fetch). */
export async function loadChangelogStrings(lng?: string): Promise<void> {
  const target = lng ?? i18n.language ?? 'en';
  for (const code of [target, 'en']) {
    if (!code || changelogLoaded.has(code)) continue;
    const loader = changelogLoaders[code];
    if (!loader) continue;
    try {
      const mod = await loader();
      // deep merge: the bundle already holds this locale's other namespaces
      i18n.addResourceBundle(code, 'translation', mod.default, true, true);
      changelogLoaded.add(code);
    } catch (e) {
      console.warn(`[i18n] changelog strings failed for "${code}":`, e);
    }
  }
  if (i18n.language === target) i18n.emit('languageChanged', target);
}

async function loadLocale(lng: string): Promise<void> {
  if (lng === 'en' || i18n.hasResourceBundle(lng, 'translation')) return;

  const loader = lazyLocaleLoaders[lng];
  if (!loader) return;

  try {
    const module = await loader();
    i18n.addResourceBundle(lng, 'translation', module.default);
    // If this is still the active language, trigger a re-render with the
    // now-available translations (changeLanguage emits 'languageChanged').
    if (i18n.language === lng) {
      await i18n.changeLanguage(lng);
    }
  } catch (e) {
    console.warn(`[i18n] Failed to load locale "${lng}":`, e);
  }
}

// Load whatever language was detected on init (no-op if it's English).
loadLocale(i18n.language);

// Debug: Log current language on init
if (import.meta.env.DEV) {
  console.log('[i18n] Initialized with language:', i18n.language);
}

// Listen for language changes and persist + lazy-load the bundle if needed
// (covers the user explicitly switching languages via the language picker).
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18nextLng', lng);
  loadLocale(lng);
  if (import.meta.env.DEV) {
    console.log('[i18n] Language changed to:', lng);
  }
});

export default i18n;
