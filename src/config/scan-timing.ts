/**
 * HOW LONG A FREE SCAN TAKES, as the site states it: one number.
 *
 * The homepage used to say ~10 s, 30 s, 60 s and ~90 s for the same scan.
 * What the code guarantees is a bound, not an average: free-keyword-scan
 * stops waiting for the model AI_DEADLINE_MS after the request starts and
 * serves its rule-based report, so a primary scan answers within this many
 * seconds. Every time-to-results sentence interpolates it, the scanning
 * screen counts down from it, and
 * src/test/the-homepage-told-four-different-times-to-results.test.ts fails
 * when the server's deadline outgrows it.
 */
export const SCAN_RESULTS_WITHIN_SECONDS = 90;
