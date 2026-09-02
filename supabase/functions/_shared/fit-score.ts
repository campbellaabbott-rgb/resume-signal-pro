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

// One compiled RegExp per dictionary term, built on first use. The old code
// compiled a fresh RegExp on EVERY containsTerm call — and a fit-batch call
// makes hundreds of thousands of them (dictionary x 60 postings, plus
// dictionary x 60 identical resume scans). The cache is bounded by the
// dictionary and is a per-isolate compile cache, not cross-request state —
// its only job is to stop the same pattern being compiled twice in one call.
const TERM_RE = new Map<string, RegExp>();
const containsTerm = (haystack: string, term: string) => {
  let re = TERM_RE.get(term);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
    TERM_RE.set(term, re);
  }
  return re.test(haystack);
};

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
/** A résumé scanned once, reusable across a whole batch of postings. */
export interface ResumeScan {
  lower: string;
  terms: string[];
}

/**
 * THE RÉSUMÉ DOES NOT CHANGE BETWEEN POSTING 1 AND POSTING 60.
 *
 * fit-batch called computeFit(posting, resumeText) in a loop, and every call
 * re-lowercased the same 50KB résumé and re-walked the ENTIRE dictionary
 * against it to rebuild the identical resumeTerms list — the full-corpus scan,
 * the expensive half of the function, sixty times for one answer. Scan it once
 * here and hand the result to every computeFit in the batch.
 */
export function scanResume(resumeText: string): ResumeScan {
  const lower = resumeText.toLowerCase();
  // The résumé's own breadth, scanned the SAME way as the posting so the two
  // sides are commensurable. Deliberately uncapped: capping it at maxTerms
  // would re-open the padding exploit, because a padded résumé would have its
  // denominator truncated to the same 60 the posting gets.
  const terms: string[] = [];
  for (const term of DICTIONARY) {
    if (terms.some((p) => p.includes(term))) continue;
    if (containsTerm(lower, term)) terms.push(term);
  }
  return { lower, terms };
}

export function computeFit(jobPosting: string, resume: string | ResumeScan, maxTerms = 60): FitResult {
  const postingLower = jobPosting.toLowerCase();
  const scan = typeof resume === "string" ? scanResume(resume) : resume;

  const postingTerms: string[] = [];
  for (const term of DICTIONARY) {
    if (postingTerms.length >= maxTerms) break;
    if (postingTerms.some((p) => p.includes(term))) continue;
    if (containsTerm(postingLower, term)) postingTerms.push(term);
  }

  // Against the résumé TEXT, not its term list: a posting term can be covered
  // by a longer résumé term ("management" inside "project management") and
  // still be a genuine match.
  const matched = postingTerms.filter((t) => containsTerm(scan.lower, t));
  const missing = postingTerms.filter((t) => !containsTerm(scan.lower, t));

  if (postingTerms.length === 0) {
    return { pct: null, matched, missing, totalRecognized: 0, coverage: 0, precision: 0 };
  }

  const coverage = matched.length / postingTerms.length;
  const precision = scan.terms.length ? matched.length / scan.terms.length : 0;
  const pct = coverage === 0 || precision === 0
    ? 0
    : Math.round(((2 * coverage * precision) / (coverage + precision)) * 100);

  return { pct, matched, missing, totalRecognized: postingTerms.length, coverage, precision };
}

/**
 * THE RÉSUMÉ COULD SCORE A POSTING BUT NEVER FIND ONE.
 *
 * Reported 2026-09-01: "I tried this drop resume feature and it didn't match me
 * to applicable jobs." The scorer was not the problem — the candidates were.
 * Dropping a résumé scored ONLY the postings already loaded in the board's
 * window and re-sorted those. On the default browse that window is the newest
 * 60 of 814,859 openings, chosen by recency and related to nobody's résumé, so
 * the feature reordered sixty irrelevant rows under a header claiming fit
 * ranking. Nothing was ever retrieved.
 *
 * Measured live, four résumés, mean fit over the scored window:
 *
 *                  loaded window    résumé-derived search
 *   senior SWE           4.5               17.1
 *   ICU nurse            2.9               12.5
 *   sales AE             3.8               11.6
 *   accountant           1.4               15.3
 *
 * and rows scoring zero fell from 7-14 of 20 to 0-1.
 *
 * THE RETRIEVAL KEY IS THE ROLE, NOT THE SKILL LIST. Searching "TypeScript"
 * returns everything that mentions it; "software engineer" returns the job. So
 * this reads role TITLES out of the résumé and hands them to the ordinary
 * search — the same path a typed query takes, keeping its ranking, its filters
 * and its disclosure rather than inventing a second retrieval engine.
 *
 * WHY SINGLE-WORD TITLES ARE TREATED DIFFERENTLY. "electrician", "paralegal"
 * and "welder" are whole occupations and have to work. "manager" and "analyst"
 * sit in the same list and appear in half of all résumés as a fragment of
 * something else. A single word therefore counts only where the headline lives
 * — the top of the document — while a multi-word title counts anywhere. Any
 * term contained in a longer match is then dropped as the vaguer way to say the
 * same thing, which is also what keeps "manager" from beating "product manager".
 */
const TITLE_VOCAB: string[] = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const term of data.titles) {
      const t = term.toLowerCase().trim();
      // A bare word needs length to be an occupation; "rep" and "aide" are not
      // queries. A multi-word title carries its own specificity.
      if (t.includes(" ") ? t.length >= 4 : t.length >= 6) set.add(t);
    }
  }
  return [...set];
})();

/**
 * Bare words in the title list that are a rank, a state or a fragment rather
 * than an occupation. Each appears in ordinary résumé prose, and each as a
 * whole-board query returns a different job than the reader does. "veteran" is
 * the clearest case: it is in the vocabulary, it is not a job, and it sits in
 * the header of every résumé that mentions military service.
 *
 * The asymmetry that decides membership: stoplisting a real occupation costs
 * that reader the retrieval and leaves them browsing normally — the behaviour
 * everyone had before this existed. Admitting a noise word silently searches
 * the WRONG career and presents it as their match. An ambiguous word is
 * therefore excluded. Multi-word titles are untouched, because "account
 * manager" is precise even though "manager" is not.
 */
const GENERIC_SINGLES = new Set([
  "manager", "analyst", "director", "associate", "specialist", "consultant",
  "partner", "principal", "fellow", "veteran", "captain", "server", "doctor",
  "counsel", "trading", "treasury", "litigation", "clerical", "postdoc",
  "postdoctoral",
]);

/**
 * Rank modifiers, which narrow the SEARCH without improving the match —
 * seniority already reaches the score through the description terms computeFit
 * reads. Measured against the live board, candidate pool graded vs plain:
 *
 *   journeyman electrician    139  vs  electrician        1,181   (8.5x)
 *   staff accountant          453  vs  accountant       10,000+   (22x)
 *   charge nurse              309  vs  registered nurse 10,000+   (22x)
 *
 * A journeyman electrician shown 139 openings instead of 1,181 has been
 * filtered, not matched. The strip is deliberately conservative: it fires only
 * where the remainder is ITSELF a title this résumé claimed, so it can only
 * ever swap one real occupation for a broader real occupation.
 */
const GRADE_PREFIXES = [
  "journeyman", "apprentice", "trainee", "senior", "junior", "staff", "lead",
  "master", "entry level", "entry-level", "sr", "jr",
];

/**
 * Role titles this résumé actually claims, best first — the search terms that
 * turn "score what's on screen" into "find what fits". Empty when the document
 * names no occupation the vocabulary knows, which the caller must treat as
 * "keep browsing normally", never as "no jobs match you".
 */
export function resumeRoleTerms(resumeText: string, limit = 4): string[] {
  const lower = resumeText.toLowerCase();
  if (lower.trim().length < 100) return [];
  // Where a headline sits, with room for a contact block above it.
  const head = lower.slice(0, Math.max(400, Math.floor(lower.length * 0.2)));
  const found: { term: string; first: number; score: number }[] = [];
  for (const term of TITLE_VOCAB) {
    if (!containsTerm(lower, term)) continue;
    const single = !term.includes(" ");
    if (single && GENERIC_SINGLES.has(term)) continue;
    const inHead = containsTerm(head, term);
    if (single && !inHead) continue; // a bare word counts only as a headline
    const first = lower.indexOf(term);
    const freq = lower.split(term).length - 1;
    found.push({
      term,
      first,
      score: freq * 2 + term.split(" ").length * 3 + (inHead ? 12 : 0) +
        (first / Math.max(1, lower.length) < 0.35 ? 4 : 0),
    });
  }
  // A graded title whose plain form is also claimed retrieves a fraction of the
  // same jobs — drop the grade and keep the occupation.
  const ungraded = found.filter((f) => {
    const p = GRADE_PREFIXES.find((g) => f.term.startsWith(g + " "));
    return !(p && found.some((o) => o.term === f.term.slice(p.length + 1)));
  });
  // "engineer" inside "software engineer" is the same claim, less precise.
  const kept = ungraded.filter((a) => !ungraded.some((b) => b.term !== a.term && b.term.includes(a.term)));
  kept.sort((a, b) => b.score - a.score || a.first - b.first);
  return kept.slice(0, limit).map((c) => c.term);
}
