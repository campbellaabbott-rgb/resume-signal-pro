/**
 * HOW LONG EACH COPY OF A RÉSUMÉ LIVES -- the numbers the site publishes.
 *
 * The /trust page, the FAQ and the short lines beside the uploader interpolate
 * these, and src/test/a-resume-never-rides-a-stripe-session.test.ts compares
 * every one with the code that actually enforces it (the column defaults and
 * cron jobs in supabase/migrations, the cache windows in the edge functions).
 * Change a clock in the code and that test names the sentence that just went
 * false; change a number here without the code and it fails the same way.
 *
 * The full inventory, store by store, is what /trust renders (trustPage.retention).
 */

/** temp_resume_storage: the text from an upload or paste, held so a checkout can use it. */
export const TEMP_RESUME_HOURS = 24;

/** scan_report_cache: the finished free report (which quotes the résumé), keyed by a one-way fingerprint. */
export const REPORT_CACHE_DAYS = 7;

/**
 * ai_response_cache: the free report's AI summary (generate-summary) and the
 * backup scanner's report (free-keyword-scan-stream), each asked for 24 hours.
 * A trigger on the table holds every row to this many hours whatever a caller
 * asks, and refuses the paid analysis outright (migration 20261004150000).
 */
export const AI_CACHE_MAX_HOURS = 24;

/** resume_analyses: a paid analysis behind its private share link. */
export const SHARED_ANALYSIS_DAYS = 90;

/** Where erasure requests go: the address the privacy policy names. */
export const PRIVACY_EMAIL = "privacy@resumebooster.com";
