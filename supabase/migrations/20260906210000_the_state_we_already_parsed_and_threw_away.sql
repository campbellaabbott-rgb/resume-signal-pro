-- THE JURISDICTION WAS PARSED ON EVERY ROW AND DISCARDED ON EVERY ROW.
--
-- supabase/functions/job-board/normalize.ts runs P_US_STATE_CODE,
-- P_US_STATE_NAME, P_US_STATE_CODE_LEADING, P_CA_PROV_CODE and P_CA_PROV_NAME
-- over every posting's location string. Their ONLY consumer is the country
-- resolver at normalize.ts:705-706, which collapses all of them to 'US' or
-- 'CA' and drops the subdivision on the floor.
--
-- Pay-disclosure law is state-level, not country-level: Colorado, California,
-- New York, Washington, Illinois, Hawaii and Maryland each carry a different
-- rule, and "43% of US postings disclose pay" is an average over seven legal
-- regimes and forty-three without one. A jurisdiction-level compliance score
-- is a different product from a country-level one, and the difference is a
-- text column we already computed.
--
-- IT IS ONLY RECOVERABLE WHILE THE ROW IS LIVE. The location string is stored,
-- so in principle this is re-derivable — but a posting that closes tonight is
-- DELETED from job_board_postings tonight (index.ts ~3665) and its location
-- never reaches job_board_closures or job_board_exits. Every day this column
-- does not exist is a day of exits whose jurisdiction is gone for good.

ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS region_code text;

COMMENT ON COLUMN public.job_board_postings.region_code IS
  'ISO 3166-2 subdivision code for the posting location, as parsed by '
  'job-board/normalize.ts from the vendor''s own location string: '
  '''US-CA'', ''US-NY'', ''CA-ON''. ALWAYS country-prefixed — a bare ''CA'' '
  'is ambiguous between California and Canada and MUST NOT be written here. '
  'NULL means the location string did not state a US state or Canadian '
  'province, not that the role has no jurisdiction. This is a PLACE, not a '
  'time: it carries no clock and no basis. It is the employer''s stated '
  'location as we normalised it, never an inference from the employer''s '
  'headquarters or from the ATS tenant.';

-- NO INDEX, DELIBERATELY. Nothing queries this today (by design — this whole
-- wave is writes, not reads), the obvious first consumer is a GROUP BY that
-- would seq-scan regardless, and job_board_postings is the hottest write table
-- in the schema on a database that has already had a disk alarm. Add a partial
-- index WHERE region_code IS NOT NULL when a real query needs one.
--
-- BACKFILL COMES FROM THE CORRECTIONS PATH, NOT FROM SQL HERE. The UNFREEZE
-- block (index.ts ~3415) patches any field whose parsed value differs from the
-- stored one, so once ingest writes region_code every live row acquires it
-- within one rotation. A SQL backfill would need this repo's five regexes
-- re-expressed in Postgres, and two implementations of one definition is how
-- a column starts meaning two things.
