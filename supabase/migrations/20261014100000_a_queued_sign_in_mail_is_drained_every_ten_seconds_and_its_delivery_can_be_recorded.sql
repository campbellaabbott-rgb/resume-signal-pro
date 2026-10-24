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
--   3. Schedules OUR OWN cron job, 'rb-auth-mail-drain', every 10 seconds.
--      LOVABLE'S MAIL PATH IS NEVER TOUCHED (lead decision B of the third
--      fixer round, 2026-10-12): Lovable's email setup made, outside our
--      migrations, a trigger and a job that drain the queue under its own
--      name ('process-email-queue'), a dispatcher (email_queue_dispatch) and
--      the vault secret email_queue_service_role_key, none of which we can
--      see from here. This file never schedules, alters or unschedules a job
--      named 'process-email-queue'; it only reads that name to report it. A
--      job this file made on an earlier run with an older command is
--      re-scheduled with this one (found by this file's own marker).
--      The job's command posts only while pgmq.metrics shows a sign-in mail
--      in auth_emails that is visible now, and not during a provider cooldown
--      (email_send_state.retry_after_until). R1 drains sign-in mail only: the
--      post names {"queues":["auth_emails"]}, and the fix-plan drip in
--      transactional_emails waits for CP-G (its text part, marketing purpose,
--      seller footer and apex sender) where it is.
--      THE POST CARRIES THE VAULT BEARER AND THE CRON KEY. process-email-queue
--      runs behind the gateway's JWT check (verify_jwt = true, as Lovable's own
--      dispatcher needs), so the post sends the vault's
--      email_queue_service_role_key as its bearer, and the vault email cron
--      key as x-email-cron (email_cron_key, created by 20261004100000), which
--      the function's own check also accepts. A run whose vault holds no
--      bearer, or no cron key, FAILS LOUDLY (RAISE) instead of posting a
--      request the gateway would refuse unheard: get_cron_health and verify
--      section 94 then show the failed run.
--      net.http_post only queues the request and every run reads 'succeeded'
--      whatever the answer, so the command reads the answers back from
--      net._http_response, which records no URL and no caller: a refusal
--      from the drain in the last two minutes that says a cron key was
--      offered (its body names refusedBy process-email-queue AND cronKey
--      true; only our posts offer one) fails the run instead of posting
--      again, and so does the gateway's own 401: a bearer it does not
--      accept, which is the same vault bearer every cron sends. The gateway
--      is recognised by the body the LIVE gateway sends, a STRING code that
--      starts UNAUTHORIZED_ (read-only GETs of process-email-queue on
--      2026-10-17: no header gives
--      {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"};
--      a bearer that is not a JWT gives UNAUTHORIZED_INVALID_JWT_FORMAT; a
--      mis-signed token gives UNAUTHORIZED_LEGACY_JWT). An earlier draft
--      matched a numeric code the gateway never sends, so a refused bearer
--      read as a success on every run. Counting every such 401 counts only
--      posts to process-email-queue: it is the one function the database
--      posts to that runs behind the gateway's JWT check (every other cron
--      target is verify_jwt = false in supabase/config.toml, or, for
--      apply-agent, agent-runner and agent-mcp, which config.toml does not
--      list, answers a GET with no header with its own 405 live, 2026-10-17),
--      and net._http_response holds only this database's own pg_net posts.
--      A function's own refusal carries no UNAUTHORIZED_ code. A refusal of
--      another caller's post (Lovable's dispatcher, a stray publishable-key
--      post) carries no cron key and never stops ours; the gateway refusing
--      Lovable's dispatcher refuses the same vault bearer ours sends.
--   4. Self-check: the column and index exist, the CHECK names all ten
--      statuses and is the only check on status, no queue wrapper is open,
--      the job 'rb-auth-mail-drain' exists with this file's marker, its
--      command still posts to the function with the vault bearer and the
--      cron key behind the pgmq.metrics test and reads the drain's own
--      refusals back, and no job named 'process-email-queue' carries a marker
--      of ours (this file never wrote one; an earlier draft of this file did
--      under that name but was never applied anywhere).
--
-- Safe to run twice. Creates no table and no function.
--
-- APPLY ORDER: after process-email-queue.2026-10-14.1 serves (verify-deploy
-- section 94): an older build ignores x-email-cron and has no Resend
-- fallback. Section 94 also proves the gateway still asks for a JWT (a POST
-- with none is refused 401 by the gateway, not by the function), because the
-- role claim the function reads is the platform's word only while the
-- gateway checks signatures, and that the gateway's 401 still carries the
-- UNAUTHORIZED_ code this command reads back (a 401 in any other shape
-- FAILs section 94: this command would then miss a refused bearer).

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

-- ── 3. Our own drain job, beside whatever Lovable runs ──────────────────────
DO $$
DECLARE
  v_cmd text;
  v_existing text;
  v_lovable text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'r1 mail: pg_cron is not installed here; no drain job scheduled';
    RETURN;
  END IF;
  -- Read only, never written: Lovable's own job, if its setup made one.
  v_lovable := (SELECT j.command FROM cron.job j WHERE j.jobname = 'process-email-queue' LIMIT 1);
  IF v_lovable IS NOT NULL THEN
    RAISE NOTICE 'r1 mail: a job named process-email-queue exists (Lovable''s); left exactly as it is, our drain runs beside it';
  END IF;
  v_existing := (SELECT j.command FROM cron.job j WHERE j.jobname = 'rb-auth-mail-drain' LIMIT 1);
  IF v_existing IS NOT NULL AND position('rb-auth-mail-drain 20261014100000' IN v_existing) = 0 THEN
    RAISE EXCEPTION 'r1 mail: a job named rb-auth-mail-drain exists that this file did not write; it is not replaced';
  END IF;
  v_cmd := $cmd$
DO $drain$
DECLARE
  v_marker constant text := 'rb-auth-mail-drain 20261014100000 refusedBy';
  v_n bigint;
  v_visible boolean;
  v_bearer text;
  v_cron_key text;
  v_refused integer := 0;
  v_gateway integer := 0;
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
  IF v_existing IS NOT NULL THEN
    IF v_existing = v_cmd THEN
      RAISE NOTICE 'r1 mail: this file''s rb-auth-mail-drain job is already in place';
      RETURN;
    END IF;
    PERFORM cron.unschedule('rb-auth-mail-drain');
    RAISE NOTICE 'r1 mail: replacing this file''s earlier rb-auth-mail-drain command';
  END IF;
  PERFORM cron.schedule('rb-auth-mail-drain', '10 seconds', v_cmd);
  RAISE NOTICE 'r1 mail: scheduled rb-auth-mail-drain every 10 seconds';
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
    SELECT j.command, j.schedule INTO v_cmd, v_sched FROM cron.job j WHERE j.jobname = 'rb-auth-mail-drain';
    IF v_cmd IS NULL THEN
      RAISE EXCEPTION 'self-check: no rb-auth-mail-drain job exists after this file ran';
    END IF;
    IF position('rb-auth-mail-drain 20261014100000' IN v_cmd) = 0 THEN
      RAISE EXCEPTION 'self-check: the rb-auth-mail-drain job does not carry this file''s marker';
    END IF;
    IF v_sched <> '10 seconds' THEN
      RAISE EXCEPTION 'self-check: the rb-auth-mail-drain job runs on %, not every 10 seconds', v_sched;
    END IF;
    IF position('/functions/v1/process-email-queue' IN v_cmd) = 0
       OR position('Authorization' IN v_cmd) = 0
       OR position('email_queue_service_role_key' IN v_cmd) = 0
       OR position('x-email-cron' IN v_cmd) = 0
       OR position('email_cron_key' IN v_cmd) = 0
       OR position('pgmq.metrics' IN v_cmd) = 0 THEN
      RAISE EXCEPTION 'self-check: the rb-auth-mail-drain command no longer posts to the function with the vault bearer and the cron key behind the pgmq.metrics test: %', left(v_cmd, 300);
    END IF;
    IF position('net._http_response' IN v_cmd) = 0
       OR position('"refusedBy":"process-email-queue"' IN v_cmd) = 0
       OR position('"cronKey":true' IN v_cmd) = 0
       OR position('r.status_code = 401' IN v_cmd) = 0
       OR position('"code":"UNAUTHORIZED_' IN v_cmd) = 0 THEN
      RAISE EXCEPTION 'self-check: the rb-auth-mail-drain command no longer reads its own refusals and the gateway''s 401 back, so a refused post would read as a success';
    END IF;
    -- Lovable's job is never ours. An earlier draft of this file scheduled a job under that name; it was never applied anywhere.
    IF EXISTS (
      SELECT 1 FROM cron.job j
       WHERE j.jobname = 'process-email-queue'
         AND (position('r1-mail-drain 20261014100000' IN j.command) > 0 OR position('rb-auth-mail-drain 20261014100000' IN j.command) > 0)
    ) THEN
      RAISE EXCEPTION 'self-check: a job named process-email-queue carries a marker of ours; this file never writes that name (unschedule it by hand, then re-run)';
    END IF;
  END IF;
END $$;
