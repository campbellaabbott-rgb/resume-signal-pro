-- A CRON CALL ITS FUNCTION REFUSED IS COUNTED, NOT READ AS SUCCESS (S8-051).
--
-- A function cron's run records 'succeeded' in 0.0 s whatever the function
-- answered: net.http_post only queues the request, and get_cron_health reads
-- only cron.job_run_details. Nothing read the answers pg_net keeps in
-- net._http_response (about six hours), so a key mismatch after a re-key, a
-- verify_jwt flip or a 401 on every run looked exactly like health.
--
-- cron_http_refusals(minutes) counts those answers over the window: all of
-- them, the refusals (401/403: a key or a gate, never transient), the 5xx,
-- the timeouts, and the newest refusal's time, status and first 160
-- characters of body (our own functions' refusal text names the gate). It
-- cannot say WHICH job (pg_net keeps no url with the answer); the body
-- sample usually does. available = false where pg_net's table is absent.
--
-- SECURITY DEFINER because net._http_response is pg_net's, not the service
-- role's; EXECUTE for service_role only (scan-heartbeat reads it and alerts
-- on refusals). Not callable by anon or authenticated.
--
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.cron_http_refusals(p_minutes integer DEFAULT 60)
RETURNS TABLE (
  available boolean,
  responses integer,
  refused integer,
  server_errors integer,
  timed_out integer,
  last_refused_at timestamptz,
  last_refused_status integer,
  last_refused_sample text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0, NULL::timestamptz, NULL::integer, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT true,
           count(*)::int,
           (count(*) FILTER (WHERE r.status_code IN (401, 403)))::int,
           (count(*) FILTER (WHERE r.status_code >= 500))::int,
           (count(*) FILTER (WHERE r.timed_out IS TRUE))::int,
           max(r.created) FILTER (WHERE r.status_code IN (401, 403)),
           (array_agg(r.status_code ORDER BY r.created DESC) FILTER (WHERE r.status_code IN (401, 403)))[1],
           left((array_agg(r.content::text ORDER BY r.created DESC) FILTER (WHERE r.status_code IN (401, 403)))[1], 160)
      FROM net._http_response r
     WHERE r.created > now() - make_interval(mins => $1)
  $q$ USING least(greatest(coalesce(p_minutes, 60), 1), 1440);
END;
$$;

COMMENT ON FUNCTION public.cron_http_refusals(integer) IS
  'Counts the answers pg_net received over the last p_minutes (1..1440): all, 401/403 refusals, 5xx, timeouts, '
  'and the newest refusal''s time, status and 160-character body sample. available=false without pg_net. '
  'service_role only (scan-heartbeat).';

REVOKE ALL ON FUNCTION public.cron_http_refusals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_http_refusals(integer) TO service_role;

DO $verify$
DECLARE
  v_sig regprocedure := to_regprocedure('public.cron_http_refusals(integer)');
  v_row record;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'cron_http_refusals(integer) does not exist after this file';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('authenticated', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'cron_http_refusals is not service-role only';
  END IF;
  SELECT * INTO v_row FROM public.cron_http_refusals(60);
  IF v_row.available IS NULL OR v_row.responses IS NULL THEN
    RAISE EXCEPTION 'cron_http_refusals answered no row';
  END IF;
  RAISE NOTICE 'cron_http_refusals: available %, % answers and % refusals in the last hour', v_row.available, v_row.responses, v_row.refused;
END
$verify$;
