/**
 * THE LANGUAGE A JOB POSTING IS WRITTEN IN, FOR THE DOCUMENTS SENT TO ITS EMPLOYER.
 *
 * WHAT WAS WRONG (S12-003). generate-cover-letter decided the letter's
 * language with one test: enough accented letters and Spanish-looking short
 * words made a posting "Spanish". Dutch, French, German and Portuguese
 * postings share those short words ("de", "la", "en") and accents, so 31 of
 * 36 sampled German and Dutch postings were read as Spanish, and a Dutch
 * applicant was handed a Spanish letter (and a paid order was marked
 * delivered).
 *
 * WHAT THIS DOES. Each language below has a list of words that are common in
 * job postings and rare in the other listed languages. A posting's words are
 * counted against every list, and a language is named only when it has at
 * least MIN_HITS words and leads the runner-up by LEAD_RATIO. Otherwise the
 * answer is null and the prompt asks the model to write in the posting's own
 * language, whatever it is: an unknown language is never guessed.
 *
 * Plain functions; the one import is itself import-free, so the Deno
 * functions and the Node tests both load this file.
 */
import { buildLanguageInstruction, resolveLanguageName } from "./language-instruction.ts";

export type PostingLanguage = "en" | "de" | "nl" | "fr" | "es" | "pt" | "it";

/** The name a prompt uses for each language this module can name. */
export const POSTING_LANGUAGE_NAMES: Record<PostingLanguage, string> = {
  en: "English",
  de: "German",
  nl: "Dutch",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
};

// Words that are frequent in that language's postings and do not double as a
// frequent word of another listed language. Shared short words ("de", "la",
// "en", "a", "e", "die", "que") are left out on purpose: they are exactly what
// made every Dutch posting look Spanish.
const MARKERS: Record<PostingLanguage, readonly string[]> = {
  en: ["the", "and", "with", "you", "we", "our", "your", "will", "are", "is", "this", "have", "of", "to", "for", "experience", "team", "role", "skills", "work", "who", "about"],
  de: ["und", "der", "das", "mit", "für", "wir", "sie", "ihre", "ist", "eine", "ein", "zu", "von", "bei", "auf", "den", "dem", "des", "nicht", "oder", "werden", "du", "dein", "deine", "dich", "dir", "unser", "unsere", "sowie", "erfahrung", "kenntnisse", "aufgaben", "über", "ich", "auch", "bieten", "suchen", "stelle"],
  nl: ["het", "een", "van", "voor", "wij", "je", "jouw", "jij", "ons", "onze", "zijn", "bij", "naar", "als", "ervaring", "niet", "wat", "dat", "ook", "kennis", "werkzaamheden", "functie", "bent", "heb", "hebt", "bieden", "zoeken", "werken", "goede", "jaar"],
  fr: ["et", "le", "les", "des", "du", "pour", "avec", "vous", "nous", "notre", "votre", "vos", "nos", "une", "est", "sur", "dans", "au", "aux", "ou", "qui", "être", "expérience", "poste", "équipe", "maîtrise", "sein", "rejoindre"],
  es: ["el", "los", "las", "del", "para", "y", "por", "es", "se", "nuestro", "nuestra", "nuestros", "experiencia", "puesto", "buscamos", "empresa", "tu", "sus", "al", "como", "más", "ofrecemos", "requisitos", "equipo", "trabajo", "conocimientos", "años"],
  pt: ["o", "os", "do", "da", "dos", "das", "com", "em", "uma", "um", "não", "nossa", "nosso", "você", "experiência", "vaga", "na", "ao", "é", "são", "oferecemos", "conhecimento", "equipe", "atividades", "anos", "trabalho"],
  it: ["il", "lo", "gli", "di", "della", "delle", "dei", "per", "che", "è", "non", "siamo", "nostro", "nostra", "esperienza", "lavoro", "nel", "alla", "sono", "conoscenza", "offriamo", "requisiti", "anni"],
};

const SETS = Object.fromEntries(
  Object.entries(MARKERS).map(([k, v]) => [k, new Set(v)]),
) as unknown as Record<PostingLanguage, ReadonlySet<string>>;

/** A language is named only with at least this many marker words... */
export const MIN_HITS = 6;
/** ...and at least this many times the runner-up's count. */
export const LEAD_RATIO = 1.4;

/** Every language's marker count for this text (lower-cased, split on anything that is not a letter). */
export function languageScores(text: string): Record<PostingLanguage, number> {
  const scores = { en: 0, de: 0, nl: 0, fr: 0, es: 0, pt: 0, it: 0 } as Record<PostingLanguage, number>;
  const words = String(text ?? "").slice(0, 20_000).toLowerCase().split(/[^\p{L}]+/u);
  for (const w of words) {
    if (!w) continue;
    for (const lang of Object.keys(SETS) as PostingLanguage[]) {
      if (SETS[lang].has(w)) scores[lang]++;
    }
  }
  return scores;
}

/** The posting's language, or null when no listed language clearly leads. */
export function detectPostingLanguage(text: string | null | undefined): PostingLanguage | null {
  const scores = languageScores(String(text ?? ""));
  const ranked = (Object.entries(scores) as Array<[PostingLanguage, number]>).sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || first[1] < MIN_HITS) return null;
  if (second && second[1] > 0 && first[1] < second[1] * LEAD_RATIO) return null;
  return first[0];
}

/**
 * The prompt line that sets the language of a document sent to the employer
 * (a cover letter, a tailored résumé's text, application answers). Named when
 * detected; otherwise the model is told to use the posting's own language,
 * never a guessed one. `what` names the document ("letter", "answers").
 */
export function postingLanguageInstruction(postingText: string | null | undefined, what: string): string {
  const lang = detectPostingLanguage(postingText);
  if (lang) {
    const name = POSTING_LANGUAGE_NAMES[lang];
    return `\n\nLANGUAGE: The job posting is written in ${name}. Write the entire ${what} in natural, professional ${name}, not a translation-sounding one. Keep company, product and certification names exactly as given.`;
  }
  return `\n\nLANGUAGE: Write the entire ${what} in the same language the job posting is written in. If the posting gives no clear language, use the language of the candidate's résumé. Keep company, product and certification names exactly as given.`;
}

/**
 * The language lines for a tailored résumé (S12-026). The summary, the
 * rewritten bullets, the title and the letter opening go into documents the
 * EMPLOYER reads, so they follow the posting's language (or the résumé's
 * when the posting's is unclear); the tips are advice the PERSON reads, so
 * they follow the language the page sent, when it sent one other than English.
 */
export function tailoredLanguageNote(posting: string | null | undefined, readerLanguage: unknown): string {
  const lang = detectPostingLanguage(posting ?? "");
  const docs = lang
    ? `Write professionalSummary, every "tailored" bullet, suggestedJobTitle and coverLetterOpening in ${POSTING_LANGUAGE_NAMES[lang]}, the language of the job posting.`
    : `Write professionalSummary, every "tailored" bullet, suggestedJobTitle and coverLetterOpening in the language the job posting is written in (the résumé's language if the posting's is unclear).`;
  const reader = resolveLanguageName(readerLanguage);
  const tips = reader && buildLanguageInstruction(readerLanguage) ? ` Write applicationTips in ${reader}.` : "";
  return `\n\n## LANGUAGE\n${docs}${tips} Keep every "original" bullet exactly as it is in the résumé, and keep keyword lists in the posting's own words.`;
}
