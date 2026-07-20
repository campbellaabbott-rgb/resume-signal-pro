-- Discovery collections for the /explore page. Two anon-safe, read-only
-- aggregates over data we already have — no new columns, no indexes (the
-- existing effective_posted + company_token indexes serve these). Both are
-- SECURITY DEFINER SELECT-only with a statement-timeout guard, matching the
-- established discovery-RPC pattern (get_actively_hiring_companies etc).

-- Trending: companies genuinely adding volume this week (honest "fastest
-- growing" — measured recent postings, not a vanity label). >=3 recent so a
-- single new role can't call a company trending.
CREATE OR REPLACE FUNCTION public.get_trending_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, recent bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  SELECT max(company) AS company,
         company_token,
         count(*) FILTER (WHERE effective_posted >= now() - interval '7 days') AS recent,
         count(*) AS open_roles
  FROM public.job_board_postings
  GROUP BY company_token
  HAVING count(*) FILTER (WHERE effective_posted >= now() - interval '7 days') >= 3
  ORDER BY recent DESC, open_roles DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_companies(int) TO anon, authenticated;

-- Newest: companies whose EARLIEST posting first appeared in the last 14 days
-- — genuinely newly-added boards (first_seen is set once at insert, never
-- rewritten). >=3 roles so a board mid-first-ingest doesn't show half-empty.
CREATE OR REPLACE FUNCTION public.get_newest_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, open_roles bigint, first_added timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  SELECT max(company) AS company,
         company_token,
         count(*) AS open_roles,
         min(first_seen) AS first_added
  FROM public.job_board_postings
  GROUP BY company_token
  HAVING min(first_seen) >= now() - interval '14 days' AND count(*) >= 3
  ORDER BY min(first_seen) DESC, count(*) DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_newest_companies(int) TO anon, authenticated;