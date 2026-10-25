-- A SIGN-IN MAIL IS DRAINED WHILE A PROVIDER COOLDOWN HOLDS (R1 hotfix,
-- S13-017; register r1-followup).
--
-- WHAT WAS WRONG. 20261014100000 scheduled OUR drain job, rb-auth-mail-drain,
-- and its command returns at once while email_send_state.retry_after_until is
-- in the future. That file is LIVE: it has no staged-runner stub, but
-- get_cron_health shows the job (every 10 seconds, about 360 runs an hour,
-- 2026-10-24), and docs/deploy-ledger.json lists the stamp in
-- appliedOutsideDrizzle. The process-email-queue build that serves with it
-- (2026-10-14.1) sets that cooldown from a Lovable 429 on sign-in mail, to
-- the Retry-After Lovable sends (an hour, for a daily quota), so one throttle
-- held every reset and sign-in mail queued behind it past its 15-minute code
-- into the dead-letter queue, with no Resend try and no alert.
-- process-email-queue 2026-10-14.2 sends a throttled sign-in mail through
-- Resend, never sets the cooldown for the auth queue, and drains sign-in
-- mail while a cooldown (the transactional queue's) is in force. The job's
-- command still waits any cooldown out, so after a transactional 429, a
-- cooldown the 2026-10-14.1 build set, or a Lovable regeneration of the
-- function, no post would reach the new build.
--
-- WHY A NEW FILE. 20261014100000 is applied, so an edit to it never reaches
-- production and would leave the repo describing a job the database does not
-- run. This file re-schedules the job only, with 20261014100000's command
-- changed in three places: it no longer reads the provider cooldown, its
-- marker names this file ('rb-auth-mail-drain 20261014120000'), and it
-- begins SET statement_timeout = '10s'. Everything else is the same text:
-- the pgmq.metrics test, the vault bearer and the cron key, the read-back of
-- the drain's own refusals and of the gateway's 401, and the post naming the
-- auth queue only.
--
-- THE TRACE (second fixer round). Nothing anon can read showed a job's
-- command, so after a deploy nobody could tell whether this file had applied
-- (20261014100000 itself was applied outside the staged runner, and the
-- runner has edited failing files before). get_cron_health (20261004010000)
-- reports, as ch_timeout, the statement_timeout a command begins with:
-- 20261014100000's sets none, this file's sets '10s', which no other file
-- writes. Verify section 94 reads it: PASS on '10s', FAIL on anything else
-- once process-email-queue serves 2026-10-14.2. The value also bounds a run
-- by its tick: a drain stuck past 10 seconds is cancelled, and counted as a
-- failed run, instead of holding the next one back. The self-check below
-- refuses a command without it, so the trace means this file's command.
--
-- WHAT THIS FILE DOES, in order:
--   0. REFUSES TO RUN while a SECURITY DEFINER function that touches pgmq is
--      executable by anon or authenticated, the same test as
--      20261014100000's step 0: a drain behind an open enqueue is a mail
--      relay on our own domain.
--   1. Re-schedules rb-auth-mail-drain, every 10 seconds, with the new
--      command. The job of that name must be ours: it carries
--      20261014100000's marker or this file's. One that carries neither is
--      refused, never replaced. cron.schedule on the same name replaces the
--      command in place (the job keeps its id and its run history). With no
--      job of that name (removed by hand), it is scheduled as 20261014100000
--      would have scheduled it. A job named 'process-email-queue' is
--      Lovable's: read to report it, never scheduled, altered or unscheduled.
--   2. Self-check: no queue wrapper is open; the job exists with this file's
--      marker, every 10 seconds, its command beginning with the '10s'
--      statement_timeout get_cron_health reports; it posts to the function with the
--      vault bearer and the cron key behind the pgmq.metrics test, names the
--      auth queue only, reads the drain's own refusals and the gateway's 401
--      back, and does not read the provider cooldown table; and no job named
--      'process-email-queue' carries a marker of ours.
--
-- Safe to run twice: a second run finds the same command and changes
-- nothing. Creates no table and no function.
--
-- APPLY ORDER: after process-email-queue.2026-10-14.2 serves (verify-deploy
-- section 94). The 2026-10-14.1 build skips every run during a cooldown and
-- sets one from a Lovable 429 on sign-in mail, so this command would post
-- into a build that ignores it. Section 94 cannot read a job's command; it
-- reads the trace above (ch_timeout '10s'), and this file's self-check
-- vouches for the rest of the command.

-- ── 0. No drain while a queue wrapper is open to clients ────────────────────
DO $$
DECLARE
  v_open integer;
  v_names text := '';
  r record;
BEGIN
  IF to_regprocedure('public.queue_wrapper_exposure()') IS NOT NULL THEN
    v_open := (public.queue_wrapper_exposure() ->> 'open_to_clients')::integer;
    IF v_open IS NULL OR v_open <> 0 THEN
      RAISE EXCEPTION 'r1 hotfix: queue_wrapper_exposure() reports % SECURITY DEFINER function(s) touching pgmq that anon or authenticated can execute; draining the queue would make them a live mail relay. Close them first (20261002104317), then apply this file.', COALESCE(v_open::text, 'an unreadable number of');
    END IF;
  ELSE
    FOR r IN
      SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public'
         AND p.proname IN ('enqueue_email', 'enqueue_email_delayed', 'read_email_batch', 'delete_email', 'move_to_dlq')
         AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    LOOP
      v_names := v_names || ' ' || r.sig::text;
    END LOOP;
    IF v_names <> '' THEN
      RAISE EXCEPTION 'r1 hotfix: queue wrappers executable by anon or authenticated:%; close them before the drain is re-scheduled', v_names;
    END IF;
  END IF;
END $$;

-- ── 1. Our drain job, re-scheduled with the command that drains through a cooldown ──
DO $$
DECLARE
  v_cmd text;
  v_existing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'r1 hotfix: pg_cron is not installed here; no drain job to re-schedule';
    RETURN;
  END IF;
  -- Read only, never written: Lovable's own job, if its setup made one.
  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'process-email-queue') THEN
    RAISE NOTICE 'r1 hotfix: a job named process-email-queue exists (Lovable''s); left exactly as it is, our drain runs beside it';
  END IF;
  v_existing := (SELECT j.command FROM cron.job j WHERE j.jobname = 'rb-auth-mail-drain' LIMIT 1);
  IF v_existing IS NOT NULL
     AND position('rb-auth-mail-drain 20261014100000' IN v_existing) = 0
     AND position('rb-auth-mail-drain 20261014120000' IN v_existing) = 0 THEN
    RAISE EXCEPTION 'r1 hotfix: a job named rb-auth-mail-drain exists that neither 20261014100000 nor this file wrote; it is not replaced';
  END IF;
  IF v_existing IS NULL THEN
    RAISE NOTICE 'r1 hotfix: no rb-auth-mail-drain job exists (20261014100000 made one; it was removed); scheduling it';
  END IF;
  v_cmd := $cmd$SET statement_timeout = '10s';
DO $drain$
DECLARE
  v_marker constant text := 'rb-auth-mail-drain 20261014120000 refusedBy';
  v_n bigint;
  v_visible boolean;
  v_bearer text;
  v_cron_key text;
  v_refused integer := 0;
  v_gateway integer := 0;
BEGIN
  v_n := 0;
  BEGIN
    SELECT m.queue_length INTO v_n FROM pgmq.metrics('auth_emails') m;
  EXCEPTION WHEN OTHERS THEN
    v_n := 0;
  END;
  IF COALESCE(v_n, 0) = 0 THEN
    RETURN;
  END IF;
  BEGIN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM pgmq.q_auth_emails q WHERE q.vt <= now())' INTO v_visible;
  EXCEPTION WHEN OTHERS THEN
    v_visible := true;
  END;
  IF NOT COALESCE(v_visible, true) THEN
    RETURN;
  END IF;
  SELECT s.decrypted_secret INTO v_bearer FROM vault.decrypted_secrets s WHERE s.name = 'email_queue_service_role_key' LIMIT 1;
  IF v_bearer IS NULL THEN
    RAISE EXCEPTION 'rb-auth-mail-drain (%): sign-in mail is waiting and the vault holds no email_queue_service_role_key (Lovable''s email setup creates it; without it the gateway refuses the post unheard)', v_marker;
  END IF;
  SELECT s.decrypted_secret INTO v_cron_key FROM vault.decrypted_secrets s WHERE s.name = 'email_cron_key' LIMIT 1;
  IF v_cron_key IS NULL THEN
    RAISE EXCEPTION 'rb-auth-mail-drain (%): sign-in mail is waiting and the vault holds no email_cron_key (20261004100000 creates it)', v_marker;
  END IF;
  BEGIN
    IF to_regclass('net._http_response') IS NOT NULL THEN
      EXECUTE $q$SELECT count(*)::int FROM net._http_response r
                  WHERE r.created > now() - interval '2 minutes'
                    AND r.status_code IN (401, 403)
                    AND r.content::text LIKE '%"refusedBy":"process-email-queue"%'
                    AND r.content::text LIKE '%"cronKey":true%'$q$ INTO v_refused;
      EXECUTE $q$SELECT count(*)::int FROM net._http_response r
                  WHERE r.created > now() - interval '2 minutes'
                    AND r.status_code = 401
                    AND r.content::text LIKE '%"code":"UNAUTHORIZED_%'$q$ INTO v_gateway;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_refused := 0;
    v_gateway := 0;
  END;
  IF COALESCE(v_refused, 0) > 0 THEN
    RAISE EXCEPTION 'rb-auth-mail-drain (%): the drain refused % post(s) that offered the cron key in the last two minutes; the cron key it was sent no longer opens it', v_marker, v_refused;
  END IF;
  IF COALESCE(v_gateway, 0) > 0 THEN
    RAISE EXCEPTION 'rb-auth-mail-drain (%): the gateway answered % post(s) with its own 401 in the last two minutes: the vault bearer (email_queue_service_role_key) no longer opens it', v_marker, v_gateway;
  END IF;
  PERFORM net.http_post(
    url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/process-email-queue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer, 'x-email-cron', v_cron_key),
    body := jsonb_build_object('source', 'cron', 'queues', jsonb_build_array('auth_emails'))
  );
END
$drain$;
$cmd$;
  IF v_existing = v_cmd THEN
    RAISE NOTICE 'r1 hotfix: rb-auth-mail-drain already runs this file''s command';
    RETURN;
  END IF;
  PERFORM cron.schedule('rb-auth-mail-drain', '10 seconds', v_cmd);
  RAISE NOTICE 'r1 hotfix: rb-auth-mail-drain re-scheduled every 10 seconds; a provider cooldown no longer holds sign-in mail';
END $$;

-- ── 2. Self-check ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_open integer;
  v_cmd text;
  v_sched text;
BEGIN
  IF to_regprocedure('public.queue_wrapper_exposure()') IS NOT NULL THEN
    v_open := (public.queue_wrapper_exposure() ->> 'open_to_clients')::integer;
    IF v_open IS NULL OR v_open <> 0 THEN
      RAISE EXCEPTION 'self-check: % queue wrapper(s) open to clients with the drain scheduled', COALESCE(v_open::text, 'an unreadable number of');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.command, j.schedule INTO v_cmd, v_sched FROM cron.job j WHERE j.jobname = 'rb-auth-mail-drain';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'self-check: no rb-auth-mail-drain job exists after this file ran';
  END IF;
  IF position('rb-auth-mail-drain 20261014120000' IN v_cmd) = 0 THEN
    RAISE EXCEPTION 'self-check: the rb-auth-mail-drain job does not carry this file''s marker, so it still runs an older command';
  END IF;
  IF v_sched <> '10 seconds' THEN
    RAISE EXCEPTION 'self-check: the rb-auth-mail-drain job runs on %, not every 10 seconds', v_sched;
  END IF;
  IF left(v_cmd, length('SET statement_timeout = ''10s'';')) <> 'SET statement_timeout = ''10s'';' THEN
    RAISE EXCEPTION 'self-check: the rb-auth-mail-drain command does not begin with this file''s SET statement_timeout = ''10s'', the trace verify section 94 reads through get_cron_health: %', left(v_cmd, 120);
  END IF;
  IF position('/functions/v1/process-email-queue' IN v_cmd) = 0
     OR position('Authorization' IN v_cmd) = 0
     OR position('email_queue_service_role_key' IN v_cmd) = 0
     OR position('x-email-cron' IN v_cmd) = 0
     OR position('email_cron_key' IN v_cmd) = 0
     OR position('pgmq.metrics' IN v_cmd) = 0 THEN
    RAISE EXCEPTION 'self-check: the rb-auth-mail-drain command no longer posts to the function with the vault bearer and the cron key behind the pgmq.metrics test: %', left(v_cmd, 300);
  END IF;
  IF position('jsonb_build_array(''auth_emails'')' IN v_cmd) = 0
     OR position('transactional_emails' IN v_cmd) > 0 THEN
    RAISE EXCEPTION 'self-check: the rb-auth-mail-drain command no longer names the auth queue only (the drip waits for CP-G)';
  END IF;
  IF position('net._http_response' IN v_cmd) = 0
     OR position('"refusedBy":"process-email-queue"' IN v_cmd) = 0
     OR position('"cronKey":true' IN v_cmd) = 0
     OR position('r.status_code = 401' IN v_cmd) = 0
     OR position('"code":"UNAUTHORIZED_' IN v_cmd) = 0 THEN
    RAISE EXCEPTION 'self-check: the rb-auth-mail-drain command no longer reads its own refusals and the gateway''s 401 back, so a refused post would read as a success';
  END IF;
  IF position('email_send_state' IN v_cmd) > 0 OR position('retry_after_until' IN v_cmd) > 0 THEN
    RAISE EXCEPTION 'self-check: the rb-auth-mail-drain command reads the provider cooldown; sign-in mail must not wait it out (S13-017)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cron.job j
     WHERE j.jobname = 'process-email-queue'
       AND (position('r1-mail-drain 20261014100000' IN j.command) > 0
            OR position('rb-auth-mail-drain 20261014100000' IN j.command) > 0
            OR position('rb-auth-mail-drain 20261014120000' IN j.command) > 0)
  ) THEN
    RAISE EXCEPTION 'self-check: a job named process-email-queue carries a marker of ours; neither R1 file writes that name (unschedule it by hand, then re-run)';
  END IF;
END $$;
