-- Closure two-pass confirmation: a posting absent from ONE successful fetch is
-- no longer closed+deleted immediately. It gets stamped missing_since and only
-- closes when still absent after a grace period — so a feed that transiently
-- returns a partial job list (HTTP 200, half the jobs) can no longer mass-log
-- false closures, corrupt hiring-health stats, or reset first_seen by
-- delete+reinsert churn. Reads are unaffected: the list query already filters
-- by the freshness window, and a missing-stamped row was being served anyway.
ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS missing_since timestamptz;

-- Per-vendor stated-date coverage: which hiring systems tell us when a role
-- was posted, and for what share of their postings. Surfaces in the status
-- endpoint (operations) and the heartbeat (a vendor whose coverage collapses
-- means its date parser regressed — caught the Lever evergreen bug by hand,
-- this catches the next one automatically).
CREATE OR REPLACE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT source, count(*) AS total, count(posted_at) AS dated
  FROM public.job_board_postings
  GROUP BY source
  ORDER BY count(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;

-- Country filter: deterministic country extracted from the posting's own
-- location text (explicit country names / US-state / CA-province patterns —
-- never city geocoding). NULL when we can't place it; those rows are simply
-- excluded from the country filter and say so in the UI.
ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS country text;
CREATE INDEX IF NOT EXISTS job_board_postings_country_idx
  ON public.job_board_postings (country) WHERE country IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_country_facet()
RETURNS TABLE (country text, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT country, count(*) AS n
  FROM public.job_board_postings
  WHERE country IS NOT NULL
  GROUP BY country
  ORDER BY count(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_country_facet() TO anon, authenticated;
