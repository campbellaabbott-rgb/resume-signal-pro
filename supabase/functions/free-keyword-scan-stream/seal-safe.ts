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
 * The mail copy of each sealed sentence:
 *   - loses any quoted span that is text from the résumé (eight characters or
 *     more);
 *   - loses any run of seven or more digits, whatever separates them (a year
 *     range such as 2019-2023 is kept);
 *   - loses any domain written around a bracketed or spelled-out dot.
 *
 * THE PAGE'S SENTENCES ARE NOT TOUCHED (recheck 3 of wave 4, 2026-10-26). The
 * scrub first ran on the report itself, so the free report's red flags and
 * fix-plan steps that quoted a bullet read "bullets like read as duties, not
 * results" on the page and in the cache. Now the scrubbed sentences are a
 * separate copy (reportMeta.mailSentences), and the seal covers that copy;
 * the page shows the report as main does, and sends the copy when it asks for
 * the mail (src/lib/report-mail-copy.ts). A caller sending the page's quoting
 * sentences instead fails the seal and gets the numbers only.
 *
 * Pure: the Node tests load it directly. The streaming fork carries a
 * byte-identical copy.
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

/** The mail copy of a report's sealed sentences. */
export type MailCopy = { issues: string[]; steps: string[]; occupation: string };

/**
 * The copy of exactly the sentences scan-mail-seal seals (redFlags[0..2]
 * .issue, fixRoadmap.steps[0..7].step, keywordSource.occupation), scrubbed.
 * The report is not changed. A sentence that is not a string is "", as the
 * seal reads it.
 */
export function mailCopyOf(report: Record<string, unknown>, resumeText: string): MailCopy {
  const resumeNorm = norm(resumeText ?? "");
  const clean = (v: unknown): string => (typeof v === "string" ? stripDialable(stripResumeQuotes(v, resumeNorm).text) : "");
  const issues = Array.isArray(report.redFlags) ? report.redFlags.slice(0, 3).map((f) => (isObj(f) ? clean(f.issue) : "")) : [];
  const fr = isObj(report.fixRoadmap) ? report.fixRoadmap : null;
  const steps = fr && Array.isArray(fr.steps) ? fr.steps.slice(0, 8).map((st) => (isObj(st) ? clean(st.step) : "")) : [];
  const occupation = isObj(report.keywordSource) ? clean(report.keywordSource.occupation) : "";
  return { issues, steps, occupation };
}

/**
 * What the seal is computed over: the mail copy in the report's shape, sharing
 * the report's own reportMeta object, so attachScanMailSeal writes the seal
 * onto the report the browser receives.
 */
export function mailSealView(report: Record<string, unknown>, copy: MailCopy): Record<string, unknown> {
  return {
    redFlags: copy.issues.map((issue) => ({ issue })),
    fixRoadmap: { steps: copy.steps.map((step) => ({ step })) },
    keywordSource: { occupation: copy.occupation },
    reportMeta: report.reportMeta,
  };
}

/** Put the mail copy on the report's reportMeta and return the view to seal. */
export function attachMailCopy(report: Record<string, unknown>, resumeText: string): Record<string, unknown> {
  const copy = mailCopyOf(report, resumeText);
  if (isObj(report.reportMeta)) report.reportMeta.mailSentences = copy;
  return mailSealView(report, copy);
}
