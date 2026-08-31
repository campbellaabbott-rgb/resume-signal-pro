








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







export function buildLanguageInstruction(language: string | undefined): string {
  if (!language || language === "en") return "";
  const name = LANGUAGE_NAMES[language] || language;
  return `\n\nRespond entirely in ${name}. Every field in your output — all text, labels, and explanations — must be written in ${name}, not English.`;
}
