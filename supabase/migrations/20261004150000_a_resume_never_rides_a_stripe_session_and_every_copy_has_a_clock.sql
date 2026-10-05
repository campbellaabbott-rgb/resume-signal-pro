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
-- THE SECOND ROUTE. create-product-checkout wrote the temporary store's id
-- into every product session's metadata, and get_temp_resume answers that id
-- to anyone holding the public key for its 24 hours -- so anyone who could read
-- the Stripe account's session metadata could read the buyer's whole résumé.
-- The id now stays on our side: section 6 keeps it in checkout_resume_refs,
-- keyed by the Stripe session id, readable by service_role only, and deleted
-- with the résumé it points to.
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
--                        reader has refused an expired row since 2025-12-18
--                        (20251218205434), but cleanup_expired_analyses() is
--                        scheduled nowhere, so every expired analysis was
--                        still in the table
--   scan_report_cache    7 days, purged nightly at 04:10, so up to 8 days
-- Each gets an hourly (temp store: every 15 minutes) job that deletes exactly
-- the rows its own readers already treat as gone, plus one immediate pass
-- here so nothing expired survives the apply.
--
-- THE PAID ANALYSIS HAD A SECOND COPY. analyze-resume also cached every paid
-- analysis in ai_response_cache for 48 hours, where "Delete My Data" (which
-- removes the resume_analyses row) could not reach it. The function stops
-- caching it in the same change; section 5 deletes the copies already there,
-- refuses any an older deployment still writes, and holds every other cached
-- response to the 24 hours the site publishes.
--
-- WHAT CHANGES FOR A VISITOR. Nothing they can reach. The analyses deleted
-- here are the ones the share-link reader already refused, plus any with no
-- expiry at all (which the 2025-12-16 column default should have made
-- impossible; such a row is given 90 days from when it was made). The AI cache
-- rows are re-made on the next request, and a checkout's résumé is found as
-- before.
--
-- SELF-VERIFYING. The DO block at the end refuses the file unless the stored
-- payloads are clean, the trigger strips a probe row on insert AND on update,
-- the helper is closed to anon and authenticated, all four jobs are scheduled
-- and active, no expired row remains in any of the four stores, the AI cache
-- holds no paid analysis and nothing past 24 hours (and refuses a probe that
-- tries), and checkout_resume_refs is closed to the API roles and empties
-- itself when its résumé is deleted.

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

-- ── 5. The AI response cache: no paid analysis, nothing past 24 hours ────────
-- The published clock is AI_CACHE_MAX_HOURS in src/lib/resume-retention.ts.
-- The trigger enforces it whoever writes (store_cached_response inserts, and
-- updates on conflict, so both are covered): a row for the paid analysis is
-- dropped, and any other row's expiry is held to 24 hours after it was made.
-- The hourly job in section 4 then deletes it.
CREATE OR REPLACE FUNCTION public.ai_response_cache_keeps_its_clock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.function_name = 'analyze-resume' THEN
    RETURN NULL;
  END IF;
  NEW.expires_at := least(NEW.expires_at, coalesce(NEW.created_at, now()) + interval '24 hours');
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.ai_response_cache_keeps_its_clock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ai_response_cache_keeps_its_clock ON public.ai_response_cache;
CREATE TRIGGER ai_response_cache_keeps_its_clock
  BEFORE INSERT OR UPDATE ON public.ai_response_cache
  FOR EACH ROW EXECUTE FUNCTION public.ai_response_cache_keeps_its_clock();

DO $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.ai_response_cache WHERE function_name = 'analyze-resume';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'ai_response_cache: % cached paid analysis(es) deleted', n;

  -- Through the trigger: each row's expiry is brought back to 24 hours.
  UPDATE public.ai_response_cache
     SET expires_at = expires_at
   WHERE expires_at > created_at + interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'ai_response_cache: % row(s) had an expiry past 24 hours and were brought back to it', n;

  DELETE FROM public.ai_response_cache WHERE expires_at < now();
END $$;

-- ── 6. A checkout's résumé is resolved on our side, never through Stripe ─────
-- create-product-checkout writes one row per Stripe session that names a
-- résumé (supabase/functions/_shared/checkout-resume-ref.ts); stripe-webhook
-- and verify-product-purchase read it back by the session id. The foreign key
-- deletes the row with the temporary résumé it points to, so the reference
-- lives exactly as long as the text it reaches (24 hours at most), and no job
-- is needed for it.
CREATE TABLE IF NOT EXISTS public.checkout_resume_refs (
  stripe_session_id text PRIMARY KEY
    CONSTRAINT checkout_resume_refs_is_a_stripe_session CHECK (stripe_session_id ~ '^cs_[A-Za-z0-9_]{1,250}$'),
  resume_session_id uuid NOT NULL
    REFERENCES public.temp_resume_storage (session_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkout_resume_refs_resume ON public.checkout_resume_refs (resume_session_id);

COMMENT ON TABLE public.checkout_resume_refs IS
  'Which temporary résumé a Stripe Checkout session will be delivered from. Service role only; a row is deleted with the temp_resume_storage row it names (20261004150000).';

ALTER TABLE public.checkout_resume_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_resume_refs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.checkout_resume_refs TO service_role;

-- ── 7. Self-verify ──────────────────────────────────────────────────────────
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

  -- The AI cache: no paid analysis, nothing past 24 hours, and the trigger
  -- proven on probe rows (deleted before the block ends).
  IF EXISTS (SELECT 1 FROM public.ai_response_cache WHERE function_name = 'analyze-resume') THEN
    RAISE EXCEPTION 'self-verify: a paid analysis is still cached in ai_response_cache';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_response_cache WHERE expires_at > created_at + interval '24 hours') THEN
    RAISE EXCEPTION 'self-verify: an AI cache row is set to outlive 24 hours';
  END IF;
  INSERT INTO public.ai_response_cache (cache_key, function_name, response, expires_at)
  VALUES ('selfcheck_20261004150000_paid', 'analyze-resume', '{"probe":true}'::jsonb, now() + interval '48 hours');
  IF EXISTS (SELECT 1 FROM public.ai_response_cache WHERE cache_key = 'selfcheck_20261004150000_paid') THEN
    RAISE EXCEPTION 'self-verify: ai_response_cache accepted a paid analysis';
  END IF;
  INSERT INTO public.ai_response_cache (cache_key, function_name, response, expires_at)
  VALUES ('selfcheck_20261004150000_long', 'selfcheck', '{"probe":true}'::jsonb, now() + interval '48 hours');
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_response_cache
     WHERE cache_key = 'selfcheck_20261004150000_long'
       AND expires_at <= created_at + interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'self-verify: ai_response_cache kept a row past 24 hours, or dropped one it should keep';
  END IF;
  DELETE FROM public.ai_response_cache WHERE cache_key LIKE 'selfcheck_20261004150000_%';

  -- checkout_resume_refs: closed to the API roles, open to service_role, and
  -- emptied with the résumé it points to.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.checkout_resume_refs'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'self-verify: checkout_resume_refs does not have row-level security on';
  END IF;
  IF has_table_privilege('anon', 'public.checkout_resume_refs', 'SELECT')
     OR has_table_privilege('anon', 'public.checkout_resume_refs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.checkout_resume_refs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.checkout_resume_refs', 'INSERT') THEN
    RAISE EXCEPTION 'self-verify: checkout_resume_refs is readable or writable by anon or authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.checkout_resume_refs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.checkout_resume_refs', 'INSERT') THEN
    RAISE EXCEPTION 'self-verify: service_role cannot read and write checkout_resume_refs, so no product could be delivered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.checkout_resume_refs'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.temp_resume_storage'::regclass
       AND c.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'self-verify: checkout_resume_refs is not deleted with the temporary résumé it names';
  END IF;
  INSERT INTO public.temp_resume_storage (resume_text) VALUES ('selfcheck 20261004150000')
  RETURNING session_id INTO v_id;
  INSERT INTO public.checkout_resume_refs (stripe_session_id, resume_session_id)
  VALUES ('cs_selfcheck_20261004150000', v_id);
  DELETE FROM public.temp_resume_storage WHERE session_id = v_id;
  IF EXISTS (SELECT 1 FROM public.checkout_resume_refs WHERE stripe_session_id = 'cs_selfcheck_20261004150000') THEN
    RAISE EXCEPTION 'self-verify: a checkout reference outlived the résumé it points to';
  END IF;

  RAISE NOTICE 'self-verify 20261004150000: webhook payloads clean, strip trigger proven on insert and update, four retention jobs scheduled, nothing expired left, the AI cache holds no paid analysis and nothing past 24 hours, checkout references closed and tied to their résumé';
END $$;
