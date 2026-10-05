// Pure, dependency-free helper shared by every generate-* edge function.
// No imports on purpose — importable both by the Deno edge functions
// (relative import) and by Node/vitest regression tests.
//
// The free-scan functions already instruct the AI to respond in the user's
// language; the paid-product generation functions never did, so every paid
// product was English-only regardless of the site's selected language —
// even though the free scan that led the customer there often wasn't.

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  "en-GB": "British English",
  es: "Spanish",
  hi: "Hindi",
  tl: "Tagalog",
  de: "German",
  fr: "French",
  "fr-CA": "Canadian French",
  nl: "Dutch",
  pt: "Portuguese",
};

/**
 * A locale code as a browser or i18next writes one ("de", "pt-BR", "zh-Hant-TW").
 * Anything else -- a sentence, an instruction, a 50 KB string -- is not a
 * language and is dropped: `language` arrives in the request body of public
 * model endpoints and used to be interpolated into the system prompt verbatim,
 * at any length (defect sweep 1.64, input bounds).
 */
const LOCALE_SHAPE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

/**
 * Builds the instruction line to append to a system prompt so the AI responds
 * in the user's selected language. Returns an empty string for English (the
 * default/fallback), since prompts are already written in English and an
 * explicit "respond in English" instruction would just be noise.
 */
export function buildLanguageInstruction(language: unknown): string {
  if (typeof language !== "string") return "";
  const code = language.trim();
  if (!code || code === "en") return "";
  const base = code.split("-")[0];
  if (!LANGUAGE_NAMES[code] && base === "en") return "";
  const name = LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES[base] ?? (LOCALE_SHAPE.test(code) ? code : null);
  if (!name) return "";
  return `\n\nRespond entirely in ${name}. Every field in your output — all text, labels, and explanations — must be written in ${name}, not English.`;
}
