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
}

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
  return {
    pct: postingTerms.length === 0 ? null : Math.round((matched.length / postingTerms.length) * 100),
    matched,
    missing,
    totalRecognized: postingTerms.length,
  };
}
