-- A CRON THAT ERRORS EVERY RUN AND A HEARTBEAT THAT STOPPED ARE SEEN
-- (S12 sweep, ops: S12-157, S12-160, S12-065).
--
-- 1. cron_http_answers(minutes, error_minutes). cron_http_refusals
--    (20261009143000) let scan-heartbeat fail only on a 401/403: a cron whose
--    function answers 500 on every run read healthy, and a 404 (a job aimed
--    at a function that is gone) was not even counted. This reader returns
--    the refusals over the first window, and over the second (longer, so an
--    hourly job that fails every run is seen three times) the 5xx answers,
--    the timeouts, the 404s, and the newest 5xx's time, status and first 160
--    characters of body (our functions' error text usually names the job;
--    pg_net keeps no url with an answer). available = false where pg_net's
--    table is absent. A timeout is counted, never judged: the crons post
--    with pg_net's default five-second wait, so every long function call
--    reads timed out while the function runs on.
--
--    A NEW function, not a changed one: the live scan-heartbeat reads
--    cron_http_refusals until scan-heartbeat 2026-10-11.28 serves, so that
--    reader stays as it is. SECURITY DEFINER because net._http_response
--    belongs to pg_net; EXECUTE for service_role only.
--
-- 2. get_scan_health_status() graded the heartbeat on itself. Its success
--    rate, latency and "last successful scan" counted every scan_metrics row,
--    and the heartbeat's own uncached scan (scan_type 'heartbeat', six an
--    hour) outnumbered the visitors': the reader said degraded at 100%
--    visitor success, and a visitor's failure disappeared under the probes.
--    It now counts the real scan types only ('free', 'free-stream', 'paid',
--    the set the public counters use), says nothing about an hour with no
--    visitor scan instead of calling it critical, and names a heartbeat that
--    has not run for 30 minutes (three missed runs of its ten-minute cron):
--    the dead-man check-alerts reads (S12-065). Same signature and columns,
--    so its readers (the ScanMetrics page, post-publish-smoke, verify
--    section 63) are unchanged. It stays callable by anon on purpose: those
--    readers carry only the publishable key, and it returns aggregates.
--
-- Safe to re-run: CREATE OR REPLACE, then REVOKE and GRANT by name.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.cron_http_answers(p_minutes integer DEFAULT 60, p_error_minutes integer DEFAULT 180)
RETURNS TABLE (
  available boolean,
  responses integer,
  refused integer,
  last_refused_at timestamptz,
  last_refused_status integer,
  last_refused_sample text,
  error_window_responses integer,
  server_errors integer,
  timed_out integer,
  not_found integer,
  last_error_at timestamptz,
  last_error_status integer,
  last_error_sample text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_min integer := least(greatest(coalesce(p_minutes, 60), 1), 1440);
  v_err integer := least(greatest(coalesce(p_error_minutes, 180), 1), 1440);
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, NULL::timestamptz, NULL::integer, NULL::text,
                        0, 0, 0, 0, NULL::timestamptz, NULL::integer, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT true,
           (count(*) FILTER (WHERE r.created > now() - make_interval(mins => $1)))::int,
           (count(*) FILTER (WHERE r.created > now() - make_interval(mins => $1) AND r.status_code IN (401, 403)))::int,
           max(r.created) FILTER (WHERE r.created > now() - make_interval(mins => $1) AND r.status_code IN (401, 403)),
           (array_agg(r.status_code ORDER BY r.created DESC) FILTER (WHERE r.created > now() - make_interval(mins => $1) AND r.status_code IN (401, 403)))[1],
           left((array_agg(r.content::text ORDER BY r.created DESC) FILTER (WHERE r.created > now() - make_interval(mins => $1) AND r.status_code IN (401, 403)))[1], 160),
           (count(*) FILTER (WHERE r.created > now() - make_interval(mins => $2)))::int,
           (count(*) FILTER (WHERE r.created > now() - make_interval(mins => $2) AND r.status_code >= 500))::int,
           (count(*) FILTER (WHERE r.created > now() - make_interval(mins => $2) AND r.timed_out IS TRUE))::int,
           (count(*) FILTER (WHERE r.created > now() - make_interval(mins => $2) AND r.status_code = 404))::int,
           max(r.created) FILTER (WHERE r.created > now() - make_interval(mins => $2) AND r.status_code >= 500),
           (array_agg(r.status_code ORDER BY r.created DESC) FILTER (WHERE r.created > now() - make_interval(mins => $2) AND r.status_code >= 500))[1],
           left((array_agg(r.content::text ORDER BY r.created DESC) FILTER (WHERE r.created > now() - make_interval(mins => $2) AND r.status_code >= 500))[1], 160)
      FROM net._http_response r
     WHERE r.created > now() - make_interval(mins => greatest($1, $2))
  $q$ USING v_min, v_err;
END;
$$;

COMMENT ON FUNCTION public.cron_http_answers(integer, integer) IS
  'The answers pg_net received: refusals (401/403) over the last p_minutes, and 5xx, timeouts and 404s over the last '
  'p_error_minutes (each 1..1440), with the newest refusal''s and the newest 5xx''s time, status and 160-character body. '
  'available=false without pg_net. service_role only (scan-heartbeat, 20261011200000).';

REVOKE ALL ON FUNCTION public.cron_http_answers(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_http_answers(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_scan_health_status()
RETURNS TABLE (
  status TEXT,
  last_successful_scan TIMESTAMP WITH TIME ZONE,
  scans_last_hour BIGINT,
  success_rate_last_hour NUMERIC,
  avg_latency_last_hour NUMERIC,
  last_heartbeat_status TEXT,
  last_heartbeat_time TIMESTAMP WITH TIME ZONE,
  issues TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_issues TEXT[] := '{}';
  v_success_rate NUMERIC;
  v_avg_latency NUMERIC;
  v_scans_count BIGINT;
  v_completed BIGINT;
  v_last_success TIMESTAMP WITH TIME ZONE;
  v_heartbeat_status TEXT;
  v_heartbeat_time TIMESTAMP WITH TIME ZONE;
  v_heartbeat_age INTEGER;
  v_overall_status TEXT := 'healthy';
BEGIN
  -- Visitors' scans only: the heartbeat's own probe and our scripts'
  -- synthetic scans are not anyone's résumé.
  SELECT count(*),
         count(*) FILTER (WHERE sm.status = 'completed'),
         round((count(*) FILTER (WHERE sm.status = 'completed'))::numeric / NULLIF(count(*), 0) * 100, 2),
         round(avg(sm.duration_ms)::numeric, 0)
    INTO v_scans_count, v_completed, v_success_rate, v_avg_latency
    FROM public.scan_metrics sm
   WHERE sm.created_at > now() - interval '1 hour'
     AND sm.scan_type IN ('free', 'free-stream', 'paid');

  SELECT sm.created_at INTO v_last_success
    FROM public.scan_metrics sm
   WHERE sm.status = 'completed'
     AND sm.scan_type IN ('free', 'free-stream', 'paid')
   ORDER BY sm.created_at DESC
   LIMIT 1;

  SELECT hr.status, hr.created_at INTO v_heartbeat_status, v_heartbeat_time
    FROM public.heartbeat_results hr
   WHERE hr.function_name = 'free-keyword-scan'
   ORDER BY hr.created_at DESC
   LIMIT 1;

  IF v_success_rate IS NOT NULL AND v_success_rate < 90 THEN
    v_issues := array_append(v_issues, 'Visitor scan success below 90%: ' || v_success_rate || '% of ' || v_scans_count);
    v_overall_status := 'degraded';
  END IF;

  IF v_success_rate IS NOT NULL AND v_success_rate < 50 THEN
    v_overall_status := 'critical';
  END IF;

  IF v_scans_count > 0 AND v_completed = 0 THEN
    v_issues := array_append(v_issues, 'Every visitor scan in the last hour failed (' || v_scans_count || ')');
    v_overall_status := 'critical';
  END IF;

  IF v_avg_latency IS NOT NULL AND v_avg_latency > 30000 THEN
    v_issues := array_append(v_issues, 'High visitor scan latency: ' || v_avg_latency || 'ms');
    IF v_overall_status = 'healthy' THEN v_overall_status := 'degraded'; END IF;
  END IF;

  IF v_heartbeat_status IS NOT NULL AND v_heartbeat_status <> 'healthy' THEN
    v_issues := array_append(v_issues, 'Last heartbeat: ' || v_heartbeat_status);
    IF v_overall_status = 'healthy' THEN v_overall_status := 'degraded'; END IF;
  END IF;

  -- The dead-man: the heartbeat runs every ten minutes, so 30 is three missed runs.
  v_heartbeat_age := CASE WHEN v_heartbeat_time IS NULL THEN NULL
                          ELSE floor(extract(epoch FROM (now() - v_heartbeat_time)) / 60)::integer END;
  IF v_heartbeat_time IS NULL THEN
    v_issues := array_append(v_issues, 'Heartbeat has never run');
    v_overall_status := 'critical';
  ELSIF v_heartbeat_age > 30 THEN
    v_issues := array_append(v_issues, 'Heartbeat has not run for ' || v_heartbeat_age || ' min');
    v_overall_status := 'critical';
  END IF;

  RETURN QUERY SELECT
    v_overall_status,
    v_last_success,
    COALESCE(v_scans_count, 0),
    COALESCE(v_success_rate, 0),
    COALESCE(v_avg_latency, 0),
    v_heartbeat_status,
    v_heartbeat_time,
    v_issues;
END;
$$;

COMMENT ON FUNCTION public.get_scan_health_status() IS
  'Visitor scans (free, free-stream, paid) over the last hour, the newest completed one, the last heartbeat and its age: '
  'a heartbeat older than 30 minutes is critical (the dead-man check-alerts reads). Aggregates only; anon-callable for '
  'the ScanMetrics page and post-publish-smoke (20261011200000).';

REVOKE ALL ON FUNCTION public.get_scan_health_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_health_status() TO anon, authenticated, service_role;

-- Self-verifying. The new reader is service-role only and answers a row; the
-- health reader is a definer with a fixed search_path, still callable by the
-- three roles its readers use, and, inside a savepoint that is rolled back,
-- counts a visitor scan and ignores three of the heartbeat's own.
DO $verify$
DECLARE
  v_sig regprocedure := to_regprocedure('public.cron_http_answers(integer, integer)');
  v_hs regprocedure := to_regprocedure('public.get_scan_health_status()');
  v_row record;
  v_before bigint;
  v_after_probe bigint;
  v_after_visit bigint;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'cron_http_answers(integer, integer) does not exist after this file';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('authenticated', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'cron_http_answers is not service-role only';
  END IF;
  SELECT * INTO v_row FROM public.cron_http_answers(60, 180);
  IF v_row.available IS NULL OR v_row.server_errors IS NULL OR v_row.not_found IS NULL THEN
    RAISE EXCEPTION 'cron_http_answers answered no row';
  END IF;

  IF v_hs IS NULL THEN
    RAISE EXCEPTION 'get_scan_health_status() does not exist after this file';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_hs::oid)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_hs::oid AND proconfig::text LIKE '%search_path=public%') THEN
    RAISE EXCEPTION 'get_scan_health_status is not a definer with a fixed search_path';
  END IF;
  IF NOT has_function_privilege('anon', v_hs, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_hs, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_scan_health_status lost the grants its readers use';
  END IF;

  BEGIN
    SELECT scans_last_hour INTO v_before FROM public.get_scan_health_status();
    INSERT INTO public.scan_metrics (scan_type, status, duration_ms)
    VALUES ('heartbeat', 'completed', 900), ('heartbeat', 'completed', 900), ('synthetic', 'failed', 900);
    SELECT scans_last_hour INTO v_after_probe FROM public.get_scan_health_status();
    INSERT INTO public.scan_metrics (scan_type, status, duration_ms) VALUES ('free', 'completed', 900);
    SELECT scans_last_hour INTO v_after_visit FROM public.get_scan_health_status();
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'w4b-ops-probe-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'w4b-ops-probe-rollback' THEN RAISE; END IF;
  END;
  IF v_after_probe IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'get_scan_health_status counted our own probes (% -> %)', v_before, v_after_probe;
  END IF;
  IF v_after_visit IS DISTINCT FROM v_before + 1 THEN
    RAISE EXCEPTION 'get_scan_health_status did not count a visitor scan (% -> %)', v_before, v_after_visit;
  END IF;
  RAISE NOTICE 'cron_http_answers: available %, % 5xx and % 404 in three hours; get_scan_health_status counts visitor scans only (% this hour)',
    v_row.available, v_row.server_errors, v_row.not_found, v_before;
END
$verify$;
