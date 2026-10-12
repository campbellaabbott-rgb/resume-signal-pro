-- A QUEUED SIGN-IN MAIL IS DRAINED EVERY TEN SECONDS, AND ITS DELIVERY CAN BE
-- RECORDED (R1 mail, plan group CP-A item 5; register CP-002, CP-013, CP-015).
--
-- WHAT WAS WRONG. auth-email-hook puts every sign-in, recovery and
-- email-change mail on the auth_emails queue, and get_cron_health (anon,
-- 2026-10-12) lists 56 jobs and none drains it: Lovable's setup step created a
-- 'process-email-queue' job once (20260702190811's post-migration notes) and it
-- is gone. Nothing could record what Resend did with a mail either: the log had
-- no column for Resend's id and its status CHECK named no delivery state.
--
-- WHAT THIS FILE DOES, in order:
--   0. REFUSES TO RUN while any SECURITY DEFINER function that touches pgmq is
--      executable by anon or authenticated (queue_wrapper_exposure(), from
--      20261002104317; by the five wrapper names where that reader is absent).
--      A drain behind an open enqueue is a mail relay on our own domain.
--   1. email_send_log gains provider_message_id (Resend's id, at most 200
--      characters) and a partial index on it. send-mail.ts writes it after a
--      2xx; resend-webhook finds the row by it.
--   2. The status CHECK also accepts 'delivered' and 'delayed'. The constraint
--      is found in pg_constraint by the column it checks, never by a guessed
--      name, and any value a drifted live constraint allows is carried over.
--      email_delivery_health is NOT changed here. It counts every status
--      outside its terminal set as stuck after two hours, so resend-webhook
--      stamps delivered and delayed on the sent row's metadata rather than
--      writing rows in those states (see that function's header).
--   3. Schedules the cron job 'process-email-queue' every 10 seconds, ONLY IF
--      cron.job has no job by that name. A job Lovable made is left exactly as
--      it is, and so is the trigger and the vault key Lovable's setup keeps
--      outside our migrations; a job this file made on an earlier run with an
--      older command is re-scheduled with this one. The job's command posts
--      only while pgmq.metrics shows a sign-in mail in auth_emails that is
--      visible now, and not during a provider cooldown
--      (email_send_state.retry_after_until). R1 drains sign-in mail only: the
--      post names {"queues":["auth_emails"]}, and the fix-plan drip in
--      transactional_emails waits for CP-G (its text part, marketing purpose,
--      seller footer and apex sender) where it is.
--      THE POST CARRIES NO JWT AND CANNOT BE REFUSED UNHEARD (review of R1,
--      decision 5; S12-179). It sends only the vault email cron key as
--      x-email-cron (email_cron_key, created by 20261004100000), and
--      process-email-queue runs with verify_jwt = false (supabase/config.toml)
--      and checks that key itself, so no gateway bearer (the vault's
--      email_queue_service_role_key, which no migration creates) is needed.
--      net.http_post only queues the request and every run reads 'succeeded'
--      whatever the answer, so the command reads the answers back: a refusal
--      from the drain in the last two minutes (its body names refusedBy
--      process-email-queue) fails the run instead of posting again, and so
--      does a missing cron key. Verify section 94 reads the job's last run
--      status and its failures, and proves the gateway no longer asks for a
--      JWT (a POST with none is refused by the function's own check).
--   4. Self-check: the column and index exist, the CHECK names all ten
--      statuses and is the only check on status, no queue wrapper is open, and
--      the job exists; if it is this file's, its command still posts to the
--      function with the cron key behind the pgmq.metrics test, reads the
--      drain's refusals back, and sends no bearer.
--
-- Safe to run twice. Creates no table and no function.
--
-- APPLY ORDER: after process-email-queue.2026-10-14.1 serves with
-- verify_jwt = false (verify-deploy section 94). The job's posts carry only
-- x-email-cron, which an older build ignores, and an older build's gateway
-- (verify_jwt = true) refuses them for want of a JWT in words that do not
-- name the drain, which this command cannot tell from any other 401. So it
-- is applied only once section 94 shows both the build and the gateway's
-- answer to a post with no JWT.

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
      RAISE EXCEPTION 'r1 mail: queue_wrapper_exposure() reports % SECURITY DEFINER function(s) touching pgmq that anon or authenticated can execute; draining the queue would make them a live mail relay. Close them first (20261002104317), then apply this file.', COALESCE(v_open::text, 'an unreadable number of');
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
      RAISE EXCEPTION 'r1 mail: queue wrappers executable by anon or authenticated:%; close them before the drain is scheduled', v_names;
    END IF;
  END IF;
END $$;

-- ── 1. Resend's id on the log row ───────────────────────────────────────────
ALTER TABLE public.email_send_log ADD COLUMN IF NOT EXISTS provider_message_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.email_send_log'::regclass AND conname = 'email_send_log_provider_message_id_len'
  ) THEN
    ALTER TABLE public.email_send_log
      ADD CONSTRAINT email_send_log_provider_message_id_len
      CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_provider_message
  ON public.email_send_log (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ── 2. The status CHECK names the delivery states ───────────────────────────
DO $$
DECLARE
  v_att smallint;
  v_vals text[] := ARRAY['pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq', 'rate_limited', 'delivered', 'delayed'];
  v_lit text;
  r record;
BEGIN
  SELECT a.attnum INTO v_att
    FROM pg_attribute a
   WHERE a.attrelid = 'public.email_send_log'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  IF v_att IS NULL THEN
    RAISE EXCEPTION 'r1 mail: email_send_log has no status column';
  END IF;
  FOR r IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.conrelid = 'public.email_send_log'::regclass
       AND c.contype = 'c'
       AND c.conkey = ARRAY[v_att]
  LOOP
    FOR v_lit IN SELECT m[1] FROM regexp_matches(r.def, '''([^'']+)''', 'g') AS m LOOP
      IF NOT (v_lit = ANY (v_vals)) THEN
        v_vals := v_vals || v_lit;
        RAISE NOTICE 'r1 mail: the live status CHECK also allowed %, kept', v_lit;
      END IF;
    END LOOP;
    EXECUTE format('ALTER TABLE public.email_send_log DROP CONSTRAINT %I', r.conname);
  END LOOP;
  EXECUTE format(
    'ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check CHECK (status IN (%s))',
    (SELECT string_agg(quote_literal(v), ', ') FROM unnest(v_vals) AS v)
  );
END $$;

-- ── 3. The drain, only where no job of that name exists ─────────────────────
DO $$
DECLARE
  v_cmd text;
  v_existing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'r1 mail: pg_cron is not installed here; no drain job scheduled';
    RETURN;
  END IF;
  v_existing := (SELECT j.command FROM cron.job j WHERE j.jobname = 'process-email-queue' LIMIT 1);
  IF v_existing IS NOT NULL AND position('r1-mail-drain 20261014100000' IN v_existing) = 0 THEN
    RAISE NOTICE 'r1 mail: a process-email-queue job already exists that this file did not write (Lovable''s); left exactly as it is';
    RETURN;
  END IF;
  v_cmd := $cmd$
DO $drain$
DECLARE
  v_marker constant text := 'r1-mail-drain 20261014100000 refusedBy';
  v_n bigint;
  v_visible boolean;
  v_cron_key text;
  v_refused integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.email_send_state s WHERE s.retry_after_until > now()) THEN
    RETURN;
  END IF;
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
  SELECT s.decrypted_secret INTO v_cron_key FROM vault.decrypted_secrets s WHERE s.name = 'email_cron_key' LIMIT 1;
  IF v_cron_key IS NULL THEN
    RAISE EXCEPTION 'process-email-queue (%): sign-in mail is waiting and the vault holds no email_cron_key (20261004100000 creates it)', v_marker;
  END IF;
  BEGIN
    IF to_regclass('net._http_response') IS NOT NULL THEN
      EXECUTE $q$SELECT count(*)::int FROM net._http_response r
                  WHERE r.created > now() - interval '2 minutes'
                    AND r.status_code IN (401, 403)
                    AND r.content::text LIKE '%"refusedBy":"process-email-queue"%'$q$ INTO v_refused;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_refused := 0;
  END;
  IF COALESCE(v_refused, 0) > 0 THEN
    RAISE EXCEPTION 'process-email-queue (%): the drain refused % post(s) in the last two minutes; the cron key it was sent no longer opens it', v_marker, v_refused;
  END IF;
  PERFORM net.http_post(
    url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/process-email-queue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-cron', v_cron_key),
    body := jsonb_build_object('source', 'cron', 'queues', jsonb_build_array('auth_emails'))
  );
END
$drain$;
$cmd$;
  IF v_existing IS NOT NULL THEN
    IF v_existing = v_cmd THEN
      RAISE NOTICE 'r1 mail: this file''s process-email-queue job is already in place';
      RETURN;
    END IF;
    PERFORM cron.unschedule('process-email-queue');
    RAISE NOTICE 'r1 mail: replacing this file''s earlier process-email-queue command';
  END IF;
  PERFORM cron.schedule('process-email-queue', '10 seconds', v_cmd);
  RAISE NOTICE 'r1 mail: scheduled process-email-queue every 10 seconds';
END $$;

-- ── 4. Self-check ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_att smallint;
  v_checks integer;
  v_open integer;
  v_cmd text;
  v_sched text;
  v text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'email_send_log' AND column_name = 'provider_message_id'
  ) THEN
    RAISE EXCEPTION 'self-check: email_send_log has no provider_message_id column';
  END IF;
  IF to_regclass('public.idx_email_send_log_provider_message') IS NULL THEN
    RAISE EXCEPTION 'self-check: the provider_message_id index is missing';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.email_send_log'::regclass AND c.conname = 'email_send_log_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'self-check: email_send_log_status_check is missing';
  END IF;
  FOREACH v IN ARRAY ARRAY['pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq', 'rate_limited', 'delivered', 'delayed'] LOOP
    IF position('''' || v || '''' IN v_def) = 0 THEN
      RAISE EXCEPTION 'self-check: email_send_log_status_check does not accept %: %', v, v_def;
    END IF;
  END LOOP;
  SELECT a.attnum INTO v_att FROM pg_attribute a
   WHERE a.attrelid = 'public.email_send_log'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  SELECT count(*) INTO v_checks FROM pg_constraint c
   WHERE c.conrelid = 'public.email_send_log'::regclass AND c.contype = 'c' AND c.conkey = ARRAY[v_att];
  IF v_checks <> 1 THEN
    RAISE EXCEPTION 'self-check: % CHECK constraints on email_send_log.status (want exactly one)', v_checks;
  END IF;

  IF to_regprocedure('public.queue_wrapper_exposure()') IS NOT NULL THEN
    v_open := (public.queue_wrapper_exposure() ->> 'open_to_clients')::integer;
    IF v_open IS NULL OR v_open <> 0 THEN
      RAISE EXCEPTION 'self-check: % queue wrapper(s) open to clients with the drain scheduled', COALESCE(v_open::text, 'an unreadable number of');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT j.command, j.schedule INTO v_cmd, v_sched FROM cron.job j WHERE j.jobname = 'process-email-queue';
    IF v_cmd IS NULL THEN
      RAISE EXCEPTION 'self-check: no process-email-queue job exists after this file ran';
    END IF;
    IF position('r1-mail-drain 20261014100000' IN v_cmd) > 0 THEN
      IF v_sched <> '10 seconds' THEN
        RAISE EXCEPTION 'self-check: this file''s process-email-queue job runs on %, not every 10 seconds', v_sched;
      END IF;
      IF position('/functions/v1/process-email-queue' IN v_cmd) = 0
         OR position('x-email-cron' IN v_cmd) = 0
         OR position('email_cron_key' IN v_cmd) = 0
         OR position('pgmq.metrics' IN v_cmd) = 0 THEN
        RAISE EXCEPTION 'self-check: the process-email-queue command no longer posts to the function with the cron key behind the pgmq.metrics test: %', left(v_cmd, 300);
      END IF;
      IF position('net._http_response' IN v_cmd) = 0 OR position('"refusedBy":"process-email-queue"' IN v_cmd) = 0 THEN
        RAISE EXCEPTION 'self-check: the process-email-queue command no longer reads the drain''s refusals back, so a refused post would read as a success';
      END IF;
      IF position('Authorization' IN v_cmd) > 0 OR position('email_queue_service_role_key' IN v_cmd) > 0 THEN
        RAISE EXCEPTION 'self-check: the process-email-queue command sends a bearer the gateway could refuse unheard';
      END IF;
    ELSE
      RAISE NOTICE 'self-check: process-email-queue is a job this file did not write (Lovable''s); left as it is';
    END IF;
  END IF;
END $$;
