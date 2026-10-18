/**
 * A SEALED SENTENCE NEVER QUOTES THE RÉSUMÉ, AND CARRIES NO NUMBER TO CALL (S12-068).
 *
 * "Email my report" prints the report's sealed sentences (the first three
 * issues, the first eight fix steps, the occupation) from our own domain to
 * any address the caller names. The seal proves the scanner wrote a sentence,
 * not that the sentence is harmless, and the rule-based fallback wrote
 * `Weak bullet: "<the bullet>"` into an issue, so a résumé whose bullet read
 * "call 800/555/0199 to claim your refund" went out sealed, from
 * reports@resumebooster.work, to anyone. The mail's own scrub (mailSafeText)
 * missed numbers split by "/", "·", "_" or U+2011 and domains written
 * "evil[.]com".
 *
 * Before the report is sealed (and cached), each sealed sentence:
 *   - loses any quoted span that is text from the résumé (eight characters or
 *     more); on an issue, the quote moves to the issue's impact line, which
 *     the page shows and the mail never prints;
 *   - loses any run of seven or more digits, whatever separates them (a year
 *     range such as 2019-2023 is kept);
 *   - loses any domain written around a bracketed or spelled-out dot.
 *
 * Pure: the Node tests load it directly.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lower case, letters and digits only, single spaces: the form two texts are compared in. */
function norm(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const QUOTED = /"([^"\n]{1,300})"|“([^”\n]{1,300})”|«([^»\n]{1,300})»|‘([^’\n]{1,300})’|„([^“”\n]{1,300})[“”]/g;

/** A run of digits, any of these between each pair, as one number someone could dial. */
const DIGIT_RUN = /\+?\(?\p{N}(?:[\s().\-–—‑‒·•_/\\|:]{0,3}\p{N}){6,}/gu;
const YEAR_RANGE = /^\(?(?:19|20)\d{2}\s*[-–—‑]\s*(?:19|20)\d{2}\)?$/;

/** A domain written around a bracketed or spelled-out dot: evil[.]com, evil (dot) com, evil{.}co. */
const OBFUSCATED_DOMAIN = /[\p{L}\p{N}-]+(?:\s*(?:\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\})\s*[\p{L}\p{N}-]+)+/giu;

/** The sentence without long digit runs or obfuscated domains. */
export function stripDialable(s: string): string {
  return s
    .replace(OBFUSCATED_DOMAIN, " ")
    .replace(DIGIT_RUN, (m) => {
      const digits = (m.match(/\p{N}/gu) ?? []).length;
      if (digits < 7 || YEAR_RANGE.test(m.trim())) return m;
      return " ";
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** The sentence without quoted résumé text, and the quotes it lost. */
export function stripResumeQuotes(s: string, resumeNorm: string): { text: string; quotes: string[] } {
  const quotes: string[] = [];
  const text = s.replace(QUOTED, (whole, ...groups: Array<string | undefined>) => {
    const inner = groups.slice(0, 5).find((g) => typeof g === "string") ?? "";
    const n = norm(inner);
    if (n.length >= 8 && resumeNorm.includes(n)) {
      quotes.push(whole);
      return "";
    }
    return whole;
  })
    .replace(/[:\-–—]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  return { text, quotes };
}

/**
 * Scrub, in place, exactly the sentences scan-mail-seal seals: redFlags[0..2]
 * .issue, fixRoadmap.steps[0..7].step and keywordSource.occupation.
 */
export function scrubSealedSentences(report: Record<string, unknown>, resumeText: string): void {
  const resumeNorm = norm(resumeText ?? "");
  const scrub = (v: unknown) => {
    if (typeof v !== "string") return { text: v, quotes: [] as string[] };
    const q = stripResumeQuotes(v, resumeNorm);
    return { text: stripDialable(q.text), quotes: q.quotes };
  };
  if (Array.isArray(report.redFlags)) {
    for (const flag of report.redFlags.slice(0, 3)) {
      if (!isObj(flag)) continue;
      const { text, quotes } = scrub(flag.issue);
      flag.issue = text;
      if (quotes.length) {
        const impact = typeof flag.impact === "string" ? flag.impact : "";
        flag.impact = impact ? `${quotes.join(" ")} — ${impact}` : quotes.join(" ");
      }
    }
  }
  const fr = isObj(report.fixRoadmap) ? report.fixRoadmap : null;
  if (fr && Array.isArray(fr.steps)) {
    for (const step of fr.steps.slice(0, 8)) {
      if (isObj(step)) step.step = scrub(step.step).text;
    }
  }
  if (isObj(report.keywordSource)) report.keywordSource.occupation = scrub(report.keywordSource.occupation).text;
}
