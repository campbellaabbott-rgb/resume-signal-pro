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
 * this function's copy of the free scanner's detector (./resume-language.ts,
 * taken from free-keyword-scan at f8d72a9b and held to what it detects, not
 * to that file's bytes, by
 * src/test/the-full-analysis-is-written-in-the-buyers-language.test.ts: the
 * scanner's own copy changes on its own branches). A detector answer that
 * names no language it is sure of (an 'unknown', or English by default with
 * no English words) is no answer: the report is English and the résumé's
 * language is not named. Every part of the analysis reads the same
 * instruction, and the fixed choices the schema lists stay English: the
 * report and the PDF pick colours and labels by them, and the page
 * translates them itself.
 *
 * WHAT STAYS IN THE RÉSUMÉ'S OWN LANGUAGE (review of S13-003). The report is
 * written in the page's language, but some of its values are not report
 * text: a field that quotes the résumé or the LinkedIn profile (the weak
 * bullet, the vague statement, the weak verb, the current text and phrase,
 * the current headline) is the person's own words, and a quote in another
 * language is a line that is not in their CV; and the rewrites made to be
 * pasted back into the résumé (the summary, the improved bullets, the
 * stronger verbs, the keywords, the suggested text and phrases, the example
 * bullets) are worth nothing in a language the résumé is not in. So quotes
 * are copied exactly, and when the résumé's language is not the report's,
 * the résumé-bound text is written in the résumé's, named when the detector
 * is sure of it. companyName's "Unknown" is a value the page compares, kept
 * exactly as written.
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
  /** The résumé's own language when the detector is sure of it; null when it is not (then the prompt says "the résumé's own language"). */
  resume: { code: string; name: string } | null;
}

/** Each language's reply size against English, measured (see above); English is 1. */
export const REPLY_SIZE_FACTOR: Record<string, number> = { en: 1, es: 1.25, de: 1.29, fr: 1.31, pt: 1.23, nl: 1.2, hi: 2.6, tl: 1.3 };

const LARGEST_FACTOR = Math.max(...Object.values(REPLY_SIZE_FACTOR));

/**
 * The résumé's language when the detector names one it is sure of: a
 * two-letter code with a one-word English name. English is the detector's
 * default when nothing clears its bar, so English counts only on English
 * words (high confidence). Anything else, an 'unknown' or "an unidentified
 * language" from a later copy of the detector included, is no answer.
 */
export function sureResumeLanguage(resumeText: unknown): { code: string; name: string } | null {
  return sureLanguageOf(detectResumeLanguage(typeof resumeText === "string" ? resumeText : ""));
}

/** The rule above, on a detector's answer (any copy of the detector, whatever it learns to say). */
export function sureLanguageOf(detected: { language?: unknown; languageName?: unknown; confidence?: unknown }): { code: string; name: string } | null {
  const code = typeof detected?.language === "string" ? detected.language : "";
  const name = typeof detected?.languageName === "string" ? detected.languageName : "";
  if (!/^[a-z]{2}$/.test(code) || !/^[A-Z][a-z]+$/.test(name)) return null;
  if (code === "en" && detected.confidence !== "high") return null;
  return { code, name };
}

/** The page's language when it sent one that is a language, else the résumé's when the detector is sure of it, else English. */
export function reportLanguage(asked: unknown, resumeText: string): ReportLanguage {
  const resume = sureResumeLanguage(resumeText);
  const name = resolveLanguageName(asked);
  if (name && typeof asked === "string") return { code: asked.trim(), name, source: "page", resume };
  if (resume) return { code: resume.code, name: resume.name, source: "resume", resume };
  return { code: "en", name: "English", source: "resume", resume: null };
}

/** How much longer than English a reply in this language runs; a regional code reads as its language. */
export function replySizeFactor(code: string): number {
  const base = code.split("-")[0].toLowerCase();
  return REPLY_SIZE_FACTOR[base] ?? LARGEST_FACTOR;
}

const baseOf = (code: string) => code.split("-")[0].toLowerCase();

/** True when the résumé-bound text is written in another language than the report: the résumé's is known and differs, or is not known. */
function resumeTextApart(lang: ReportLanguage): boolean {
  return lang.resume === null || baseOf(lang.resume.code) !== baseOf(lang.code);
}

/**
 * The size factor for the analysis's reply: the report language's, or the
 * résumé's when the résumé-bound text is written in a longer one (a Hindi
 * CV's rewrites in an English report).
 */
export function analysisReplyFactor(lang: ReportLanguage): number {
  const report = replySizeFactor(lang.code);
  return lang.resume && resumeTextApart(lang) ? Math.max(report, replySizeFactor(lang.resume.code)) : report;
}

/** The fields that quote the person's own words: copied exactly, never translated. */
export const QUOTED_FIELDS = [
  "optimizedBullets.original",
  "quantificationOpportunities.context",
  "actionVerbs.weak",
  "suggestedEdits.currentText",
  "phraseSwaps.current",
  "headlineOptimization.current",
] as const;

/** The text written to be pasted back into the résumé: in the résumé's language. */
export const RESUME_BOUND_FIELDS = [
  "summaryRewrite.professionalSummary",
  "optimizedBullets.improved",
  "quantificationOpportunities.example",
  "typicalMetrics.bulletExample",
  "actionVerbs.strong",
  "keywords",
  "suggestedEdits.suggestedText",
  "phraseSwaps.suggested",
  "languageToUse.bulletExample",
] as const;

/**
 * The line every part's request ends with: the language for every free-text
 * value, the fixed choices kept in English, quotes kept as written, and,
 * when the résumé is in another language (or one the detector cannot name),
 * the résumé-bound text in the résumé's. English is named too: the prompt no
 * longer says it, and a résumé in another language must not pull an English
 * buyer's report into that language.
 */
export function reportLanguageInstruction(lang: ReportLanguage): string {
  let text = `\n\nREPORT LANGUAGE: ${lang.name}. Write every free-text value of the analysis in ${lang.name}: summaries, explanations, insights, tips, red flags, plans and examples. Keep every JSON key, and every value the schema lists as a fixed choice (industry, experienceLevel, grade, jargonLevel, severity, format, jdTone, resumeTone, companyType), exactly as written in English; never translate those. Write companyName as the posting names the company, or exactly "Unknown" when it names none.`;
  text += ` QUOTES STAY AS WRITTEN: a field that quotes the résumé or the LinkedIn profile (${QUOTED_FIELDS.join(", ")}) copies that text exactly, in the language it is written in; never translate a quote.`;
  if (resumeTextApart(lang)) {
    const resumeName = lang.resume ? lang.resume.name : "the language the résumé itself is written in";
    text += ` TEXT FOR THE RÉSUMÉ: ${lang.resume ? `the résumé is written in ${lang.resume.name}, so ` : ""}text written to be pasted into the résumé (${RESUME_BOUND_FIELDS.join(", ")}) is written in ${resumeName}, so it can go into the résumé as it is; the explanations around it stay in ${lang.name}.`;
  }
  return text;
}
