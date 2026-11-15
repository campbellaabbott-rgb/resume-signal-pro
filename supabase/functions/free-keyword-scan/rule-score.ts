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
 * WHAT WAS WRONG. Two of the four could only be read in English. The section
 * words were experience / education / skills and their English neighbours,
 * and the keyword lists are English with Spanish terms for 16 fields. The same
 * strong nurse's CV scored 62 in English, 37 in Spanish and 33 in German, so
 * whatever the AI read, the Spanish headline was held at 49 and the German at
 * 45, about 25 points under the English one, with nothing on the page saying
 * why. The site sells the scan in eight languages besides English.
 *
 * WHAT IT DOES NOW. A CV the language detector names as one of the report's
 * supported languages other than English (es fr de pt nl it hi tl) is read in
 * that language:
 *   - quantification and length are read as before. Digits are the same in
 *     every language. Word counts differ a little (German CVs ran 6-17% shorter
 *     than their English originals in the fixtures, Spanish and French 10-24%
 *     longer), which can move a CV across one length band: 3.75 points.
 *   - structure also accepts the language's own section words, which mirror
 *     the English ones word for word (Berufserfahrung, Formación académica,
 *     Compétences...). Not dated positions: an English CV with no section word
 *     gets no credit for its dates, so its translation must not get any either.
 *   - keyword coverage counts what the lists do find (a Spanish term, a tool
 *     name like Python or SAP), but never less than the share an English CV of
 *     the field typically reaches: UNREAD_KEYWORD_HITS of the field's primary
 *     terms, at most UNREAD_KEYWORD_CAP percent of the list. A field with no
 *     list (an unclassified CV, 'general') gets the cap.
 * Every part is at least what the English reading gives, so no CV scores lower
 * than it did. An English CV the detector misread as one of these languages
 * would gain at most 0.35 x UNREAD_KEYWORD_CAP on the keyword share (11.7
 * points, 12 after rounding: the clamp's own width); it already has its
 * English section words.
 * Over the S13-024 language corpora (nearly 4,000 English-labelled texts, 917
 * of them terse lists) no English text was named as a supported non-English
 * language at any confidence (the three that were, two postings, are in fact
 * Spanish and French), while 51 genuinely non-English texts of the corpus and
 * its held-out set were named only at 'low' confidence; so 'low' counts, and
 * the bar is the detector's own.
 *
 * WHY UNREAD_KEYWORD_HITS IS 12. English CVs name a fairly steady number of
 * their field's terms whatever the list's length: the cv-matching corpus's
 * twelve correctly classified CVs (~110 words) a median of 8.5, the three
 * English CVs of src/test/fixtures/one-cv-in-several-languages.ts (160-240
 * words) 11, 13 and 14; real CVs are longer than both. One share of the list
 * for every field would credit the 76-term finance list far above the 9-14%
 * English CVs reached on it. The cap keeps a short list (17-27 terms) from
 * being credited more than the 22-37% English CVs reached on the 27-term ones.
 * Production can settle the constant: index.ts prints the hits and the list
 * length for every scan.
 *
 * WHAT IS UNCHANGED. A CV the detector calls English, 'unknown', or a language
 * the report is not built for (Polish, Russian, Chinese...) is read exactly as
 * before, expression for expression; the test holds it to a frozen copy of the
 * old function. An English 'general' CV still scores no keyword coverage: that
 * is today's English score, and changing it is a separate decision.
 */
import { INDUSTRY_KEYWORDS } from "./industry-detection.ts";
import { resumeHasTerm } from "./term-presence.ts";
import { detectResumeLanguage, SUPPORTED_LANGUAGES } from "./resume-language.ts";

/** The seniority the length and quantification bars relax for ('entry' | 'mid' | 'senior' | 'executive'). */
export interface RuleScoreSeniority {
  level: string;
}

/** How many of its field's primary terms an English CV typically names (see the header). */
export const UNREAD_KEYWORD_HITS = 12;
/** The most of a list, in percent, that the unread keyword share credits. */
export const UNREAD_KEYWORD_CAP = 100 / 3;

export interface RuleScoreParts {
  /** The rule-based ATS score, 20-90. */
  score: number;
  /** 'own-language' when the CV is in a supported language other than English and was read in it. */
  readIn: "english" | "own-language";
  /** The language code the score was read for. */
  language: string;
  quantScore: number;
  primaryHits: number;
  primaryTotal: number;
  keywordCoverage: number;
  lengthScore: number;
  structureScore: number;
  hasExperience: boolean;
  hasEducation: boolean;
  hasSkills: boolean;
}

/** True when the score reads the CV in its own language: a supported language that is not English. */
export function readsInOwnLanguage(language: string): boolean {
  return language !== "en" && SUPPORTED_LANGUAGES.includes(language);
}

type SectionWords = { experience: readonly string[]; education: readonly string[]; skills: readonly string[] };

/**
 * Each language's words for the three sections the English reading looks for,
 * lower case. They mirror the English pattern: experience, employment, work
 * history, career / education, degree, university, college, bachelor, master,
 * phd / skills, technologies, technical, competencies, tools. A word starting
 * with "-" may end a compound (German Berufserfahrung, Dutch werkervaring);
 * every other word stands on its own.
 */
export const SECTION_WORDS: Record<string, SectionWords> = {
  es: {
    experience: ["experiencia", "experiencias", "empleo", "empleos", "historial laboral", "trayectoria", "carrera profesional"],
    education: ["educación", "formación", "estudios", "título", "titulación", "universidad", "licenciatura", "grado", "máster", "maestría", "doctorado"],
    skills: ["habilidades", "competencias", "conocimientos", "tecnologías", "técnico", "técnica", "técnicos", "técnicas", "herramientas"],
  },
  fr: {
    experience: ["expérience", "expériences", "emploi", "emplois", "parcours professionnel", "carrière"],
    education: ["éducation", "formation", "formations", "études", "diplôme", "diplômes", "université", "licence", "master", "doctorat"],
    skills: ["compétences", "connaissances", "technologies", "technique", "techniques", "outils", "savoir-faire"],
  },
  de: {
    experience: ["-erfahrung", "-erfahrungen", "beschäftigung", "werdegang", "laufbahn", "karriere"],
    education: ["-ausbildung", "bildungsweg", "schulbildung", "-studium", "abschluss", "-universität", "-hochschule", "bachelor", "master", "diplom"],
    skills: ["-kenntnisse", "-fähigkeiten", "-kompetenzen", "kompetenz", "technologien", "technisch", "technische", "technischen", "werkzeuge"],
  },
  pt: {
    experience: ["experiência", "experiências", "emprego", "empregos", "histórico profissional", "trajetória", "carreira"],
    education: ["educação", "formação", "escolaridade", "graduação", "universidade", "faculdade", "bacharelado", "licenciatura", "mestrado", "doutorado"],
    skills: ["habilidades", "competências", "conhecimentos", "tecnologias", "técnico", "técnica", "técnicos", "técnicas", "ferramentas"],
  },
  nl: {
    experience: ["-ervaring", "werkgeschiedenis", "loopbaan", "carrière"],
    education: ["-opleiding", "-opleidingen", "onderwijs", "diploma", "universiteit", "hogeschool", "bachelor", "master"],
    skills: ["-vaardigheden", "competenties", "kennis", "technologieën", "technisch", "technische", "hulpmiddelen"],
  },
  it: {
    experience: ["esperienza", "esperienze", "impiego", "carriera", "percorso professionale"],
    education: ["istruzione", "formazione", "laurea", "università", "diploma", "master", "dottorato", "titolo di studio"],
    skills: ["competenze", "conoscenze", "capacità", "tecnologie", "tecnico", "tecnica", "tecnici", "tecniche", "strumenti"],
  },
  hi: {
    experience: ["अनुभव", "रोज़गार", "रोजगार", "करियर"],
    education: ["शिक्षा", "डिग्री", "विश्वविद्यालय", "महाविद्यालय", "कॉलेज", "स्नातक"],
    skills: ["कौशल", "तकनीकी", "तकनीक", "उपकरण"],
  },
  tl: {
    experience: ["karanasan", "trabaho", "hanapbuhay"],
    education: ["edukasyon", "pag-aaral", "unibersidad", "kolehiyo", "paaralan"],
    skills: ["kasanayan", "kakayahan", "teknikal"],
  },
};

// A letter, mark or digit: a word's edge is anything else. Not \b, which only
// knows ASCII letters (it finds no edge before the é of "éducation"); the
// marks keep a Devanagari vowel sign from ending a word. Both sides are NFC so
// a PDF's decomposed accent (e + U+0301) reads as the word it spells.
const EDGE = "[\\p{L}\\p{M}\\p{N}]";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyWordOf = (words: readonly string[]) => new RegExp(
  words.map((w) => w.normalize("NFC")).map((w) => w.startsWith("-")
    ? `${escapeRe(w.slice(1))}(?!${EDGE})`
    : `(?<!${EDGE})${escapeRe(w)}(?!${EDGE})`).join("|"),
  "u",
);
const SECTION_PATTERNS: Record<string, { experience: RegExp; education: RegExp; skills: RegExp }> = Object.fromEntries(
  Object.entries(SECTION_WORDS).map(([lang, w]) => [lang, { experience: anyWordOf(w.experience), education: anyWordOf(w.education), skills: anyWordOf(w.skills) }]),
);

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
  const ownLanguage = readsInOwnLanguage(language);
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

  // Industry keyword coverage
  const kwList = INDUSTRY_KEYWORDS[industry];
  // Whole tokens only (S13-004): "or" is not in "for", "icu" not in "curriculum".
  const primaryHits = kwList ? kwList.primary.filter(kw => resumeHasTerm(resumeText, kw)).length : 0;
  const primaryTotal = kwList ? Math.max(kwList.primary.length, 1) : 1;
  const readCoverage = (primaryHits / primaryTotal) * 100;
  // In its own language the lists cannot read the CV: what they find counts,
  // and what they cannot read is a typical English CV's share (header).
  const keywordCoverage = ownLanguage
    ? Math.max(readCoverage, kwList ? Math.min(UNREAD_KEYWORD_CAP, (UNREAD_KEYWORD_HITS / primaryTotal) * 100) : UNREAD_KEYWORD_CAP)
    : readCoverage;

  // Length: optimal depends on seniority
  const wordCount = resumeText.split(/\s+/).filter(Boolean).length;
  const lengthScore =
    level === 'executive'
      // Executives can have 2-3 page resumes (600-1500 words) — don't penalize
      ? (wordCount < 200 ? 40 : wordCount < 400 ? 65 : wordCount < 1800 ? 85 : 70)
    : level === 'entry'
      // Entry: 1 page ideal (300-500 words)
      ? (wordCount < 100 ? 25 : wordCount < 250 ? 55 : wordCount < 700 ? 85 : 65)
    : (wordCount < 150 ? 30 : wordCount < 300 ? 55 : wordCount < 1100 ? 85 : 65);

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
    quantScore,
    primaryHits,
    primaryTotal,
    keywordCoverage,
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
