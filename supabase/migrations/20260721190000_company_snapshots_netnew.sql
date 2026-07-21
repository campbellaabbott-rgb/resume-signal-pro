-- "Hiring fastest this week" was un-fixable from the columns we had. Proven live:
--   * first_seen is NOT a true first-observation time — a mass re-ingest around
--     2026-07-11 reset it for the whole table (oldest first_seen in 557k rows =
--     2026-07-11, nothing older). So there is no "established board" cohort to
--     gate on; every census-fresh board looks brand-new.
--   * posted_at is a rolling <=30-day vendor field (all 404k dated rows fall
--     within 30d; Workday only stamps a date when it's <=30d old, else NULL) and
--     resets on every repost. Ranking by it just surfaces the biggest boards we
--     ingested most recently — the exact ~500 plateau (Workday boards where
--     recent == total, i.e. 100% of open roles "posted this week").
-- Neither can honestly express hiring VELOCITY. The only honest source is one we
-- accrue ourselves: snapshot each company's live open-role count once a day, and
-- read net-new as (today - ~7-days-ago) for companies present in BOTH snapshots.
-- This is immune to first_seen resets, immune to posted_at rollover, immune to
-- reposts (a repost doesn't change the net count), and it auto-excludes
-- census-fresh boards (they weren't in the earlier snapshot). It starts empty and
-- fills in over the next days — honest by construction, no fabricated history.

-- Daily per-company open-role snapshot. Small (a few thousand rows/day, 35-day
-- retention) and aggregate/public, so world-readable; writes are function-only.
CREATE TABLE IF NOT EXISTS public.job_board_company_snapshots (
  company_token text NOT NULL,
  snapshot_date date NOT NULL,
  company text NOT NULL DEFAULT '',
  open_roles integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_token, snapshot_date)
);
CREATE INDEX IF NOT EXISTS job_board_company_snapshots_date_idx
  ON public.job_board_company_snapshots (snapshot_date);

ALTER TABLE public.job_board_company_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_board_company_snapshots_public_read" ON public.job_board_company_snapshots;
CREATE POLICY "job_board_company_snapshots_public_read"
  ON public.job_board_company_snapshots FOR SELECT USING (true);

-- Take today's snapshot (idempotent: re-running the same day overwrites it).
-- One full-table GROUP BY, run under cron/service role (no anon timeout cap) with
-- its own guard so it can never hang a request path. Not on the board serving
-- path; no CREATE INDEX.
CREATE OR REPLACE FUNCTION public.snapshot_company_counts()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '90s'
AS $$
BEGIN
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, company, open_roles)
  SELECT company_token, current_date, max(company), count(*)::int
  FROM public.job_board_postings
  GROUP BY company_token
  ON CONFLICT (company_token, snapshot_date)
  DO UPDATE SET open_roles = EXCLUDED.open_roles, company = EXCLUDED.company;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_company_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_company_counts() TO service_role;

-- Net-new trending: today's snapshot minus the oldest snapshot within the last 7
-- days, for companies in BOTH (INNER JOIN = the board existed then, so genuine
-- growth, not initial ingestion). Window self-widens to a true 7 days as history
-- accrues; empty until there are >=2 snapshot days. `recent` = net-new roles.
CREATE OR REPLACE FUNCTION public.get_trending_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, recent bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH latest AS (
    SELECT max(snapshot_date) AS d FROM public.job_board_company_snapshots
  ),
  baseline AS (
    SELECT min(snapshot_date) AS d
    FROM public.job_board_company_snapshots
    WHERE snapshot_date >= (SELECT d FROM latest) - 7
      AND snapshot_date <  (SELECT d FROM latest)
  )
  SELECT n.company,
         n.company_token,
         (n.open_roles - b.open_roles)::bigint AS recent,
         n.open_roles::bigint                  AS open_roles
  FROM public.job_board_company_snapshots n
  JOIN public.job_board_company_snapshots b
    ON b.company_token = n.company_token
   AND b.snapshot_date = (SELECT d FROM baseline)
  WHERE n.snapshot_date = (SELECT d FROM latest)
    AND (n.open_roles - b.open_roles) >= 3
  ORDER BY recent DESC, n.open_roles DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_companies(int) TO anon, authenticated;

-- Explore cache builder: trending now reads the net-new RPC (single source of
-- truth); the other four collections are unchanged.
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
                 FROM public.get_trending_companies(12) x),
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

-- Schedule the daily snapshot (02:30) and a 35-day retention prune (02:40).
-- Guarded + idempotent, like the other cron jobs; no-ops where pg_cron is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-company-counts') THEN
      PERFORM cron.schedule('snapshot-company-counts', '30 2 * * *',
        'SELECT public.snapshot_company_counts();');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'company-snapshots-retention') THEN
      PERFORM cron.schedule('company-snapshots-retention', '40 2 * * *',
        $job$ DELETE FROM public.job_board_company_snapshots WHERE snapshot_date < current_date - 35; $job$);
    END IF;
  END IF;
END $$;

-- Seed today's snapshot immediately so the net-new clock starts now (guarded so
-- it can never fail the migration). Tomorrow's snapshot gives the first real
-- 1-day net-new; a genuine 7-day window is in place within a week.
DO $$
BEGIN
  SET LOCAL statement_timeout = '90s';
  PERFORM public.snapshot_company_counts();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Rebuild the explore cache now (trending will be empty today — correct: no
-- fake velocity — and populates as snapshots accrue).
DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
