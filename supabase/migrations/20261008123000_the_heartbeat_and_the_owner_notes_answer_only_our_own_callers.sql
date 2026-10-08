-- THE HEARTBEAT AND THE OWNER'S SIGN-UP NOTE ANSWER ONLY OUR OWN CALLERS, AND
-- THE HEALTH PAGE CAN READ THE HEARTBEATS AGAIN (wave 2 email-ops, register
-- L10-10, L10-13, L3-08).
--
-- L10-10. scan-heartbeat answered anyone: each POST made a model call, an
-- end-to-end scan with the limiter bypass, whole-table counts, the slow
-- job-board probes and (on a stall) a service-role refresh kick. Its cron
-- (20260706050000) sent no header, which is why none was required.
-- scan-heartbeat .2026-10-08.1 answers only x-email-cron (the vault key
-- 20261004100000 generated), the service role, or the owner's ADMIN_API_KEY;
-- this file re-creates scan-heartbeat-sentinel on its schedule carrying the key.
--
-- L10-13. notify-owner accepted unauthenticated {type:'signup'} posts, so
-- anyone could fabricate "New account" mails and spend the shared Resend
-- quota. notify-owner .2026-10-08.1 answers only the same key or the service
-- role; the auth.users trigger function sends the key from the vault.
--
-- L3-08. /health-check read heartbeat_results directly with the publishable
-- key, which 20260627121655 revoked, dropped the 42501, and printed "100%
-- uptime" and "All systems operational" over an empty list. It now asks
-- admin-ops (x-admin-key) for get_recent_heartbeats, a counts-and-status
-- reader closed to the client roles.
--
-- APPLY ORDER: with or after scan-heartbeat .2026-10-08.1 and notify-owner
-- .2026-10-08.1 (a header the old builds ignore is harmless; a new build
-- without this file refuses the old header-less cron and trigger). Safe to
-- re-run.

-- ── L10-10: the sentinel cron carries the key ──────────────────────────────
DO $$
DECLARE
  v_sched text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; scan-heartbeat-sentinel not rescheduled';
    RETURN;
  END IF;
  SELECT j.schedule INTO v_sched FROM cron.job j WHERE j.jobname = 'scan-heartbeat-sentinel';
  IF v_sched IS NOT NULL THEN
    PERFORM cron.unschedule('scan-heartbeat-sentinel');
  END IF;
  PERFORM cron.schedule('scan-heartbeat-sentinel', coalesce(v_sched, '*/10 * * * *'), $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/scan-heartbeat',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-email-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_cron_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_cron_key');
  $job$);
END $$;

-- ── L10-13: the sign-up note carries the key ───────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  -- Nested: a statement naming vault is planned whole, and on a database
  -- without the vault that plan would fail before any guard.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v_key USING 'email_cron_key';
  END IF;
  IF v_key IS NULL THEN
    RETURN new;  -- no key, no note: notify-owner would refuse it anyway
  END IF;
  PERFORM net.http_post(
    url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/notify-owner',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-cron', v_key),
    body := jsonb_build_object(
      'type', 'INSERT',
      'record', jsonb_build_object('email', new.email, 'created_at', new.created_at)
    )
  );
  RETURN new;
EXCEPTION WHEN others THEN
  -- Never block a signup because a notification failed.
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_owner_on_signup() FROM PUBLIC, anon, authenticated;

-- ── L3-08: the heartbeats, for the owner's dashboard ───────────────────────
GRANT SELECT ON public.heartbeat_results TO service_role;

CREATE OR REPLACE FUNCTION public.get_recent_heartbeats(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  status text,
  response_time_ms integer,
  test_passed boolean,
  function_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT h.id, h.created_at, h.status, h.response_time_ms, h.test_passed, h.function_name
    FROM public.heartbeat_results h
   WHERE h.function_name = 'free-keyword-scan'
   ORDER BY h.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

COMMENT ON FUNCTION public.get_recent_heartbeats(integer) IS
  'The newest scan-heartbeat results (status, latency, pass/fail; no error text, no check detail) for /health-check through admin-ops. Service role only.';

REVOKE ALL ON FUNCTION public.get_recent_heartbeats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_heartbeats(integer) TO service_role;

DO $$
DECLARE
  v_cmd text;
BEGIN
  IF to_regprocedure('public.get_recent_heartbeats(integer)') IS NULL THEN
    RAISE EXCEPTION 'self-check: get_recent_heartbeats(integer) was not created';
  END IF;
  IF has_function_privilege('anon', 'public.get_recent_heartbeats(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_recent_heartbeats(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role can run get_recent_heartbeats';
  END IF;
  IF position('x-email-cron' IN pg_get_functiondef('public.notify_owner_on_signup()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'self-check: notify_owner_on_signup does not send the cron key';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'scan-heartbeat-sentinel';
    IF v_cmd IS NULL OR position('x-email-cron' IN v_cmd) = 0 OR position('email_cron_key' IN v_cmd) = 0
       OR position('/functions/v1/scan-heartbeat''' IN v_cmd) = 0 THEN
      RAISE EXCEPTION 'self-check: scan-heartbeat-sentinel does not post to scan-heartbeat with the email cron key: %', coalesce(v_cmd, '(no job)');
    END IF;
  END IF;
END $$;
