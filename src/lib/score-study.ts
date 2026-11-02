/**
 * THE SCORE STUDY NAMES ITS BASIS, IN ONE TEXT FOR THE PAGE AND THE BAKE
 * (register S13-050, the page half).
 *
 * 20261101100000 makes get_public_scan_insights count the primary scanner's
 * model-written reports only: a scan the fallback scanner answered, or a
 * primary scan that served the rule-based report, is left out of every
 * figure and counted in `excluded`, and the response says `scorer:
 * 'primary'`. /research/ats-score-benchmarks said none of this: its subline
 * and its FAQ described "completed scans run by real users" as if every scan
 * were in. The page (src/pages/ScoreStudy.tsx) and the crawler copy
 * (scripts/prerender-seo.mjs) now print the same sentences from here, and
 * only once the response itself says which scorer it counts: before the
 * migration applies, the RPC still blends the two scorers and the old,
 * true sentence stays.
 *
 * "Scans logged", not "completed scans" (S13-087): one scan can be logged
 * twice, so the count is of log rows.
 */

/** What the RPC answers about its own basis (absent before 20261101100000). */
export type StudyBasis = { scorer?: unknown; excluded?: unknown } | null | undefined;

const countOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

/** True once the response says every figure is the primary scanner's. */
export function studyScoredByPrimary(ins: StudyBasis): boolean {
  return !!ins && typeof ins === "object" && ins.scorer === "primary";
}

/**
 * The basis line under the page's heading: the scorer, and how many scans
 * were left out and why. Null while the response does not name its scorer.
 */
export function studyBasisLine(ins: StudyBasis): string | null {
  if (!studyScoredByPrimary(ins)) return null;
  const excluded = ins && typeof ins.excluded === "object" && ins.excluded !== null
    ? (ins.excluded as { fallback_scanner?: unknown; rule_based_report?: unknown })
    : null;
  const fallback = countOf(excluded?.fallback_scanner);
  const rules = countOf(excluded?.rule_based_report);
  if (fallback === null || rules === null) return "Every figure is scored by our primary scanner.";
  const n = (k: number, one: string, many: string) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;
  return `Every figure is scored by our primary scanner. Left out: ${n(fallback, "scan", "scans")} the fallback scanner answered and ${n(rules, "report", "reports")} our rules wrote when the AI could not.`;
}

const SOURCE_BLENDED =
  "From scans logged by real users on this site over a rolling 180-day window. Only aggregates are published: each industry or experience bucket must contain at least 25 scans before it appears, and no individual resume, score, or location is ever exposed.";
const SOURCE_PRIMARY =
  "From scans logged by real users on this site over a rolling 180-day window, each scored by our primary scanner: a scan the fallback scanner answered, or a report our rules wrote when the AI could not, is left out, and this page says how many. Only aggregates are published: each industry or experience bucket must contain at least 25 scans before it appears, and no individual resume, score, or location is ever exposed.";

/** The study's questions, its source answer naming the basis the response states. */
export function studyFaqs(ins: StudyBasis): Array<{ q: string; a: string }> {
  return [
    {
      q: "What is a good ATS score?",
      a: "Judge your score against the live distribution on this page, not a folklore threshold: the median and quartiles come from real scans in the last 180 days. Scoring above the 75th percentile means most resumes being checked right now score below yours; below the 25th percentile means parsing or keyword problems are very likely holding you back.",
    },
    {
      q: "Do ATS systems themselves show scores like this?",
      a: "Mostly no. Most ATS platforms rank and filter by recruiter searches rather than assigning a universal score. A resume score — ours included — is a diagnostic model of how well your resume will survive parsing and keyword search, not a number Workday or Greenhouse shows a recruiter.",
    },
    { q: "Where do these numbers come from?", a: studyScoredByPrimary(ins) ? SOURCE_PRIMARY : SOURCE_BLENDED },
    {
      q: "Why might this sample skew low or high?",
      a: "People who check their resume are often mid-job-search and suspect something is wrong, so the sample likely skews toward resumes with fixable problems. Treat the percentiles as a benchmark of active job seekers, not of every employed professional's resume.",
    },
  ];
}
