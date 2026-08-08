CREATE OR REPLACE FUNCTION public.refresh_ghost_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
AS $$
BEGIN
  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  SELECT 'ghost_stats', to_jsonb(s), now()
  FROM (
    WITH RECURSIVE
    counts AS (
      SELECT
        count(*) FILTER (WHERE missing_since IS NULL)         AS open_n,
        count(posted_at) FILTER (WHERE missing_since IS NULL) AS dated_n
      FROM public.job_board_postings
    ),
    tok AS (
        (SELECT p.company_token AS v
           FROM public.job_board_postings p
          WHERE p.company_token IS NOT NULL AND p.missing_since IS NULL
          ORDER BY p.company_token
          LIMIT 1)
      UNION ALL
        SELECT (SELECT p.company_token
                  FROM public.job_board_postings p
                 WHERE p.company_token > tok.v AND p.missing_since IS NULL
                 ORDER BY p.company_token
                 LIMIT 1)
          FROM tok
         WHERE tok.v IS NOT NULL
    ),
    nm AS (
        (SELECT p.company AS v
           FROM public.job_board_postings p
          WHERE p.company <> '' AND p.missing_since IS NULL
          ORDER BY p.company
          LIMIT 1)
      UNION ALL
        SELECT (SELECT p.company
                  FROM public.job_board_postings p
                 WHERE p.company > nm.v AND p.company <> '' AND p.missing_since IS NULL
                 ORDER BY p.company
                 LIMIT 1)
          FROM nm
         WHERE nm.v IS NOT NULL
    )
    SELECT
      (SELECT open_n FROM counts)                                    AS total_open,
      (SELECT count(*) FROM tok WHERE v IS NOT NULL)                 AS total_companies,
      (SELECT count(*) FROM nm  WHERE v IS NOT NULL)                 AS total_company_names,
      (SELECT count(*) FROM public.job_board_closures
        WHERE closed_at > now() - interval '90 days')                AS closed_90d,
      (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
         FROM public.job_board_closures)                             AS observed_days,
      (SELECT round(GREATEST(EXTRACT(EPOCH FROM (now() - p.posted_at)) / 86400.0, 0)::numeric, 1)
         FROM public.job_board_postings p
        WHERE p.missing_since IS NULL AND p.posted_at IS NOT NULL
        ORDER BY p.posted_at
       OFFSET GREATEST((SELECT dated_n FROM counts) / 2, 0)
        LIMIT 1)                                                     AS median_days_open,
      (SELECT round((percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
       FROM public.job_board_closures
       WHERE closed_at > now() - interval '90 days'
         AND posted_at IS NOT NULL
         AND closed_at >= posted_at)                                 AS median_days_to_close,
      (SELECT CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END
         FROM counts)                                                AS posted_coverage_pct
  ) s
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;

REVOKE ALL ON FUNCTION public.refresh_ghost_stats() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();

CREATE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  total_company_names bigint,
  closed_90d bigint,
  observed_days integer,
  median_days_open numeric,
  median_days_to_close numeric,
  posted_coverage_pct numeric,
  computed_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT (r.v->>'total_open')::bigint,
         (r.v->>'total_companies')::bigint,
         (r.v->>'total_company_names')::bigint,
         (r.v->>'closed_90d')::bigint,
         (r.v->>'observed_days')::integer,
         (r.v->>'median_days_open')::numeric,
         (r.v->>'median_days_to_close')::numeric,
         (r.v->>'posted_coverage_pct')::numeric,
         r.computed_at
  FROM public.job_board_stats_rollup r
  WHERE r.k = 'ghost_stats' AND (r.v->>'total_open') IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

COMMENT ON FUNCTION public.get_ghost_job_index_stats() IS
  'Serves precomputed Ghost Job Index stats from job_board_stats_rollup. The computation lives in refresh_ghost_stats() — median_days_open is measured from the employer stated posted_at and never from first_seen, and every count filters missing_since IS NULL. Never aggregates on the request path.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent — refresh_ghost_stats must be called by the refresh job instead';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-ghost-stats') THEN
    PERFORM cron.unschedule('refresh-ghost-stats');
  END IF;
  PERFORM cron.schedule('refresh-ghost-stats', '5,35 * * * *',
    $job$ SELECT public.refresh_ghost_stats(); $job$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-stats-cache') THEN
    PERFORM cron.unschedule('refresh-stats-cache');
  END IF;
  PERFORM cron.schedule('refresh-stats-cache', '12 * * * *',
    $job$ SELECT public.refresh_stats_cache(); $job$);
END $$;