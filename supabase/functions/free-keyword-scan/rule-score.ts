/**
 * THE RULE-BASED ATS SCORE, READ IN THE RÉSUMÉ'S OWN LANGUAGE (register NB-1).
 *
 * Pure (no Deno APIs): index.ts imports it and the tests run it.
 *
 * The free scan clamps the AI's score to within 12 points of this number and
 * draws the score band from it (index.ts), so every report's headline lives
 * within reach of it. It measures four things: quantification (bullets with a
 * number), keyword coverage (the field's primary terms), length (word count)
 * and section structure.
 *
 * WHAT WAS WRONG. Three of the four could only be read in English. The section
 * words were experience / education / skills and their English neighbours,
 * the keyword lists are English with Spanish terms for 16 fields, and length
 * counted words, which a compounding language like German has fewer of. The
 * same strong nurse's CV scored 62 in English, 37 in Spanish and 33 in German,
 * so whatever the AI read, the Spanish headline was held at 49 and the German
 * at 45, about 25 points under the English one, with nothing on the page
 * saying why. The site sells the scan in eight languages besides English.
 *
 * WHEN A CV IS READ IN ITS OWN LANGUAGE. Two things must hold:
 *   - the language detector names one of the report's supported languages
 *     other than English (es fr de pt nl it hi tl), at any confidence;
 *   - the CV carries that language's own section words (below) in at least
 *     OWN_LANGUAGE_MIN_SECTIONS of the three sections, counting only words
 *     that are not also English words ("Formation", "licence", "techniques",
 *     "Diploma", "Master" are English too).
 * The second is the CV's own evidence, and it is what keeps an English CV the
 * detector misreads on today's score: US place names supply Spanish list
 * words (Los Angeles, Las Vegas, Ciudad Juárez), and a CV that names them can
 * be named Spanish at high confidence; such a CV carries no Spanish section
 * word, or one ("Universidad" in a school's name), so it is read as before.
 * A CV with a Spanish summary over an English body is read as before too. All
 * the fixtures' translations, and an English-headed CV with a Spanish body,
 * carry two or three.
 *
 * WHAT IT DOES THEN.
 *   - quantification is read as before: digits are the same in every language.
 *   - length is read in English-sized words: the word count, or the letters
 *     and marks over CHARS_PER_ENGLISH_WORD if that is more, and never scores
 *     below the word count's band (the bands fall again past the top one).
 *     The fixtures' German CVs run 6-17% fewer words than their English
 *     originals but 10-18% more letters, and the fewer words crossed a length
 *     band (3.75 points); Spanish and French have more words than letters /
 *     6.2 and are counted as before.
 *   - structure also accepts the language's own section words, which mirror
 *     the English ones word for word (Berufserfahrung, Formación académica,
 *     Compétences...). Not dated positions: an English CV with no section word
 *     gets no credit for its dates, so its translation must not get any either.
 *   - keyword coverage counts what the lists do find (a Spanish term, a tool
 *     name like Python or SAP), but never less than the share an English CV of
 *     the same length typically reaches: UNREAD_KEYWORD_RATE of its field's
 *     primary terms per English-sized word, up to UNREAD_KEYWORD_HITS, and at
 *     most UNREAD_KEYWORD_CAP percent of the list. A field with no list (an
 *     unclassified CV, 'general') counts no coverage, as it does in English.
 *
 * WHAT IT MEANS FOR THE SCORE. Every part is at least what the English reading
 * gives, so no CV scores lower than it did. Above the English reading a CV
 * read in its own language gains at most 0.35 x UNREAD_KEYWORD_CAP (11.7) on
 * keywords, 0.20 x the structure points the English words missed, and 0.15 x
 * one length step. For CVs of typical strength (the fixtures' nurse, engineer,
 * accountant, salesperson and teacher, 133-301 words) the translation lands
 * within 5 points of the English original in its own field. The unread share
 * is an assumption, not a reading, so it cannot follow a CV that names few of
 * its field's terms: the fixtures' thin cashier (50 words, none of the 27
 * retail terms) scores 35 in English at mid and 5-7 more in translation at
 * every seniority, where before
 * the fix it scored 14-20 less; and a long CV that names none of its terms is
 * credited the full share (11.7 points) all the same.
 *
 * WHY THE RATE IS 12 PER 160 WORDS. English CVs name their field's terms at a
 * fairly steady rate whatever the list's length: the cv-matching corpus's
 * English CVs in a field the detector names right (98-122 words) 5-12 of
 * them, 0.075 a word at the median; the fixtures' five English CVs (155-243
 * words) 11-14. Twelve at 160 words is 0.075 a word, and real CVs are longer
 * than both. One share of the list for
 * every field would credit the 76-term finance list far above the 9-14%
 * English CVs reached on it. The cap keeps a short list (17-27 terms) from
 * being credited more than the 22-37% English CVs reached on the 27-term ones.
 * Production can settle the constants: index.ts prints the hits, the list
 * length, the language and the reading for every scan.
 *
 * WHAT IS UNCHANGED. A CV read in English, which is one the detector calls
 * English, 'unknown', a language the report is not built for (Polish,
 * Russian, Chinese...), or a supported language without its own section words,
 * is read exactly as before, expression for expression; the test holds it to
 * a frozen copy of the old function. A 'general' CV still scores no keyword
 * coverage in any language: making it neutral would change English scores,
 * and that is a separate decision.
 */
import { INDUSTRY_KEYWORDS } from "./industry-detection.ts";
import { resumeHasTerm } from "./term-presence.ts";
import { detectResumeLanguage, SUPPORTED_LANGUAGES } from "./resume-language.ts";
import { countWords, SECTION_WORDS } from "./resume-structure.ts";

/** The seniority the length and quantification bars relax for ('entry' | 'mid' | 'senior' | 'executive'). */
export interface RuleScoreSeniority {
  level: string;
}

/** The most of its field's primary terms the unread share assumes (see the header). */
export const UNREAD_KEYWORD_HITS = 12;
/** Primary terms an English CV typically names per word: 12 at 160 words. */
export const UNREAD_KEYWORD_RATE = 12 / 160;
/** The most of a list, in percent, that the unread share credits. */
export const UNREAD_KEYWORD_CAP = 100 / 3;
/** Letters and marks per English word, about (the fixtures' English CVs run 5.5-5.9). */
export const CHARS_PER_ENGLISH_WORD = 6.2;
/** Of the three sections, how many must carry the language's own words. */
export const OWN_LANGUAGE_MIN_SECTIONS = 2;

export interface RuleScoreParts {
  /** The rule-based ATS score, 20-90. */
  score: number;
  /** 'own-language' when the CV was read in its own language (see the header); else 'english'. */
  readIn: "english" | "own-language";
  /** The language code the detector named for the CV. */
  language: string;
  /** In how many of the three sections the language's own words (not English ones) were found; 0 for English. */
  ownSections: number;
  quantScore: number;
  primaryHits: number;
  primaryTotal: number;
  keywordCoverage: number;
  /**
   * English-sized words for a CV read in its own language (the word count, or
   * letters / CHARS_PER_ENGLISH_WORD if more); the word count otherwise. The
   * unread share reads it, and the length reads it beside the word count.
   */
  lengthWords: number;
  lengthScore: number;
  structureScore: number;
  hasExperience: boolean;
  hasEducation: boolean;
  hasSkills: boolean;
}

/** True when the language is one the score can read a CV in: a supported language that is not English. */
export function readsInOwnLanguage(language: string): boolean {
  return language !== "en" && SUPPORTED_LANGUAGES.includes(language);
}

type SectionWords = { experience: readonly string[]; education: readonly string[]; skills: readonly string[] };

/**
 * Each language's words for the three sections the English reading looks for,
 * lower case, held in resume-structure.ts beside each language's summary
 * words so every reader of a résumé's sections reads the same table (register
 * NB-6). They mirror the English pattern: experience, employment, work
 * history, career / education, degree, university, college, bachelor, master,
 * phd / skills, technologies, technical, competencies, tools. A word starting
 * with "-" may end a compound (German Berufserfahrung, Dutch werkervaring);
 * every other word stands on its own.
 */
export { SECTION_WORDS };

/**
 * Section words above that are English words too. Once a CV is read in its
 * language they count for their section; they are never evidence that it is
 * in that language (an English CV says "Diploma", "driving licence",
 * "techniques", "formation").
 */
export const ALSO_ENGLISH_WORDS: ReadonlySet<string> = new Set([
  "formation", "formations", "licence", "technique", "techniques", "technologies", "master", "bachelor", "diploma",
]);

// A letter, mark or digit: a word's edge is anything else. Not \b, which only
// knows ASCII letters (it finds no edge before the é of "éducation"); the
// marks keep a Devanagari vowel sign from ending a word. Both sides are NFC so
// a PDF's decomposed accent (e + U+0301) reads as the word it spells.
const EDGE = "[\\p{L}\\p{M}\\p{N}]";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NEVER = /(?!)/;
const anyWordOf = (words: readonly string[]) => words.length === 0 ? NEVER : new RegExp(
  words.map((w) => w.normalize("NFC")).map((w) => w.startsWith("-")
    ? `${escapeRe(w.slice(1))}(?!${EDGE})`
    : `(?<!${EDGE})${escapeRe(w)}(?!${EDGE})`).join("|"),
  "u",
);
type SectionPatterns = { experience: RegExp; education: RegExp; skills: RegExp };
const patternsOf = (w: SectionWords, keep: (word: string) => boolean): SectionPatterns => ({
  experience: anyWordOf(w.experience.filter(keep)),
  education: anyWordOf(w.education.filter(keep)),
  skills: anyWordOf(w.skills.filter(keep)),
});
const SECTION_PATTERNS: Record<string, SectionPatterns> = Object.fromEntries(
  Object.entries(SECTION_WORDS).map(([lang, w]) => [lang, patternsOf(w, () => true)]),
);
const EVIDENCE_PATTERNS: Record<string, SectionPatterns> = Object.fromEntries(
  Object.entries(SECTION_WORDS).map(([lang, w]) => [lang, patternsOf(w, (word) => !ALSO_ENGLISH_WORDS.has(word.replace(/^-/, "")))]),
);
const sectionsFound = (p: SectionPatterns, folded: string) =>
  [p.experience, p.education, p.skills].filter((re) => re.test(folded)).length;

/**
 * In how many of the three sections the CV carries the language's own words,
 * leaving out the ones that are English words too; 0 for English, 'unknown'
 * and the languages the report is not built for.
 */
export function ownLanguageSections(resumeText: string, language: string): number {
  if (!readsInOwnLanguage(language)) return 0;
  return sectionsFound(EVIDENCE_PATTERNS[language], resumeText.normalize("NFC").toLowerCase());
}

/**
 * True when the rule score reads this CV in its own language: the detector
 * named a supported language other than English and the CV carries that
 * language's own section words in at least two of the three sections. index.ts
 * keys the report cache on it too.
 */
export function readsResumeInOwnLanguage(resumeText: string, language: string): boolean {
  return ownLanguageSections(resumeText, language) >= OWN_LANGUAGE_MIN_SECTIONS;
}

/**
 * Rule-based ATS score (20-90) and its parts. Measures quantification,
 * industry keyword coverage, résumé length and section structure.
 * Seniority-adjusted: executives get relaxed length/quant penalties.
 * `language` is the detector's code for the résumé (index.ts passes the one it
 * already computed); left out, the résumé is detected here.
 */
export function ruleBasedAtsParts(
  resumeText: string,
  industry: string,
  seniority?: RuleScoreSeniority,
  language: string = detectResumeLanguage(resumeText).language,
): RuleScoreParts {
  const lines = resumeText.split('\n').map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l =>
    l.startsWith('•') || l.startsWith('-') || l.startsWith('*') ||
    /^[•‣◦⁃∙]/.test(l) || (l.length > 30 && l.length < 300)
  );

  const level = seniority?.level ?? 'mid';
  const ownSections = ownLanguageSections(resumeText, language);
  const ownLanguage = ownSections >= OWN_LANGUAGE_MIN_SECTIONS;
  const own = ownLanguage ? SECTION_PATTERNS[language] : undefined;
  const ownText = own ? resumeText.normalize("NFC").toLowerCase() : "";

  // Quantification: % of bullets containing a number.
  // Executives rely more on narrative scope than bullet metrics — relax the weight.
  const bulletsWithMetrics = bullets.filter(b => /\d/.test(b)).length;
  const rawQuantPct = bullets.length > 0 ? (bulletsWithMetrics / Math.max(bullets.length, 1)) * 100 : 40;
  // Executives with any metrics get a floor boost; entry-level get a floor so sparse resumes aren't crushed.
  const quantScore =
    level === 'executive' ? Math.max(rawQuantPct, 45)
    : level === 'entry' ? Math.max(rawQuantPct, 30)
    : rawQuantPct;

  // Length, in words; in its own language, in English-sized words (header).
  // Han and kana count at countWords' rate (S14X-117): a Chinese CV has no
  // spaces between its words. A text without them counts as it always did.
  const words = countWords(resumeText);
  const englishSizedWords = ownLanguage
    ? Math.max(words, resumeText.normalize("NFC").replace(/\s/g, "").length / CHARS_PER_ENGLISH_WORD)
    : words;

  // Industry keyword coverage
  const kwList = INDUSTRY_KEYWORDS[industry];
  // Whole tokens only (S13-004): "or" is not in "for", "icu" not in "curriculum".
  const primaryHits = kwList ? kwList.primary.filter(kw => resumeHasTerm(resumeText, kw)).length : 0;
  const primaryTotal = kwList ? Math.max(kwList.primary.length, 1) : 1;
  const readCoverage = (primaryHits / primaryTotal) * 100;
  // In its own language the lists cannot read the CV: what they find counts,
  // and what they cannot read is an English CV of its length's share (header).
  // No list, no share: 'general' counts none in any language.
  const unreadHits = Math.min(UNREAD_KEYWORD_HITS, englishSizedWords * UNREAD_KEYWORD_RATE);
  const keywordCoverage = ownLanguage && kwList
    ? Math.max(readCoverage, Math.min(UNREAD_KEYWORD_CAP, (unreadHits / primaryTotal) * 100))
    : readCoverage;

  // Length: optimal depends on seniority
  const lengthOf = (wordCount: number) =>
    level === 'executive'
      // Executives can have 2-3 page resumes (600-1500 words) — don't penalize
      ? (wordCount < 200 ? 40 : wordCount < 400 ? 65 : wordCount < 1800 ? 85 : 70)
    : level === 'entry'
      // Entry: 1 page ideal (300-500 words)
      ? (wordCount < 100 ? 25 : wordCount < 250 ? 55 : wordCount < 700 ? 85 : 65)
    : (wordCount < 150 ? 30 : wordCount < 300 ? 55 : wordCount < 1100 ? 85 : 65);
  // The bands fall again past the top one (a 1,100-word CV is long), so the
  // English-sized count only ever lifts: the better of the two readings. In
  // English the two are the same count.
  const lengthScore = Math.max(lengthOf(words), lengthOf(englishSizedWords));

  // Section structure: the English words, and in its own language that language's.
  const hasExperience = /\b(experience|employment|work history|career)\b/i.test(resumeText) || (!!own && own.experience.test(ownText));
  const hasEducation = /\b(education|degree|university|college|bachelor|master|phd)\b/i.test(resumeText) || (!!own && own.education.test(ownText));
  const hasSkills = /\b(skills|technologies|technical|competencies|tools)\b/i.test(resumeText) || (!!own && own.skills.test(ownText));
  // Executives don't always have a skills section — relax that penalty
  const structureScore = level === 'executive'
    ? (hasExperience ? 55 : 0) + (hasEducation ? 45 : 0)
    : (hasExperience ? 40 : 0) + (hasEducation ? 30 : 0) + (hasSkills ? 30 : 0);

  const raw = quantScore * 0.30 + keywordCoverage * 0.35 + lengthScore * 0.15 + structureScore * 0.20;
  return {
    score: Math.round(Math.max(20, Math.min(90, raw))),
    readIn: ownLanguage ? "own-language" : "english",
    language,
    ownSections,
    quantScore,
    primaryHits,
    primaryTotal,
    keywordCoverage,
    lengthWords: englishSizedWords,
    lengthScore,
    structureScore,
    hasExperience,
    hasEducation,
    hasSkills,
  };
}

/** The rule-based ATS score alone (see ruleBasedAtsParts). */
export function calculateRuleBasedAtsScore(
  resumeText: string,
  industry: string,
  seniority?: RuleScoreSeniority,
  language?: string,
): number {
  return ruleBasedAtsParts(resumeText, industry, seniority, language).score;
}
