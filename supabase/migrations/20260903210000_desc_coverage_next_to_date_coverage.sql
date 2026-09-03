-- DESCRIPTION COVERAGE, NEXT TO DATE COVERAGE.
--
-- The fit ranking can only score a posting that has a stored description of
-- more than 150 characters. Measured 2026-09-03 on live pages: accountant and
-- warehouse searches were 75-80% scoreable, software 70%, registered nurse
-- 35%, and the default browse 0-30% — its newest rows have not been swept
-- yet. That ceiling on every fit-quality effort was invisible: status carried
-- date coverage per vendor (`date_coverage`) and nothing for descriptions, so
-- "which vendors are starving the scorer" could not be answered.
--
-- Re-issued from the latest definition of this function (20260812234500),
-- not from the group's — the 20260901090000 lesson — with one block added and
-- the same per-row degradation: a timeout or failure skips this row and
-- leaves the previous value standing under its older computed_at.

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

  -- Scoreable = has a description the scorer will accept (>150 chars), the
  -- exact threshold fit-batch applies before returning a number instead of a
  -- null. Same shape as date_coverage so every reader can treat them alike.
  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'desc_coverage',
      COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'described', described)
                         ORDER BY total DESC), '[]'::jsonb),
      now()
    FROM (
      SELECT source,
             count(*) AS total,
             count(*) FILTER (WHERE description IS NOT NULL AND length(description) > 150) AS described
      FROM public.job_board_postings
      WHERE missing_since IS NULL
      GROUP BY source
    ) s
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
  END;
END $$;

COMMENT ON FUNCTION public.refresh_job_board_stats() IS
  'Every-15-min rollup writer for freshness, date_coverage and desc_coverage. '
  'Each INSERT degrades independently — a timeout (QUERY_CANCELED, which WHEN '
  'OTHERS does not catch) or any other failure skips one row and leaves the '
  'previous value standing under its own older computed_at. desc_coverage '
  'added 2026-09-03: scoreable = description longer than 150 chars, the '
  'threshold fit-batch applies.';

NOTIFY pgrst, 'reload schema';
