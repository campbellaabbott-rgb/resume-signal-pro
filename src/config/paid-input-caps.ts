/**
 * HOW MUCH OF A LONG POSTING OR LINKEDIN TEXT THE FULL ANALYSIS READS
 * (S14X-048).
 *
 * MIRRORS MAX_JOB_DESCRIPTION_LENGTH and MAX_LINKEDIN_LENGTH in
 * supabase/functions/analyze-resume/paid-run.ts, which clip the paid run's
 * inputs (with a notice in the report). The uploader says so beside the Full
 * Analysis link before checkout, so a buyer with a longer posting knows what
 * they are paying to have read. It never refuses the press: the paid run
 * works with a clipped posting, and no gate stops a live sale without the
 * owner's yes. src/test/the-uploader-says-before-checkout-how-much-of-a-long-posting-is-read.test.tsx
 * holds these equal to the server's.
 */
export const PAID_JOB_DESCRIPTION_CHARS = 20_000;
export const PAID_LINKEDIN_CHARS = 30_000;
