-- A RÉSUMÉ NEVER RIDES A STRIPE SESSION, AND EVERY COPY WE KEEP HAS A CLOCK.
--
-- THE LEAK. From 2025-12-23 until this deploy, create-checkout copied the
-- first 500 characters of every full-analysis buyer's résumé into the Stripe
-- session's metadata (metadata.resumeData) -- in practice the name, email,
-- phone and address that open a CV. stripe-webhook then stored the whole
-- session object, metadata included, in webhook_events.payload, which nothing
-- ever deletes. Nothing read the value: the analysis is fulfilled from the
-- temporary store. The function and the webhook stop writing it in the same
-- change as this file; this file removes what is already stored and makes the
-- table refuse it from now on, because sessions minted before the deploy keep
-- sending events (expiry, retries, refunds) and an older deployment of the
-- webhook may serve for a while.
--
-- THE CLOCKS. The site now states, store by store, how long each copy of a
-- résumé lives (src/lib/resume-retention.ts holds the numbers; the copy and
-- the code are compared by src/test/a-resume-never-rides-a-stripe-session.test.ts).
-- Four of those clocks were written down and never enforced. Measured on
-- 2026-10-04 with get_cron_health (48 live jobs): no job deletes from any of
--   temp_resume_storage  expires_at = created_at + 24h; readers skip expired
--                        rows, but the rows were deleted only when a later
--                        upload happened to roll a 5% chance
--   ai_response_cache    expires_at = 24h or 48h; cleanup_expired_cache()
--                        exists and is scheduled nowhere
--   resume_analyses      expires_at = created_at + 90 days; the share-link
--                        reader does NOT check it, so an "expired" paid
--                        analysis was served forever; cleanup_expired_analyses()
--                        is scheduled nowhere
--   scan_report_cache    7 days, purged nightly at 04:10, so up to 8 days
-- Each gets an hourly (temp store: every 15 minutes) job that deletes exactly
-- the rows its own readers already treat as gone, plus one immediate pass
-- here so nothing expired survives the apply.
--
-- WHAT CHANGES FOR A VISITOR. Nothing they can reach, except one thing: a
-- paid analysis's share link stops working 90 days after it was made, which is
-- what analyze-resume already assumes ("past its 90 days") and what the
-- 2025-12-16 privacy migration that added the column intended.
--
-- SELF-VERIFYING. The DO block at the end refuses the file unless the stored
-- payloads are clean, the trigger strips a probe row on insert AND on update,
-- the helper is closed to anon and authenticated, all four jobs are scheduled
-- and active, and no expired row remains in any of the four stores.

-- ── 1. The key list, and a recursive strip ───────────────────────────────────
-- One list, mirrored by RESUME_BEARING_METADATA_KEYS in
-- supabase/functions/_shared/webhook-payload.ts (compared by the test above).
-- Recursive so a key nested anywhere in a Stripe object is removed too.
-- SECURITY INVOKER: it reads nothing; it only rebuilds the value it is given.
CREATE OR REPLACE FUNCTION public.strip_resume_keys(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keys constant text[] := ARRAY['resumeData'];
  v_out jsonb;
BEGIN
  IF p IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p) = 'object' THEN
    SELECT coalesce(jsonb_object_agg(e.key, public.strip_resume_keys(e.value)), '{}'::jsonb)
      INTO v_out
      FROM jsonb_each(p) AS e(key, value)
     WHERE NOT (e.key = ANY (v_keys));
    RETURN v_out;
  ELSIF jsonb_typeof(p) = 'array' THEN
    SELECT coalesce(jsonb_agg(public.strip_resume_keys(a.value) ORDER BY a.ord), '[]'::jsonb)
      INTO v_out
      FROM jsonb_array_elements(p) WITH ORDINALITY AS a(value, ord);
    RETURN v_out;
  END IF;
  RETURN p;
END
$$;

-- Nobody calls this over the API. The trigger below runs as whoever writes
-- webhook_events (log_webhook_event's owner, or service_role), and a nested
-- call is checked against that role, so service_role keeps EXECUTE.
REVOKE ALL ON FUNCTION public.strip_resume_keys(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.strip_resume_keys(jsonb) TO service_role;

-- ── 2. webhook_events refuses résumé text, whoever writes it ─────────────────
CREATE OR REPLACE FUNCTION public.webhook_events_strip_resume_text()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.payload IS NOT NULL THEN
    NEW.payload := public.strip_resume_keys(NEW.payload);
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.webhook_events_strip_resume_text() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS webhook_events_strip_resume_text ON public.webhook_events;
CREATE TRIGGER webhook_events_strip_resume_text
  BEFORE INSERT OR UPDATE OF payload ON public.webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.webhook_events_strip_resume_text();

-- ── 3. Scrub what is already stored: keep the event, drop the text ───────────
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.webhook_events
     SET payload = public.strip_resume_keys(payload)
   WHERE payload IS NOT NULL
     AND payload::text LIKE '%"resumeData": %';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'webhook_events: résumé text removed from % stored event payload(s); the events themselves are kept', n;
END $$;

-- ── 4. The clocks the copy states, enforced ─────────────────────────────────
-- The column defaults are re-stated so a drifted live default cannot quietly
-- lengthen a clock the site publishes.
ALTER TABLE public.temp_resume_storage ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');
ALTER TABLE public.resume_analyses ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days');

DO $$
DECLARE
  n integer;
BEGIN
  -- No temporary row may outlive the 24 hours the copy promises.
  UPDATE public.temp_resume_storage
     SET expires_at = coalesce(created_at, now()) + interval '24 hours'
   WHERE expires_at > coalesce(created_at, now()) + interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'temp_resume_storage: % row(s) had an expiry past 24 hours and were brought back to it', n;

  UPDATE public.resume_analyses
     SET expires_at = created_at + interval '90 days'
   WHERE expires_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'resume_analyses: % row(s) had no expiry and were given 90 days from creation', n;

  -- The immediate pass: what the jobs below would delete on their first tick.
  DELETE FROM public.temp_resume_storage WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'temp_resume_storage: % expired row(s) deleted', n;

  DELETE FROM public.ai_response_cache WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'ai_response_cache: % expired row(s) deleted', n;

  DELETE FROM public.scan_report_cache WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'scan_report_cache: % row(s) older than 7 days deleted', n;

  DELETE FROM public.resume_analyses WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'resume_analyses: % analysis(es) past their 90 days deleted', n;
END $$;

DO $$
DECLARE
  j record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE EXCEPTION 'pg_cron is absent: the retention the site publishes would have nothing to enforce it';
  END IF;
  FOR j IN
    SELECT * FROM (VALUES
      ('temp-resume-retention',       '*/15 * * * *', $c$DELETE FROM public.temp_resume_storage WHERE expires_at < now();$c$),
      ('ai-response-cache-retention', '41 * * * *',   $c$DELETE FROM public.ai_response_cache WHERE expires_at < now();$c$),
      ('scan-report-cache-retention', '13 * * * *',   $c$DELETE FROM public.scan_report_cache WHERE created_at < now() - interval '7 days';$c$),
      ('shared-analysis-retention',   '29 * * * *',   $c$DELETE FROM public.resume_analyses WHERE expires_at < now();$c$)
    ) AS t(name, schedule, command)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j.name) THEN
      PERFORM cron.unschedule(j.name);
    END IF;
    PERFORM cron.schedule(j.name, j.schedule, j.command);
  END LOOP;
END $$;

-- ── 5. Self-verify ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid;
  v_payload jsonb;
  v_left integer;
  v_job text;
  v_default text;
BEGIN
  -- Stored payloads: none carries the key, at any depth.
  SELECT count(*) INTO v_left
    FROM public.webhook_events
   WHERE payload IS NOT NULL AND payload::text LIKE '%"resumeData": %';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-verify: % webhook_events payload(s) still carry résumé text', v_left;
  END IF;

  -- The trigger is attached and enabled.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.webhook_events'::regclass
       AND t.tgname = 'webhook_events_strip_resume_text'
       AND t.tgenabled <> 'D'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'self-verify: the webhook_events strip trigger is missing or disabled';
  END IF;

  -- Behaviour, not just presence: a probe row written with the key at the
  -- top and nested comes back without it, on insert and on update, and every
  -- other key survives. The probe is deleted before the block ends.
  INSERT INTO public.webhook_events (event_type, event_id, payload, processed)
  VALUES (
    'selfcheck.20261004150000',
    'selfcheck_20261004150000_' || gen_random_uuid()::text,
    '{"id":"cs_probe","metadata":{"resumeData":"Jane Probe, probe@example.com","originalCurrency":"usd"},"nested":[{"metadata":{"resumeData":"x"}}]}'::jsonb,
    false
  )
  RETURNING id, payload INTO v_id, v_payload;
  IF v_payload::text LIKE '%"resumeData": %'
     OR v_payload #>> '{metadata,originalCurrency}' IS DISTINCT FROM 'usd'
     OR v_payload ->> 'id' IS DISTINCT FROM 'cs_probe' THEN
    RAISE EXCEPTION 'self-verify: an inserted payload was not stripped correctly: %', v_payload;
  END IF;
  UPDATE public.webhook_events
     SET payload = '{"metadata":{"resumeData":"again","product_type":"full_analysis"}}'::jsonb
   WHERE id = v_id
  RETURNING payload INTO v_payload;
  IF v_payload::text LIKE '%"resumeData": %' OR v_payload #>> '{metadata,product_type}' IS DISTINCT FROM 'full_analysis' THEN
    RAISE EXCEPTION 'self-verify: an updated payload was not stripped correctly: %', v_payload;
  END IF;
  DELETE FROM public.webhook_events WHERE id = v_id;

  -- Closed to the API roles.
  IF has_function_privilege('anon', 'public.strip_resume_keys(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.strip_resume_keys(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-verify: strip_resume_keys is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.strip_resume_keys(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-verify: service_role cannot execute strip_resume_keys, so its writes to webhook_events would fail';
  END IF;

  -- Every clock is scheduled, active, and deletes from the table it names.
  FOR v_job IN SELECT unnest(ARRAY[
    'temp-resume-retention|temp_resume_storage',
    'ai-response-cache-retention|ai_response_cache',
    'scan-report-cache-retention|scan_report_cache',
    'shared-analysis-retention|resume_analyses'
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM cron.job
       WHERE jobname = split_part(v_job, '|', 1)
         AND active
         AND command ILIKE '%delete from public.' || split_part(v_job, '|', 2) || ' %'
    ) THEN
      RAISE EXCEPTION 'self-verify: cron job % is missing, inactive, or no longer deletes from %',
        split_part(v_job, '|', 1), split_part(v_job, '|', 2);
    END IF;
  END LOOP;

  -- Nothing expired survives the apply.
  IF EXISTS (SELECT 1 FROM public.temp_resume_storage WHERE expires_at < now()) THEN
    RAISE EXCEPTION 'self-verify: expired temporary résumé rows remain';
  END IF;
  IF EXISTS (SELECT 1 FROM public.temp_resume_storage WHERE expires_at > coalesce(created_at, now()) + interval '24 hours') THEN
    RAISE EXCEPTION 'self-verify: a temporary résumé row is set to outlive 24 hours';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_response_cache WHERE expires_at < now()) THEN
    RAISE EXCEPTION 'self-verify: expired AI response cache rows remain';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scan_report_cache WHERE created_at < now() - interval '7 days') THEN
    RAISE EXCEPTION 'self-verify: scan reports older than 7 days remain';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resume_analyses WHERE expires_at IS NULL OR expires_at < now()) THEN
    RAISE EXCEPTION 'self-verify: a shared analysis has no expiry or is past it';
  END IF;

  -- The defaults the copy depends on.
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.temp_resume_storage'::regclass AND a.attname = 'expires_at';
  IF v_default IS NULL OR v_default NOT LIKE '%24:00:00%' THEN
    RAISE EXCEPTION 'self-verify: temp_resume_storage.expires_at default is %, not now() + 24 hours', v_default;
  END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.resume_analyses'::regclass AND a.attname = 'expires_at';
  IF v_default IS NULL OR v_default NOT LIKE '%90 days%' THEN
    RAISE EXCEPTION 'self-verify: resume_analyses.expires_at default is %, not now() + 90 days', v_default;
  END IF;

  RAISE NOTICE 'self-verify 20261004150000: webhook payloads clean, strip trigger proven on insert and update, four retention jobs scheduled, nothing expired left';
END $$;
