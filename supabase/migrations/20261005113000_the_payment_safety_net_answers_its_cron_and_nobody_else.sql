-- THE PAYMENT SAFETY NET ANSWERS ITS CRON, OUR SERVERS AND THE OWNER, AND
-- NOBODY ELSE.
--
-- reconcile-stripe (verify_jwt = false) answered any POST: it paged through up
-- to twenty Stripe list calls on our secret key, over a lookback the caller
-- chose, and a stranger could repeat that as fast as they liked -- spending
-- the Stripe rate limit every checkout shares (2026-10-04 completeness
-- review). 20260807020000 rejected a shared cron secret because an unset one
-- would leave the job silently failing; the shape used since
-- (20260918101000, 20261004110000) answers that objection: the key is
-- GENERATED HERE, in the vault, on first application, so nobody has to copy
-- it anywhere and it cannot be "unset". The cron reads it from the vault and
-- sends it as x-reconcile-cron; the function asks reconcile_cron_key_matches,
-- which answers a boolean and never the key. The service-role key and the
-- owner's ADMIN_API_KEY still open it for a hand-run.
--
-- reconcile_stripe_tick() keeps everything else it did: the same URL, the
-- same 48-hour body, and the lastCronAt stamp written by the scheduled SQL
-- itself (only pg_cron can call it; it stays revoked from every client role).
-- ORDER: until the function build reconcile-stripe.2026-10-05.1 is deployed
-- the old one still answers the keyed post (it ignores the header); once it
-- is, an unkeyed post is a 401 and the keyed one sweeps.

SET LOCAL statement_timeout = '2min';

-- The key, generated once.
DO $arm$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'reconcile cron key: no vault on this host; reconcile-stripe answers only the service role and the admin key here';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'reconcile_cron_key') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'reconcile_cron_key'
    );
    RAISE NOTICE 'reconcile cron key: generated reconcile_cron_key in the vault';
  ELSE
    RAISE NOTICE 'reconcile cron key: already present; left untouched';
  END IF;
END
$arm$;

CREATE OR REPLACE FUNCTION public.reconcile_cron_key_matches(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $keycheck$
DECLARE
  v_ok boolean := false;
BEGIN
  IF p_key IS NULL OR length(p_key) < 32 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = $1 AND s.decrypted_secret = $2)'
     INTO v_ok USING 'reconcile_cron_key', p_key;
  RETURN COALESCE(v_ok, false);
END
$keycheck$;

COMMENT ON FUNCTION public.reconcile_cron_key_matches(text) IS
  'True when the argument equals the vault-held reconcile_cron_key the reconcile-stripe cron sends as x-reconcile-cron. '
  'Returns a boolean and never the key. An empty, short or missing key never matches. service_role only.';

REVOKE ALL ON FUNCTION public.reconcile_cron_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cron_key_matches(text) TO service_role;

-- The scheduled entry point, now carrying the key. The header is read from
-- the vault at call time; on a host with no vault the post goes out unkeyed
-- (and is refused), which the run stamp below then shows as a cron that
-- fired with no sweep behind it.
CREATE OR REPLACE FUNCTION public.reconcile_stripe_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_key text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
       INTO v_key USING 'reconcile_cron_key';
  END IF;

  -- Unchanged from the original schedule: same URL, same 48h lookback that
  -- clears Stripe's webhook retry window while staying inside the 30-day
  -- used_stripe_sessions retention.
  PERFORM net.http_post(
    url     := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/reconcile-stripe',
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reconcile-cron', v_key
    )),
    body    := '{"lookbackHours": 48}'::jsonb
  );

  -- Stamped AFTER the post is queued, and deliberately not conditional on the
  -- sweep's outcome: this field answers exactly one question, "did the
  -- schedule fire?". The function's own counts stamp says what the sweep saw.
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('reconcile_stripe_cron', jsonb_build_object('lastCronAt', now()), now())
  ON CONFLICT (k) DO UPDATE
    SET v = jsonb_build_object('lastCronAt', now()), updated_at = now();
END;
$fn$;

REVOKE ALL ON FUNCTION public.reconcile_stripe_tick() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reconcile_stripe_tick() IS
  'Scheduled entry point for reconcile-stripe. Posts to the function with the vault key as x-reconcile-cron and stamps '
  'job_board_meta.reconcile_stripe_cron.lastCronAt. Callable only by the scheduler.';

-- The schedule, re-stated so this file stands on its own: unschedule then
-- schedule (a NOT EXISTS guard would leave a job other than this one in
-- place), at the same minute, pointing at the tick. Moving the time would
-- quietly change which Stripe window gets swept.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stripe') THEN
      PERFORM cron.unschedule('reconcile-stripe');
    END IF;
    PERFORM cron.schedule(
      'reconcile-stripe',
      '17 15 * * *',
      $job$ SELECT public.reconcile_stripe_tick(); $job$
    );
  ELSE
    RAISE NOTICE 'reconcile-stripe cron: pg_cron is not installed here; nothing rescheduled';
  END IF;
END
$cron$;

-- Self-check: the catalogue is what this file intended, or the migration fails.
DO $verify$
DECLARE
  v_bad text[] := ARRAY[]::text[];
  v_def text;
  v_key text;
BEGIN
  IF to_regprocedure('public.reconcile_cron_key_matches(text)') IS NULL THEN
    v_bad := v_bad || 'reconcile_cron_key_matches(text) does not exist'::text;
  ELSIF has_function_privilege('anon', 'public.reconcile_cron_key_matches(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reconcile_cron_key_matches(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.reconcile_cron_key_matches(text)', 'EXECUTE') THEN
    v_bad := v_bad || 'reconcile_cron_key_matches is not service-role only'::text;
  END IF;

  v_def := pg_get_functiondef(to_regprocedure('public.reconcile_stripe_tick()'));
  IF v_def IS NULL THEN
    v_bad := v_bad || 'reconcile_stripe_tick() does not exist'::text;
  ELSE
    IF position('x-reconcile-cron' in v_def) = 0 THEN
      v_bad := v_bad || 'reconcile_stripe_tick does not send x-reconcile-cron'::text;
    END IF;
    IF position('reconcile_stripe_cron' in v_def) = 0 THEN
      v_bad := v_bad || 'reconcile_stripe_tick no longer stamps lastCronAt'::text;
    END IF;
    IF has_function_privilege('anon', 'public.reconcile_stripe_tick()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.reconcile_stripe_tick()', 'EXECUTE') THEN
      v_bad := v_bad || 'reconcile_stripe_tick is callable by a client role'::text;
    END IF;
  END IF;

  -- THE KEYED PATH, END TO END. Where there is a vault, the key must exist,
  -- this role (the owner the tick runs as) must be able to read it the way the
  -- tick does, and the function's key check must accept exactly that value.
  -- Without this the file passed while every daily post went out unkeyed or
  -- mis-keyed and was refused, and lastCronAt kept advancing as if the sweep
  -- ran (2026-10-05 review).
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'reconcile_cron_key') THEN
      v_bad := v_bad || 'the vault holds no reconcile_cron_key'::text;
    ELSE
      EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
         INTO v_key USING 'reconcile_cron_key';
      IF v_key IS NULL THEN
        v_bad := v_bad || 'reconcile_cron_key cannot be read back from vault.decrypted_secrets, so the tick would post unkeyed'::text;
      ELSIF to_regprocedure('public.reconcile_cron_key_matches(text)') IS NOT NULL
            AND NOT public.reconcile_cron_key_matches(v_key) THEN
        v_bad := v_bad || 'reconcile_cron_key_matches refuses the key the tick sends'::text;
      END IF;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stripe' AND position('reconcile_stripe_tick' in command) > 0) THEN
      v_bad := v_bad || 'the reconcile-stripe cron job does not call reconcile_stripe_tick()'::text;
    END IF;
  END IF;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'reconcile cron key self-check failed (% problem(s)): %',
      cardinality(v_bad), array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'reconcile-stripe: the cron sends its vault key (read back and accepted by reconcile_cron_key_matches here); the function answers only that, the service role and the admin key';
END
$verify$;
