// Deterministic posting↔resume fit, shared by application-fit (single) and
// job-board fit-batch (many). The dictionary is the scanner's own detection
// tables, so a term only counts when it's both in the posting and something
// the engine actually recognizes. No AI — fast, free, reproducible.

import { INDUSTRY_KEYWORDS } from "./industry-detection.ts";

const DICTIONARY: string[] = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const list of [data.primary, data.secondary, data.certifications, data.titles]) {
      for (const term of list) {
        const t = term.toLowerCase().trim();
        if (t.length >= 3) set.add(t);
      }
    }
  }
  // Longest first so "project management" wins before "project".
  return [...set].sort((a, b) => b.length - a.length);
})();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsTerm = (haystack: string, term: string) =>
  new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i").test(haystack);

export interface FitResult {
  pct: number | null; // null = the posting contains no recognized terms
  matched: string[];
  missing: string[];
  totalRecognized: number;
  /** Share of the JOB's terms the résumé answers. This is what `pct` used to
   *  be, kept because it is the honest input to the "you're missing X" copy. */
  coverage: number;
  /** Share of the RÉSUMÉ's terms this job is about. Low for a broad CV against
   *  a narrow role — that is correct, and it is what stops padding paying. */
  precision: number;
}

/**
 * THE SCORE HAD NO RÉSUMÉ TERM IN ITS DENOMINATOR, SO PADDING WAS FREE.
 *
 * It was `matched / postingTerms` — pure recall. That asks only "what share of
 * this job's terms appear somewhere in the résumé", and nothing about how much
 * of the résumé is actually about this job. A document containing every term
 * the scorer knows therefore matched ~100% of every posting.
 *
 * MEASURED, 25 live "software engineer" postings and 15 live "registered nurse"
 * postings, four résumés of the same nine-year career:
 *
 *                        OLD (recall)      NEW (F1)
 *   prose SWE                  11.4          13.5
 *   same career, skills list   37.4          32.8
 *   the dictionary itself     100.0           1.4     <- the exploit
 *   nurse résumé (control)      1.8           2.0
 *
 * On nursing postings the nurse résumé stays top (24.2) and the software
 * résumé stays low (5.3), so cross-field separation is preserved — it was the
 * thing most at risk from adding a precision term, and it did not move.
 *
 * WHY F1 AND NOT A PRETTIER CURVE. A sqrt rescale makes real matches look
 * better (prose 13.5 -> 36) and was tempting, but it also revives the exploit
 * to 11.9 and leaks cross-field (a software résumé scores 20.9 on nursing
 * jobs). That is cosmetics dressed as measurement. The raw harmonic mean is
 * the number we can defend; if the RANGE reads low, the fix is a labelled band
 * in the UI, not a curve that flatters the input.
 *
 * WHAT THIS DOES NOT FIX. Prose still scores below the same career written as
 * a skills list — 2.4x, down from 3.3x but not gone. That gap is inherent to
 * substring matching: "led the migration to Kubernetes" and "Kubernetes" are
 * the same fact and only one of them is a term. Closing it needs semantic
 * matching, not arithmetic.
 */
export function computeFit(jobPosting: string, resumeText: string, maxTerms = 60): FitResult {
  const postingLower = jobPosting.toLowerCase();
  const resumeLower = resumeText.toLowerCase();

  const postingTerms: string[] = [];
  for (const term of DICTIONARY) {
    if (postingTerms.length >= maxTerms) break;
    if (postingTerms.some((p) => p.includes(term))) continue;
    if (containsTerm(postingLower, term)) postingTerms.push(term);
  }

  const matched = postingTerms.filter((t) => containsTerm(resumeLower, t));
  const missing = postingTerms.filter((t) => !containsTerm(resumeLower, t));

  if (postingTerms.length === 0) {
    return { pct: null, matched, missing, totalRecognized: 0, coverage: 0, precision: 0 };
  }

  // The résumé's own breadth, scanned the SAME way as the posting so the two
  // sides are commensurable. Deliberately uncapped: capping it at maxTerms
  // would re-open the exploit, because a padded résumé would have its
  // denominator truncated to the same 60 the posting gets.
  const resumeTerms: string[] = [];
  for (const term of DICTIONARY) {
    if (resumeTerms.some((p) => p.includes(term))) continue;
    if (containsTerm(resumeLower, term)) resumeTerms.push(term);
  }

  const coverage = matched.length / postingTerms.length;
  const precision = resumeTerms.length ? matched.length / resumeTerms.length : 0;
  const pct = coverage === 0 || precision === 0
    ? 0
    : Math.round(((2 * coverage * precision) / (coverage + precision)) * 100);

  return { pct, matched, missing, totalRecognized: postingTerms.length, coverage, precision };
}
