-- Windowed-board closure purge. Proven live 2026-07-21: Workday tenants holding
-- more postings than WORKDAY_PAGE_CAP lets us fetch (25 pages x 20 = 500) have
-- ROTATING window membership — newer postings push older ones out, the prune
-- treated "missing from window" as closed, and after 7 days of stated tenure
-- they ranked as genuine fills. Direct check against companies' own APIs:
-- Caterpillar real total 942 (we stored 503), AstraZeneca 1326 (505), Four
-- Seasons 1954 (500); 7 of 8 sampled Caterpillar "closures" were STILL OPEN on
-- the company site. The edge function now flags windowed fetches and prunes
-- them WITHOUT logging closures (same rule SmartRecruiters already had at
-- SR_CAP). This migration removes the closure history those windows fabricated:
-- every Workday board currently pinned at/near the fetch window (>=450 stored)
-- has an untrustworthy log — delete it entirely rather than keep fake fills.
-- Under-deleting keeps fabricated data; over-deleting only delays real stats.
-- Complete-feed Workday boards (well under the window) keep their real history.

DELETE FROM public.job_board_closures
WHERE company_token IN (
  SELECT company_token
  FROM public.job_board_postings
  WHERE company_token LIKE '%~wd%'
  GROUP BY company_token
  HAVING count(*) >= 450
);

-- Rebuild the explore cache so "Companies that actually fill roles" reflects
-- only trustworthy (feed-exhausted) boards immediately.
DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
