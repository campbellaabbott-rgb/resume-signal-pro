// The interface languages, with no i18next import, so data modules the
// prerender bake bundles with esbuild (src/data/competitors.ts,
// src/data/tool-landings.ts) can count them. Relative imports only there:
// the bake knows no "@/" alias.

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

/** Distinct interface languages (en-GB and fr-CA are regional variants): the number copy may print. */
export const LANGUAGE_COUNT = new Set(languages.map((l) => l.code.split("-")[0])).size;
