-- ALBUQUERQUE IS NOT IN MEXICO.
--
-- detectCountry ran its country-name patterns before the US-state names, so
-- the "mexico" substring inside "New Mexico" claimed the row for MX before
-- the state list could say US. Measured 2026-08-24: 251 of 599 servable
-- postings whose location names New Mexico carried country=MX — including
-- rows with an explicit US prefix ("US, New Mexico, Albuquerque",
-- workday:intel JR0285454). The poison ran both directions: country=US
-- filters hid Albuquerque jobs, country=MX searches surfaced them.
--
-- The follow-up probes bounded the bug class before this fix was written:
-- California∩CA 3/11,034, Colorado∩CO 0/2,703, Indiana∩IN 0/2,452,
-- Delaware∩DE 0/272 — this is the one real state/country substring
-- collision, not an instance of a general one. Do not build the general
-- sweep; it was measured and refuted.
--
-- The ingest regex now guards the pattern ((?<!new )mexico), so new rows
-- classify correctly; this corrects the rows already stored. The country
-- backfill can't do it — it selects country IS NULL only, and these rows
-- are wrong, not missing. "Mexico City"/"México" rows don't match the
-- predicate and keep MX. Idempotent: corrected rows leave the WHERE.

UPDATE public.job_board_postings
SET country = 'US'
WHERE country = 'MX'
  AND location ~* '\mnew mexico\M';
