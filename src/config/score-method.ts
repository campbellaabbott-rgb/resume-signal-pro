/**
 * HOW A SCAN SCORES, MIRRORED FROM THE CODE THAT DOES IT.
 *
 * /methodology published a fixed seven-factor weighting (25/20/15/15/10/10/5),
 * "50+ ATS platforms", "+40 more", "50+ factors", "90% of the job market" and
 * "validated by real outcomes from thousands of job seekers" (register L4-05;
 * SEO report S4). None of it matched the scorer. These constants are what
 * supabase/functions/free-keyword-scan/index.ts actually does, and
 * src/test/the-methodology-page-described-a-scorer-that-does-not-exist.test.ts
 * reads that file and fails when the two disagree: a claim that lives in a
 * different runtime from the thing it describes goes false silently.
 */

/** The four parts of every report's "Why this score" audit trail, in points out of 100 (scoreAudit). */
export const SCORE_AUDIT_PARTS = [
  { key: "keywords", possible: 35 },
  { key: "format", possible: 30 },
  { key: "impact", possible: 25 },
  { key: "content", possible: 10 },
] as const;

/** The AI's score is held within this many points of the rule-based score (atsScoreEstimate clamp). */
export const SCORE_AI_BAND = 12;

/** The ATS systems the scan's compatibility step names, in its own order. */
export const SCAN_ATS_SYSTEMS = ["Workday", "Greenhouse", "Lever", "Taleo", "iCIMS", "BambooHR"] as const;
