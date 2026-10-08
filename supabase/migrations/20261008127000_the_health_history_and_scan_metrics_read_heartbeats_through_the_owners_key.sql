-- THE HEALTH HISTORY AND SCAN METRICS READ HEARTBEATS THROUGH THE OWNER'S KEY
-- (wave 2 email-ops, the rest of register L3-08; follows 20261008123000).
--
-- 20261008123000 moved /health-check's recent-heartbeat card to admin-ops,
-- but two more panels the register names still read heartbeat_results with
-- the publishable key, which 20260627121655 revoked: the Health History card
-- on the same page (HealthHistoryChart) threw, kept its zero state and
-- printed "0%" uptime in red with "0ms" latency under a card that now says
-- "unavailable", and /scan-metrics' Recent Heartbeat Results showed "No
-- heartbeat results yet". get_recent_heartbeats carries neither the 24 hours,
-- the other probes' rows nor the per-check detail those panels draw, so this
-- is their reader: a window of hours (1 to 168), optionally one function,
-- newest first, at most 5000 rows, with the per-check results, the probes'
-- latencies and the first 300 characters of the error. INVOKER, closed to the
-- client roles by name, served by admin-ops behind the ADMIN_API_KEY. Safe to
-- re-run.

GRANT SELECT ON public.heartbeat_results TO service_role;

CREATE OR REPLACE FUNCTION public.get_heartbeat_history(
  p_hours integer DEFAULT 24,
  p_function text DEFAULT NULL,
  p_limit integer DEFAULT 2000
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  function_name text,
  status text,
  test_passed boolean,
  response_time_ms integer,
  error_message text,
  checks_passed jsonb,
  probes jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT h.id, h.created_at, h.function_name, h.status, h.test_passed, h.response_time_ms,
         left(h.error_message, 300), h.checks_passed, h.metadata -> 'probes'
    FROM public.heartbeat_results h
   WHERE h.created_at > now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168))
     AND (p_function IS NULL OR h.function_name = p_function)
   ORDER BY h.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 2000), 1), 5000);
$$;

COMMENT ON FUNCTION public.get_heartbeat_history(integer, text, integer) IS
  'Heartbeat and health-probe results over the last p_hours (1-168), optionally one function, newest first: status, latency, per-check results, probe latencies, error text cut at 300. For /health-check''s history card and /scan-metrics through admin-ops. Service role only.';

REVOKE ALL ON FUNCTION public.get_heartbeat_history(integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_heartbeat_history(integer, text, integer) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.get_heartbeat_history(integer, text, integer)') IS NULL THEN
    RAISE EXCEPTION 'self-check: get_heartbeat_history(integer, text, integer) was not created';
  END IF;
  IF has_function_privilege('anon', 'public.get_heartbeat_history(integer, text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_heartbeat_history(integer, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role can run get_heartbeat_history';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_heartbeat_history(integer, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: admin-ops (service role) cannot run get_heartbeat_history';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_heartbeat_history(integer, text, integer)'::regprocedure) THEN
    RAISE EXCEPTION 'self-check: get_heartbeat_history must run as its caller';
  END IF;
  -- It reads: one call over the live table, whatever it holds.
  PERFORM count(*) FROM public.get_heartbeat_history(1, NULL, 1);
END $$;
