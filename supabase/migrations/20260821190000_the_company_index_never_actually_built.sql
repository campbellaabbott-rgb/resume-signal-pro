-- THE COMPANY INDEX NEVER BUILT, AND I SHIPPED CODE THAT DEPENDED ON IT.
--
-- 20260821170000 schedules a pg_cron one-shot to create
-- job_board_postings_company_simple_fts_idx; 20260821170100 unschedules it.
-- Applied in the same pass, the job never gets a chance to fire — cron ticks
-- once a minute, and the unschedule arrives first. I wrote both files in one
-- push and told the deployer to apply them in order with a verification step
-- between; that instruction was the only thing standing between the index
-- existing and not, and instructions are not a mechanism.
--
-- HOW IT WENT UNNOTICED. Serially, company=wfts(simple).IT returns in ~1.2s and
-- looks merely slow. MEASURED under four concurrent identical requests:
--   company=wfts(simple).IT  ->  500 500 500 500
--   title=wfts(simple).IT    ->  200 200 200 200   (indexed, for contrast)
-- A sequential scan over 602,880 rows survives one caller and dies at four.
-- Every check I ran was one request at a time, so every check passed.
--
-- THIS FILE ONLY SCHEDULES. There is deliberately no companion unschedule this
-- time: the pair is what broke it. Unschedule from a SEPARATE later push, after
-- confirming at concurrency:
--   for i in 1 2 3 4; do curl -s -o /dev/null -w '%{http_code} ' \
--     ".../job_board_postings?select=id&company=wfts(simple).IT&limit=60" & done
--   -> must print 200 200 200 200
--
-- The edge function's company matcher is DISABLED until then, so nothing
-- depends on this having run. That ordering is now enforced by the code rather
-- than by a note in a deploy message.

SELECT cron.schedule(
  'oneshot_company_simple_fts_idx',
  '* * * * *',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_company_simple_fts_idx ON public.job_board_postings USING gin (to_tsvector(''simple'', company))'
);
