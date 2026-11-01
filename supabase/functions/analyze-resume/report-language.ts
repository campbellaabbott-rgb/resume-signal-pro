/**
 * THE LANGUAGE A FULL ANALYSIS IS WRITTEN IN (S13-003).
 *
 * The system prompt said "Provide your analysis output in English (for
 * consistency)" and the success page sent no language, so every $5 analysis
 * came back in English: a Spanish buyer on the Spanish site, with a Spanish
 * résumé, after a free scan that had answered in Spanish.
 *
 * NOW the page sends the language it is shown in (i18n.language), bounded by
 * _shared/language-instruction.ts (a locale code, never a sentence: a value
 * that is not one is dropped, not quoted). With none, the résumé decides, by
 * the free scanner's own detector (./resume-language.ts, a byte-for-byte copy
 * of free-keyword-scan/resume-language.ts, held so by
 * src/test/the-full-analysis-is-written-in-the-buyers-language.test.ts). Every
 * part of the analysis reads the same instruction, and the fixed choices the
 * schema lists stay English: the report and the PDF pick colours and labels
 * by them, and the page translates them itself.
 *
 * A REPLY IN ANOTHER LANGUAGE IS LONGER. The parts' caps were measured from
 * the schema at 3 characters a token (analysis-parts.ts), which for English
 * is 3 bytes a token. The same text in another language is longer in UTF-8
 * bytes: six typical analysis strings (a summary rewrite, a rewritten bullet,
 * an explanation, a red flag, a plan step, an insight; English 985 bytes) in
 * each of the site's languages measure es 1,224 (1.243), de 1,270 (1.289),
 * fr 1,290 (1.310), pt 1,207 (1.225), nl 1,173 (1.191), hi 2,553 (2.592) and
 * tl 1,276 (1.295). Each part's reply cap grows by that ratio, rounded up
 * (thinking does not), so a reply the English cap would hold is not cut off
 * in Hindi. 3 bytes a token over-counts Devanagari and accented Latin for the
 * chain's tokenizers, as it over-counts English. A language with no sample
 * (one the detector knows, such as Italian, or a code the page should never
 * send) gets the largest.
 */
import { resolveLanguageName } from "../_shared/language-instruction.ts";
import { detectResumeLanguage } from "./resume-language.ts";

export interface ReportLanguage {
  /** The page's locale code as sent, or the detector's ISO 639-1 code. */
  code: string;
  /** The language's English name, as the prompt names it. */
  name: string;
  source: "page" | "resume";
}

/** Each language's reply size against English, measured (see above); English is 1. */
export const REPLY_SIZE_FACTOR: Record<string, number> = { en: 1, es: 1.25, de: 1.29, fr: 1.31, pt: 1.23, nl: 1.2, hi: 2.6, tl: 1.3 };

const LARGEST_FACTOR = Math.max(...Object.values(REPLY_SIZE_FACTOR));

/** The page's language when it sent one that is a language, else the résumé's. */
export function reportLanguage(asked: unknown, resumeText: string): ReportLanguage {
  const name = resolveLanguageName(asked);
  if (name && typeof asked === "string") return { code: asked.trim(), name, source: "page" };
  const detected = detectResumeLanguage(typeof resumeText === "string" ? resumeText : "");
  return { code: detected.language, name: detected.languageName, source: "resume" };
}

/** How much longer than English a reply in this language runs; a regional code reads as its language. */
export function replySizeFactor(code: string): number {
  const base = code.split("-")[0].toLowerCase();
  return REPLY_SIZE_FACTOR[base] ?? LARGEST_FACTOR;
}

/**
 * The line every part's request ends with: the language for every free-text
 * value, the fixed choices kept in English. English is named too: the prompt
 * no longer says it, and a résumé in another language must not pull an
 * English buyer's report into that language.
 */
export function reportLanguageInstruction(lang: ReportLanguage): string {
  return `\n\nREPORT LANGUAGE: ${lang.name}. Write every free-text value of the analysis in ${lang.name}: summaries, rewritten bullets and headlines, explanations, insights, tips, red flags, plans and examples. Keep every JSON key, and every value the schema lists as a fixed choice (industry, experienceLevel, grade, jargonLevel, severity, format, jdTone, resumeTone, companyType), exactly as written in English; never translate those.`;
}
