-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing; it re-creates two owner-dashboard readers with their signatures unchanged (reviewed 2026-11-17, bug round part B, lane ops-alerts-b).
--
-- THE HEALTH PAGE COUNTS THE FAILURES SCANS WRITE, AND THE ANALYSES IT NEVER
-- SAW (S14X-156).
--
-- 1. get_geo_latency_stats (20251224205114, its only definition) counted
--    status = 'error' as a failure. No writer uses that status: a scan logs
--    'completed', 'failed' or 'validation_error' (free-keyword-scan's
--    logScanMetric), so every country's failure rate on /health-check read
--    0%. It also counted the heartbeat's and the scripts' own probes,
--    logged as scan_type 'heartbeat' and 'synthetic', as visitors' scans.
--    Now a failure is 'failed' or 'validation_error', or a report the model
--    did not write (error_code 'MODEL_FALLBACK', which get_scan_health_status
--    already counts apart), and the probes are left out.
--
-- 2. get_ai_generation_metrics_hourly (20251224180306) kept only rows with
--    content_generation_started_at, which only the delivery lease stamps
--    (take_delivery_lease, 20261011144000). analyze-resume takes no lease and
--    stamps only content_generation_completed_at, so no Full Analysis ever
--    reached the AI Generation chart. Now a row counts when either stamp is
--    set. An entitlement row (pro_subscription, apply_agent, agent_pass) is
--    written with a completion stamp but generates nothing, so it is left
--    out.
--
-- Same signatures and the same RETURNS TABLE, so CREATE OR REPLACE keeps each
-- function's grants; both are in 20261004110000's closed list and admin-ops'
-- ADMIN_RPCS, and the closed grants are re-asserted below anyway, so
-- client_callable_census stays at closed = 56, closed_missing = 0.
--
-- Any order against the functions and the frontend: the columns read and
-- returned are the ones the shipped definitions read and return. Safe to
-- re-run. The self-check at the end raises unless both readers are security
-- definers, closed to anon and authenticated, open to service_role, and carry
-- the new predicates.

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
    COUNT(*) FILTER (WHERE sm.status IN ('failed', 'validation_error') OR sm.error_code = 'MODEL_FALLBACK')::bigint as failed_scans,
    ROUND(
      (COUNT(*) FILTER (WHERE sm.status IN ('failed', 'validation_error') OR sm.error_code = 'MODEL_FALLBACK')::numeric / NULLIF(COUNT(*), 0)::numeric) * 100,
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
    AND sm.scan_type NOT IN ('heartbeat', 'synthetic')
  GROUP BY COALESCE(sm.ip_country, 'Unknown')
  ORDER BY COUNT(*) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_generation_metrics_hourly(p_hours_back integer DEFAULT 24)
RETURNS TABLE(
  hour_bucket timestamptz,
  total_generations bigint,
  successful_generations bigint,
  failed_generations bigint,
  avg_duration_ms numeric,
  success_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc('hour', created_at) as hour_bucket,
    COUNT(*)::bigint as total_generations,
    COUNT(*) FILTER (WHERE generation_success = true)::bigint as successful_generations,
    COUNT(*) FILTER (WHERE generation_success = false)::bigint as failed_generations,
    ROUND(AVG(generation_duration_ms)::numeric, 0) as avg_duration_ms,
    ROUND(
      CASE WHEN COUNT(*) > 0
        THEN COUNT(*) FILTER (WHERE generation_success = true)::numeric / COUNT(*)::numeric * 100
        ELSE 0
      END, 2
    ) as success_rate
  FROM product_deliveries
  WHERE created_at > now() - (p_hours_back || ' hours')::interval
    AND (content_generation_started_at IS NOT NULL OR content_generation_completed_at IS NOT NULL)
    AND COALESCE(product_type, '') NOT IN ('pro_subscription', 'apply_agent', 'agent_pass')
  GROUP BY date_trunc('hour', created_at)
  ORDER BY hour_bucket ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_geo_latency_stats(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ai_generation_metrics_hourly(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_geo_latency_stats(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_generation_metrics_hourly(integer) TO service_role;

DO $self_check$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT v.fn, v.needles, p.oid, p.prosecdef, p.prosrc
    FROM (VALUES
      ('get_geo_latency_stats', ARRAY['''validation_error''', '''MODEL_FALLBACK''', '''heartbeat''', '''synthetic''']),
      ('get_ai_generation_metrics_hourly', ARRAY['content_generation_completed_at IS NOT NULL', '''pro_subscription'''])
    ) AS v(fn, needles)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || v.fn || '(integer)')
  LOOP
    IF r.oid IS NULL THEN
      RAISE EXCEPTION 'S14X-156 self-check: public.%(integer) does not exist', r.fn;
    END IF;
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'S14X-156 self-check: public.%(integer) is not a security definer', r.fn;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'S14X-156 self-check: public.%(integer) is callable by a client role', r.fn;
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'S14X-156 self-check: public.%(integer) is closed to service_role, so admin-ops cannot read it', r.fn;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(r.needles) AS n(needle) WHERE position(n.needle IN r.prosrc) = 0) THEN
      RAISE EXCEPTION 'S14X-156 self-check: public.%(integer) lacks one of its new predicates (%)', r.fn, array_to_string(r.needles, ', ');
    END IF;
  END LOOP;
END
$self_check$;
