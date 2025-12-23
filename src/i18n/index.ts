import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import enGB from './locales/en-GB.json';
import es from './locales/es.json';
import hi from './locales/hi.json';
import tl from './locales/tl.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import nl from './locales/nl.json';
import pt from './locales/pt.json';

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
      'en-GB': { translation: enGB },
      es: { translation: es },
      hi: { translation: hi },
      tl: { translation: tl },
      de: { translation: de },
      fr: { translation: fr },
      'fr-CA': { translation: fr }, // fr-CA uses French translations
      nl: { translation: nl },
      pt: { translation: pt },
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

// Debug: Log current language on init
if (import.meta.env.DEV) {
  console.log('[i18n] Initialized with language:', i18n.language);
}

// Listen for language changes and persist
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18nextLng', lng);
  if (import.meta.env.DEV) {
    console.log('[i18n] Language changed to:', lng);
  }
});

export default i18n;
