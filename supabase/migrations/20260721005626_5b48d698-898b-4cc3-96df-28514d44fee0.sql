-- Explore page latency: the five collection aggregates run full GROUP BYs
-- over 557k rows on every page load — measured live at 13.2s concurrent wall
-- time, dominated by get_entry_level_companies (~11.5s), trending (~3.2s) and
-- newest (~2.9s). These signals ("hiring fastest this week", "fills roles in
-- 90d", "just added") move on a day/week timescale, so per-visit recomputation
-- is pure waste. Cache all five into one meta row, refreshed hourly by cron;
-- the page reads that single row (<0.5s). No new index (the aggregates aren't
-- index-accelerable and index builds are the outage risk); nothing touches the
-- board's serving path.
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT max(company) AS company, company_token,
               count(*) FILTER (WHERE effective_posted >= now() - interval '7 days') AS recent,
               count(*) AS open_roles
        FROM public.job_board_postings
        GROUP BY company_token
        HAVING count(*) FILTER (WHERE effective_posted >= now() - interval '7 days') >= 3
        ORDER BY recent DESC, open_roles DESC
        LIMIT 12) x),
    'newest', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT max(company) AS company, company_token, count(*) AS open_roles, min(first_seen) AS first_added
        FROM public.job_board_postings
        GROUP BY company_token
        HAVING min(first_seen) >= now() - interval '14 days' AND count(*) >= 3
        ORDER BY min(first_seen) DESC, count(*) DESC
        LIMIT 12) x),
    'entry',  (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'salary', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

-- Fast anon read of the cached collections (single-row lookup).
CREATE OR REPLACE FUNCTION public.get_explore_cache()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT v FROM public.job_board_meta WHERE k = 'explore_cache'; $$;
GRANT EXECUTE ON FUNCTION public.get_explore_cache() TO anon, authenticated;

-- Refresh hourly (minute 7).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-explore-cache') THEN
    PERFORM cron.schedule('refresh-explore-cache', '7 * * * *', 'SELECT public.refresh_explore_cache();');
  END IF;
END $$;

-- Populate once so Explore is fast immediately after deploy. Bounded + guarded
-- so a slow one-time compute can never fail the migration (the cron populates
-- regardless, and the page falls back to live RPCs until the row exists).
DO $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;