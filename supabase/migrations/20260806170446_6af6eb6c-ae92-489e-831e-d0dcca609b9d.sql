-- The two stats RPCs behind the public status endpoint stopped answering.
CREATE TABLE IF NOT EXISTS public.job_board_stats_rollup (
  k text PRIMARY KEY,
  v jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_board_stats_rollup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_board_stats_rollup_read ON public.job_board_stats_rollup;
CREATE POLICY job_board_stats_rollup_read
  ON public.job_board_stats_rollup FOR SELECT USING (true);

GRANT SELECT ON public.job_board_stats_rollup TO anon, authenticated;
GRANT ALL ON public.job_board_stats_rollup TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_job_board_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  SELECT
    'freshness',
    jsonb_build_object(
      'boards',   count(*),
      'p50_min',  round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY age_min))::numeric, 1),
      'p95_min',  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY age_min))::numeric, 1),
      'max_min',  round((max(age_min))::numeric, 1)
    ),
    now()
  FROM (
    SELECT EXTRACT(EPOCH FROM (now() - ver.verified_at)) / 60.0 AS age_min
    FROM public.job_board_verifications ver
    WHERE EXISTS (
      SELECT 1 FROM public.job_board_postings p
      WHERE p.company_token = ver.company_token
    )
  ) live
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;

  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  SELECT
    'date_coverage',
    COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'dated', dated)
                       ORDER BY total DESC), '[]'::jsonb),
    now()
  FROM (
    SELECT source, count(*) AS total, count(posted_at) AS dated
    FROM public.job_board_postings
    WHERE missing_since IS NULL
    GROUP BY source
  ) s
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;

REVOKE ALL ON FUNCTION public.refresh_job_board_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_job_board_stats() FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.get_freshness_stats();
DROP FUNCTION IF EXISTS public.get_date_coverage();

CREATE FUNCTION public.get_freshness_stats()
RETURNS TABLE (boards integer, p50_min numeric, p95_min numeric, max_min numeric, computed_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT (r.v->>'boards')::int,
         (r.v->>'p50_min')::numeric,
         (r.v->>'p95_min')::numeric,
         (r.v->>'max_min')::numeric,
         r.computed_at
  FROM public.job_board_stats_rollup r
  WHERE r.k = 'freshness' AND (r.v->>'p95_min') IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_freshness_stats() TO anon, authenticated;

CREATE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint, computed_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT e.value->>'source',
         (e.value->>'total')::bigint,
         (e.value->>'dated')::bigint,
         r.computed_at
  FROM public.job_board_stats_rollup r
  CROSS JOIN LATERAL jsonb_array_elements(r.v) AS e(value)
  WHERE r.k = 'date_coverage'
  ORDER BY (e.value->>'total')::bigint DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-stats-rollup') THEN
      PERFORM cron.unschedule('job-board-stats-rollup');
    END IF;
    PERFORM cron.schedule(
      'job-board-stats-rollup',
      '*/15 * * * *',
      $job$ SELECT public.refresh_job_board_stats(); $job$
    );
  END IF;
END $$;

DO $$
BEGIN
  PERFORM public.refresh_job_board_stats();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'job_board_stats_rollup seed failed (%), leaving it to the 15-minute cron', SQLERRM;
END $$;