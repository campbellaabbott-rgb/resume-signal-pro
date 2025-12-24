-- Create function to get latency stats by country
CREATE OR REPLACE FUNCTION public.get_geo_latency_stats(p_hours_back integer DEFAULT 24)
RETURNS TABLE(
  country text,
  total_scans bigint,
  failed_scans bigint,
  failure_rate numeric,
  avg_latency_ms numeric,
  p50_latency_ms numeric,
  p95_latency_ms numeric,
  min_latency_ms integer,
  max_latency_ms integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(sm.ip_country, 'Unknown') as country,
    COUNT(*)::bigint as total_scans,
    COUNT(*) FILTER (WHERE sm.status = 'error')::bigint as failed_scans,
    ROUND(
      (COUNT(*) FILTER (WHERE sm.status = 'error')::numeric / NULLIF(COUNT(*), 0)::numeric) * 100, 
      2
    ) as failure_rate,
    ROUND(AVG(sm.duration_ms)::numeric, 0) as avg_latency_ms,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sm.duration_ms)::numeric, 0) as p50_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY sm.duration_ms)::numeric, 0) as p95_latency_ms,
    MIN(sm.duration_ms) as min_latency_ms,
    MAX(sm.duration_ms) as max_latency_ms
  FROM scan_metrics sm
  WHERE sm.created_at >= NOW() - (p_hours_back || ' hours')::interval
    AND sm.duration_ms IS NOT NULL
  GROUP BY COALESCE(sm.ip_country, 'Unknown')
  ORDER BY COUNT(*) DESC;
END;
$$;