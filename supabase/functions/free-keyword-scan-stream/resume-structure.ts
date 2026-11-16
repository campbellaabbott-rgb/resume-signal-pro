// Deterministic resume structure + extraction-quality analysis. Pure (no AI,
// no Deno APIs — unit-testable and importable from both scan functions as a
// byte-identical copy, like industry-detection.ts).
//
// Two jobs, both about accuracy:
//   1. computeParseQuality — is the extracted text even trustworthy? A mangled
//      PDF is the biggest SILENT accuracy killer: it yields a confidently wrong
//      report. Surfaced to the user as a warning when the parse looks bad.
//   2. parseResumeStructure / formatStructureForPrompt — a deterministic
//      scaffold (sections, dated positions, contact) injected into the AI
//      prompt so the model grounds its narrative in real structure instead of
//      misreading raw layout (the source of "missing skills section" /
//      "no contact info" / miscounted-jobs false positives).

// ── Words, in every script ────────────────────────────────────────────────
// Chinese and Japanese write no space between words, so a whole Chinese
// résumé split on spaces read as a few dozen words and was called sparse and
// "only N words extracted" (S14X-117). Their characters count at about 1.7 a
// word; every other script's words are the runs between spaces, so a text
// with no Han or kana counts exactly as it always did. Korean puts spaces
// between its words and is counted by them.
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
export const CJK_CHARS_PER_WORD = 1.7;

/** Words in a text: runs between spaces, and Han or kana characters at CJK_CHARS_PER_WORD a word. */
export function countWords(text: string): number {
  const cjk = (text.match(CJK_CHAR) || []).length;
  if (cjk === 0) return text.split(/\s+/).filter(Boolean).length;
  const rest = text.replace(CJK_CHAR, " ").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
  return rest + Math.round(cjk / CJK_CHARS_PER_WORD);
}

// ── Section words, in the languages the report is written for ─────────────
// One table for every reader of a résumé's sections (register NB-6): the
// rule score (rule-score.ts imports it), the parse-quality check, the
// structure the prompt is told, and the primary's section readers. Lower
// case. A word starting with "-" may end a compound (German
// Berufserfahrung, Dutch werkervaring); every other word stands on its own.
// The experience, education and skills lists mirror the English rule score's
// words; summary is the heading a résumé opens with.
export type SectionWordsOf = { summary: readonly string[]; experience: readonly string[]; education: readonly string[]; skills: readonly string[] };
export const SECTION_WORDS: Record<string, SectionWordsOf> = {
  es: {
    summary: ["resumen", "perfil", "perfil profesional", "objetivo", "sobre mí", "extracto"],
    experience: ["experiencia", "experiencias", "empleo", "empleos", "historial laboral", "trayectoria", "carrera profesional"],
    education: ["educación", "formación", "estudios", "título", "titulación", "universidad", "licenciatura", "grado", "máster", "maestría", "doctorado"],
    skills: ["habilidades", "competencias", "conocimientos", "tecnologías", "técnico", "técnica", "técnicos", "técnicas", "herramientas"],
  },
  fr: {
    summary: ["profil", "profil professionnel", "résumé", "à propos", "objectif", "accroche"],
    experience: ["expérience", "expériences", "emploi", "emplois", "parcours professionnel", "carrière"],
    education: ["éducation", "formation", "formations", "études", "diplôme", "diplômes", "université", "licence", "master", "doctorat"],
    skills: ["compétences", "connaissances", "technologies", "technique", "techniques", "outils", "savoir-faire"],
  },
  de: {
    summary: ["profil", "-profil", "zusammenfassung", "über mich", "zielsetzung"],
    experience: ["-erfahrung", "-erfahrungen", "beschäftigung", "werdegang", "laufbahn", "karriere"],
    education: ["-ausbildung", "bildungsweg", "schulbildung", "-studium", "abschluss", "-universität", "-hochschule", "bachelor", "master", "diplom"],
    skills: ["-kenntnisse", "-fähigkeiten", "-kompetenzen", "kompetenz", "technologien", "technisch", "technische", "technischen", "werkzeuge"],
  },
  pt: {
    summary: ["resumo", "perfil", "perfil profissional", "objetivo", "sobre mim"],
    experience: ["experiência", "experiências", "emprego", "empregos", "histórico profissional", "trajetória", "carreira"],
    education: ["educação", "formação", "escolaridade", "graduação", "universidade", "faculdade", "bacharelado", "licenciatura", "mestrado", "doutorado"],
    skills: ["habilidades", "competências", "conhecimentos", "tecnologias", "técnico", "técnica", "técnicos", "técnicas", "ferramentas"],
  },
  nl: {
    summary: ["profiel", "samenvatting", "over mij", "persoonlijk profiel"],
    experience: ["-ervaring", "werkgeschiedenis", "loopbaan", "carrière"],
    education: ["-opleiding", "-opleidingen", "onderwijs", "diploma", "universiteit", "hogeschool", "bachelor", "master"],
    skills: ["-vaardigheden", "competenties", "kennis", "technologieën", "technisch", "technische", "hulpmiddelen"],
  },
  it: {
    summary: ["profilo", "profilo professionale", "sommario", "riepilogo", "obiettivo", "chi sono"],
    experience: ["esperienza", "esperienze", "impiego", "carriera", "percorso professionale"],
    education: ["istruzione", "formazione", "laurea", "università", "diploma", "master", "dottorato", "titolo di studio"],
    skills: ["competenze", "conoscenze", "capacità", "tecnologie", "tecnico", "tecnica", "tecnici", "tecniche", "strumenti"],
  },
  hi: {
    summary: ["सारांश", "प्रोफ़ाइल", "प्रोफाइल", "परिचय", "उद्देश्य"],
    experience: ["अनुभव", "रोज़गार", "रोजगार", "करियर"],
    education: ["शिक्षा", "डिग्री", "विश्वविद्यालय", "महाविद्यालय", "कॉलेज", "स्नातक"],
    skills: ["कौशल", "तकनीकी", "तकनीक", "उपकरण"],
  },
  tl: {
    summary: ["buod", "layunin", "tungkol sa akin", "pagpapakilala"],
    experience: ["karanasan", "trabaho", "hanapbuhay"],
    education: ["edukasyon", "pag-aaral", "unibersidad", "kolehiyo", "paaralan"],
    skills: ["kasanayan", "kakayahan", "teknikal"],
  },
};

// A letter, mark or digit: a word's edge is anything else. Not \b, which only
// knows ASCII letters; the marks keep a Devanagari vowel sign from ending a
// word. Both sides are NFC so a decomposed accent reads as the word it spells.
const EDGE = "[\\p{L}\\p{M}\\p{N}]";
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordPattern = (words: readonly string[]): RegExp => new RegExp(
  words.map((w) => w.normalize("NFC")).map((w) => w.startsWith("-")
    ? `${escapeRe(w.slice(1))}(?!${EDGE})`
    : `(?<!${EDGE})${escapeRe(w)}(?!${EDGE})`).join("|"),
  "u",
);
const SECTION_PATTERNS_BY_LANGUAGE: Record<string, Record<keyof SectionWordsOf, RegExp>> = Object.fromEntries(
  Object.entries(SECTION_WORDS).map(([lang, w]) => [lang, {
    summary: wordPattern(w.summary), experience: wordPattern(w.experience), education: wordPattern(w.education), skills: wordPattern(w.skills),
  }]),
);

/**
 * True when the text carries a section word of `language` (one of
 * SECTION_WORDS' languages) for `section`; false for English and every
 * language the table does not hold, whose readers keep their English words.
 */
export function hasLanguageSectionWord(text: string, language: string | undefined, section: keyof SectionWordsOf): boolean {
  const p = language ? SECTION_PATTERNS_BY_LANGUAGE[language] : undefined;
  return !!p && p[section].test(text.normalize("NFC").toLowerCase());
}

// Section words that also open a line that is not a heading: a school, a
// degree ("Universidad de Sevilla", "Master in Finance"). They count for
// their section anywhere in a résumé, never as the first word of a heading.
const NOT_A_HEADING = new Set([
  "universidad", "université", "università", "universidade", "universiteit", "-universität", "-hochschule", "hogeschool", "faculdade",
  "unibersidad", "kolehiyo", "paaralan", "विश्वविद्यालय", "महाविद्यालय", "कॉलेज",
  "título", "titulación", "licenciatura", "grado", "máster", "maestría", "doctorado", "licence", "master", "doctorat", "diplôme", "diplômes",
  "bachelor", "diplom", "abschluss", "laurea", "diploma", "dottorato", "bacharelado", "graduação", "mestrado", "doutorado", "डिग्री", "स्नातक",
]);
const headingPattern = (words: readonly string[]): RegExp => new RegExp(
  "^(?:" + words.filter((w) => !NOT_A_HEADING.has(w)).map((w) => w.normalize("NFC")).map((w) => w.startsWith("-")
    ? `[\\p{L}\\p{M}]*${escapeRe(w.slice(1))}(?!${EDGE})`
    : `${escapeRe(w)}(?!${EDGE})`).join("|") + ")",
  "u",
);
const HEADING_PATTERNS_BY_LANGUAGE: Record<string, Record<keyof SectionWordsOf, RegExp>> = Object.fromEntries(
  Object.entries(SECTION_WORDS).map(([lang, w]) => [lang, {
    summary: headingPattern(w.summary), experience: headingPattern(w.experience), education: headingPattern(w.education), skills: headingPattern(w.skills),
  }]),
);

// English heading phrases, the whole line (NB-19): "University Hospital" and
// "Tools: Excel" inside a role are not headings; "PERSONAL STATEMENT", the
// UK's summary heading (S14X-168), is.
const ENGLISH_HEADINGS: Array<[keyof SectionWordsOf, RegExp]> = [
  ["summary", /^(?:(?:professional|executive|career|personal)\s+)?(?:summary|profile|objective)$|^personal\s+statement$|^about\s+me$/],
  ["experience", /^(?:(?:professional|work|relevant|employment|career|industry)\s+)?(?:experience|history)$|^employment(?:\s+history)?$|^work\s+history$/],
  ["skills", /^(?:(?:technical|core|key|relevant|professional)\s+)?(?:skills|competencies|technologies|tools|proficiencies)(?:\s*(?:&|and)\s*(?:tools|technologies|competencies|skills|expertise|abilities))?$/],
  ["education", /^(?:education(?:al)?|academic)(?:\s+(?:background|history|qualifications?))?(?:\s*(?:&|and)\s*(?:training|certifications?|qualifications?))?$/],
];

/** A heading line's words: no leading bullet, no trailing colon or rule, spaces collapsed, lower case. */
const headingPhraseOf = (line: string) => line.normalize("NFC").replace(/^[\s•·▪●■#*\-]+/, "").replace(/[\s:：.\-–—_=]+$/, "")
  .replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The section a heading in the résumé's own language opens (NB-6): a short
 * line (four words at most, no digits) that starts with one of SECTION_WORDS'
 * words for `language` ("Experiencia profesional", "Berufserfahrung"), or, in
 * Hindi, which puts the qualifier first, ends with one ("कार्य अनुभव"). Null
 * for English and the languages the table does not hold.
 */
export function ownLanguageHeadingOf(line: string, language: string | undefined): keyof SectionWordsOf | null {
  const p = language ? HEADING_PATTERNS_BY_LANGUAGE[language] : undefined;
  if (!p) return null;
  const phrase = headingPhraseOf(line);
  if (!phrase || phrase.length > 40 || phrase.split(" ").length > 4 || /\d/.test(phrase)) return null;
  for (const sec of ["summary", "experience", "education", "skills"] as const) {
    if (p[sec].test(phrase)) return sec;
    // Hindi puts the qualifier first ("कार्य अनुभव", work experience).
    if (language === "hi" && phrase.split(" ").length <= 3 && SECTION_PATTERNS_BY_LANGUAGE.hi[sec].test(phrase.split(" ").slice(-1)[0])) return sec;
  }
  return null;
}

/**
 * The section a whole line heads, or null (NB-19): an English heading phrase,
 * or a heading in the résumé's own language (ownLanguageHeadingOf).
 */
export function headingSectionOf(line: string, language?: string): keyof SectionWordsOf | null {
  const phrase = headingPhraseOf(line);
  if (!phrase || phrase.length > 40) return null;
  for (const [sec, re] of ENGLISH_HEADINGS) if (re.test(phrase)) return sec;
  return ownLanguageHeadingOf(line, language);
}

// ── Phone numbers, as the world writes them (NB-8) ────────────────────────
const NANP_PHONE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;
const PHONE_RUN = /(?<![\p{L}\p{N}+])(?:\+|00)?[ \t]?\(?\d[\d \t.()\-]{6,22}\d(?!\d)/gu;
// "01.2019 - 2021", a German month and year, is a date, not a number to dial.
const MONTH_YEAR = /(?:^|\D)(?:0?[1-9]|1[0-2])\.(?:19|20)\d\d(?!\d)/;

/**
 * True when the text carries a phone number: a North American one as the
 * scanners always read, an international one ("+" or "00", then 8 to 15
 * digits with spaces, dots, dashes or brackets between them: "+44 7700
 * 900123", "+49 (0)30 1234567"), or a national one that opens with 0 and runs
 * 9 to 11 digits ("07700 900123", "06 12 34 56 78", "030 1234567").
 */
export function hasPhoneNumber(text: string): boolean {
  if (NANP_PHONE.test(text)) return true;
  for (const m of text.matchAll(PHONE_RUN)) {
    const run = m[0].trim();
    if (MONTH_YEAR.test(run)) continue;
    const digits = run.replace(/\D/g, "").length;
    if (run.startsWith("+")) { if (digits >= 8 && digits <= 15) return true; continue; }
    if (run.startsWith("00")) { if (digits - 2 >= 8 && digits - 2 <= 15) return true; continue; }
    if (/^\(?0/.test(run) && digits >= 9 && digits <= 11) return true;
  }
  return false;
}

/** A stable name for each parse issue, for the page to print in the reader's language (NB-17). */
export type ParseIssueCode = "few_words" | "low_letter_ratio" | "garbled_characters" | "no_sections";

export interface ParseQuality {
  verdict: "good" | "fair" | "poor";
  wordCount: number;
  issues: string[];
  /** One code per entry of `issues`, in the same order. */
  issueCodes: ParseIssueCode[];
}

// Count characters that signal a broken extraction: the U+FFFD replacement
// char and C0 control chars (excluding tab/newline/carriage-return). A charCode
// loop keeps the source free of literal invisible characters.
function countGarbageChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd || (c <= 0x08) || (c >= 0x0e && c <= 0x1f)) count++;
  }
  // Runs of 6+ identical characters are almost always extraction artifacts,
  // except the ones a person types (NB-20): spaces that right-align a date,
  // a rule of dashes, equals signs or underscores under a heading, dot
  // leaders. A pasted plain-text CV is laid out with them.
  count += (text.match(/([^\s\-_=.*~•·])\1{5,}/g) || []).length;
  return count;
}

/**
 * How trustworthy the extracted text looks. `language` is the detector's
 * code for the résumé (resume-language.ts): a résumé in one of the languages
 * SECTION_WORDS holds is read for its own section words too (NB-6), so a clean
 * Spanish or Hindi CV is not told "no standard resume sections found".
 */
export function computeParseQuality(resumeText: string, language?: string): ParseQuality {
  const wordCount = countWords(resumeText);
  // Letters and combining marks, of any script (NB-6): a Devanagari vowel
  // sign is a mark (\p{M}), and counting letters alone read a clean Hindi
  // CV as symbol-heavy. CJK, Arabic and Cyrillic letters count as letters.
  const letters = (resumeText.match(/[\p{L}\p{M}]/gu) || []).length;
  const letterRatio = resumeText.length > 0 ? letters / resumeText.length : 0;
  const garbage = countGarbageChars(resumeText);
  const hasSections = /\b(experience|education|skills|summary|employment)\b/i.test(resumeText)
    || (["summary", "experience", "education", "skills"] as const).some((sec) => hasLanguageSectionWord(resumeText, language, sec));
  const issues: string[] = [];
  const issueCodes: ParseIssueCode[] = [];
  if (wordCount < 120) { issues.push(`only ${wordCount} words extracted`); issueCodes.push("few_words"); }
  if (letterRatio < 0.55) { issues.push("unusually low text-to-symbol ratio"); issueCodes.push("low_letter_ratio"); }
  if (garbage > 5) { issues.push("garbled characters detected"); issueCodes.push("garbled_characters"); }
  if (!hasSections) { issues.push("no standard resume sections found"); issueCodes.push("no_sections"); }
  const verdict = issues.length >= 2 ? "poor" : issues.length === 1 ? "fair" : "good";
  return { verdict, wordCount, issues, issueCodes };
}

export interface ResumeStructure {
  sections: string[];
  positionCount: number;
  experienceSpanYears: number | null;
  contact: { email: boolean; phone: boolean; linkedin: boolean; location: boolean };
}

const SECTION_PATTERNS: [string, RegExp][] = [
  // "Personal Statement" is the UK's summary heading (S14X-168).
  ["Summary", /\b(summary|profile|objective|about\s+me|personal\s+statement)\b/i],
  ["Experience", /\b(experience|employment|work\s+history|professional\s+background)\b/i],
  ["Education", /\b(education|academic)\b/i],
  ["Skills", /\b(skills|competencies|proficiencies|technologies)\b/i],
  ["Certifications", /\b(certifications?|licen[cs]es?|credentials)\b/i],
  ["Projects", /\b(projects|portfolio)\b/i],
];

// The sections SECTION_WORDS names, by the name this reader gives them.
const LANGUAGE_SECTIONS: Array<[string, keyof SectionWordsOf]> = [["Summary", "summary"], ["Experience", "experience"], ["Education", "education"], ["Skills", "skills"]];

/** The résumé's structure; `language` (the detector's code) adds that language's section words (NB-6). */
export function parseResumeStructure(resumeText: string, language?: string): ResumeStructure {
  const sections = SECTION_PATTERNS.filter(([name, re]) => re.test(resumeText)
    || LANGUAGE_SECTIONS.some(([n, sec]) => n === name && hasLanguageSectionWord(resumeText, language, sec))).map(([name]) => name);

  // Count dated positions from year ranges: "2019 - 2022", "2020-Present".
  const rangeRe = /((?:19|20)\d{2})\s*[-–—]{1,2}\s*((?:19|20)\d{2}|present|current|now|ongoing)/gi;
  const years: number[] = [];
  let positionCount = 0;
  const nowYear = new Date().getFullYear();
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(resumeText)) !== null) {
    positionCount++;
    const start = parseInt(m[1], 10);
    const endRaw = m[2].toLowerCase();
    const end = /^(present|current|now|ongoing)$/.test(endRaw) ? nowYear : parseInt(endRaw, 10);
    if (start >= 1950 && start <= nowYear) years.push(start);
    if (end >= 1950 && end <= nowYear) years.push(end);
  }
  const experienceSpanYears = years.length >= 2 ? Math.max(...years) - Math.min(...years) : null;

  // Contact patterns mirror the deterministic red-flag checks for consistency;
  // the phone is the one matcher every reader uses (NB-8).
  const contact = {
    email: /@[\w.-]+\.\w{2,}/.test(resumeText),
    phone: hasPhoneNumber(resumeText),
    linkedin: /linkedin\.com|linkedin/i.test(resumeText),
    location: /\b([A-Z][a-z]+,\s*[A-Z]{2}\b|[A-Z][a-z]+,\s*[A-Z][a-z]+|\d{5}(-\d{4})?)\b/.test(resumeText),
  };

  return { sections, positionCount, experienceSpanYears, contact };
}

// Compact grounding block for the AI prompt. Phrased to prevent false NEGATIVES
// (claiming absent what is present) without forcing false positives — when in
// genuine doubt the model is told to defer to the resume text.
export function formatStructureForPrompt(s: ResumeStructure): string {
  const contactBits = [
    `email ${s.contact.email ? "yes" : "no"}`,
    `phone ${s.contact.phone ? "yes" : "no"}`,
    `LinkedIn ${s.contact.linkedin ? "yes" : "no"}`,
    `location ${s.contact.location ? "yes" : "no"}`,
  ].join(", ");
  const work = s.experienceSpanYears != null
    ? `${s.positionCount} dated position${s.positionCount === 1 ? "" : "s"} spanning ~${s.experienceSpanYears} year${s.experienceSpanYears === 1 ? "" : "s"}`
    : `${s.positionCount} dated position${s.positionCount === 1 ? "" : "s"} detected`;
  return `\n\n<deterministic_structure>
These were extracted deterministically from the raw text (not by you). Ground your analysis in them: do NOT report a "missing section", "missing contact info", or comparable issue that contradicts these facts. Ambiguous formatting can undercount an item, so when in genuine doubt prefer the resume text — but never flag as ABSENT something listed present here.
- Sections detected: ${s.sections.length ? s.sections.join(", ") : "none clearly detected"}
- Contact present: ${contactBits}
- Work history: ${work}
</deterministic_structure>`;
}
