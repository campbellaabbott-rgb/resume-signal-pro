-- Real, data-backed industry score benchmark — replaces a hardcoded "industry
-- average" table in the free scanner with an actual percentile computed from
-- real completed scans. Falls back to NULL (caller decides what to do) when
-- there isn't enough real data yet for a given industry, rather than ever
-- fabricating a number from a tiny sample.
CREATE OR REPLACE FUNCTION public.get_industry_score_benchmark(
  p_industry TEXT,
  p_score INTEGER,
  p_days_back INTEGER DEFAULT 90,
  p_min_sample_size INTEGER DEFAULT 25
)
RETURNS TABLE (
  industry_avg NUMERIC,
  percentile NUMERIC,
  sample_size BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample_size BIGINT;
  v_avg NUMERIC;
  v_below_or_equal BIGINT;
BEGIN
  SELECT COUNT(*), AVG(response_score)
  INTO v_sample_size, v_avg
  FROM scan_metrics
  WHERE status = 'completed'
    AND scan_type = 'free'
    AND response_score IS NOT NULL
    AND metadata->>'industry' = p_industry
    AND created_at > now() - (p_days_back || ' days')::INTERVAL;

  IF v_sample_size IS NULL OR v_sample_size < p_min_sample_size THEN
    -- Not enough real data yet for this industry — let the caller fall back
    -- rather than computing a percentile from a handful of scans.
    RETURN QUERY SELECT NULL::NUMERIC, NULL::NUMERIC, COALESCE(v_sample_size, 0);
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_below_or_equal
  FROM scan_metrics
  WHERE status = 'completed'
    AND scan_type = 'free'
    AND response_score IS NOT NULL
    AND response_score <= p_score
    AND metadata->>'industry' = p_industry
    AND created_at > now() - (p_days_back || ' days')::INTERVAL;

  RETURN QUERY SELECT
    v_avg,
    ROUND((v_below_or_equal::NUMERIC / v_sample_size::NUMERIC) * 100, 0),
    v_sample_size;
END;
$$;

-- Index to keep the above query fast as scan_metrics grows — industry lives in
-- metadata JSONB, so a plain b-tree on metadata->>'industry' covers the lookup.
CREATE INDEX IF NOT EXISTS idx_scan_metrics_industry_lookup
  ON public.scan_metrics ((metadata->>'industry'))
  WHERE status = 'completed' AND scan_type = 'free';
