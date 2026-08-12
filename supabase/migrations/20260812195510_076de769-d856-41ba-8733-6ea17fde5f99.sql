CREATE OR REPLACE FUNCTION public.refresh_job_board_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4min'
AS $$
BEGIN
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
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: freshness unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: freshness unavailable (%)', SQLERRM;
  END;

  BEGIN
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
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
  END;
END $$;

COMMENT ON FUNCTION public.refresh_job_board_stats() IS
  'Every-15-min rollup writer for freshness and date_coverage. Each INSERT degrades independently — a timeout (QUERY_CANCELED, which WHEN OTHERS does not catch) or any other failure skips one row and leaves the previous value standing under its own older computed_at, which is the staleness signal readers already use. It died whole at 120s with no handlers until 2026-08-12.';

NOTIFY pgrst, 'reload schema';