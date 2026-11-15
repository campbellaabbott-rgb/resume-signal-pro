-- A LOG KEEPS NO ADDRESS PAST NINETY DAYS (S14X-042, NEW-PRIVACY-RETENTION-01).
--
-- The Privacy page promises "Log Data: retained for up to 90 days". Nothing
-- enforced it. The only time-based deletes in the repository were the
-- scan-cache-and-telemetry-purge job (20260705162706), which touches none of:
--   payment_failures      abandoned checkouts with the buyer's email, kept forever
--   error_telemetry       kept forever
--   heartbeat_results     kept forever
--   parse_failures        the uploader's raw address in visitor_id, kept forever
--   scan_metrics          the scanner's raw address in visitor_id, kept forever
--   industry_detection_metrics   the same column, the same address
--   used_stripe_sessions  the buyer's raw address in ip_address, kept forever
-- And two of the writers that fill those tables, log_scan_metric and
-- log_heartbeat_result, answer any visitor with the publishable key: the live
-- database drifted from 20260706150000, which revoked the signatures this
-- folder knows and left the ones production holds callable. A stranger can
-- insert 'completed' scan_metrics rows that get_scan_totals counts into the
-- public scan figure, and forge heartbeat rows the health pages read.
--
-- WHAT THIS DOES, IN ORDER.
--  1. Stops new addresses at the database, so no edge function has to change
--     (the writers belong to other lanes): a BEFORE INSERT OR UPDATE trigger
--     stores NULL in visitor_id on scan_metrics, parse_failures and
--     industry_detection_metrics (no SQL function or page reads that column
--     from those three tables); another stores the constant 'withheld' for any
--     non-null used_stripe_sessions.ip_address; a third drops customer_email
--     from a payment_failures row whose failure_code is 'checkout_expired'
--     (nothing reads it).
--     WHY 'withheld' AND NEVER NULL. unnamedClaimRefusal (_shared/paid-session)
--     and priorRedemptionOf (_shared/full-analysis) read only whether the
--     claim's address is null: null on an unnamed claim dated before claims
--     named their product means "the webhook wrote it" and is honoured for
--     every generator. Nulling a buyer's address would turn a refused claim
--     into an accepted one. A non-null constant keeps every verdict the same.
--  2. Clears, once, here, what two small tables already hold: every claim's
--     address becomes 'withheld' and every abandoned checkout loses its email.
--     The visitor addresses already in the three log tables are NOT cleared
--     here: scan_metrics holds a row per scan, and one unbatched UPDATE of it
--     inside the staged runner's statement budget could fail the file and
--     every migration queued behind it. The nightly clears them in batches,
--     rows kept, finishing over as many nights as it needs ("unfinished").
--  3. privacy_retention_nightly(), run at 04:41 UTC by the job
--     'privacy-retention-nightly', deletes abandoned checkouts, error_telemetry,
--     heartbeat_results and parse_failures rows older than 90 days, drops the
--     email from other payment failures older than 90 days, clears the
--     visitor addresses stored before the triggers (over its first nights)
--     and any a trigger missed, and deletes check-subscription's five-minute
--     "not subscribed" pro_subscribers rows (status 'inactive', no Stripe
--     customer) a day after they were written. scan_metrics and
--     industry_detection_metrics rows are KEPT without the address:
--     get_scan_totals and get_real_score_distribution count them.
--     It never touches the claims themselves: the expired-session cleanup in
--     20251217173443 deletes rows assertPaidSession reads, and stays
--     unscheduled. It never re-issues scan-cache-and-telemetry-purge.
--  4. Closes EVERY overload of log_scan_metric, log_heartbeat_result,
--     log_parse_failure and log_industry_detection to PUBLIC, anon and
--     authenticated, read from pg_proc by name (never hand-listed signatures:
--     that is how the drift stayed open). Every caller is an edge function on
--     the service role.
--
-- Safe to re-run: CREATE OR REPLACE, DROP TRIGGER IF EXISTS before each
-- CREATE TRIGGER, updates that match nothing the second time, cron.schedule by
-- name. Every table is looked up with to_regclass first, so a database without
-- one of them applies the rest. The self-checks at the end RAISE, which rolls
-- the whole file back.

-- ── 1. the triggers ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.privacy_drop_visitor_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.visitor_id := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.privacy_withhold_claim_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.ip_address IS NOT NULL THEN
    NEW.ip_address := 'withheld';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.privacy_drop_abandoned_checkout_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.failure_code = 'checkout_expired' THEN
    NEW.customer_email := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.privacy_drop_visitor_address() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_withhold_claim_address() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_drop_abandoned_checkout_email() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.privacy_drop_visitor_address() TO service_role;
GRANT EXECUTE ON FUNCTION public.privacy_withhold_claim_address() TO service_role;
GRANT EXECUTE ON FUNCTION public.privacy_drop_abandoned_checkout_email() TO service_role;

DO $$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['scan_metrics', 'parse_failures', 'industry_detection_metrics'] LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL AND EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.' || v_t) AND attname = 'visitor_id' AND NOT attisdropped
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS keeps_no_visitor_address ON public.%I', v_t);
      EXECUTE format(
        'CREATE TRIGGER keeps_no_visitor_address BEFORE INSERT OR UPDATE OF visitor_id ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.privacy_drop_visitor_address()', v_t);
    END IF;
  END LOOP;

  IF to_regclass('public.used_stripe_sessions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS keeps_no_claim_address ON public.used_stripe_sessions;
    CREATE TRIGGER keeps_no_claim_address BEFORE INSERT OR UPDATE OF ip_address ON public.used_stripe_sessions
      FOR EACH ROW EXECUTE FUNCTION public.privacy_withhold_claim_address();
  END IF;

  IF to_regclass('public.payment_failures') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS keeps_no_abandoned_checkout_email ON public.payment_failures;
    CREATE TRIGGER keeps_no_abandoned_checkout_email BEFORE INSERT OR UPDATE OF customer_email, failure_code ON public.payment_failures
      FOR EACH ROW EXECUTE FUNCTION public.privacy_drop_abandoned_checkout_email();
  END IF;
END $$;

-- ── 2. what two small tables already hold, once ─────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.used_stripe_sessions') IS NOT NULL THEN
    UPDATE public.used_stripe_sessions SET ip_address = 'withheld'
    WHERE ip_address IS NOT NULL AND ip_address <> 'withheld';
  END IF;

  IF to_regclass('public.payment_failures') IS NOT NULL THEN
    UPDATE public.payment_failures SET customer_email = NULL
    WHERE failure_code = 'checkout_expired' AND customer_email IS NOT NULL;
  END IF;
END $$;

-- ── 3. the nightly ──────────────────────────────────────────────────────────
-- Batched, with a six-minute budget inside the command's ten: a night that
-- runs out of time finishes the rest the next night and says so
-- ("unfinished": true) rather than being cancelled half way.
CREATE OR REPLACE FUNCTION public.privacy_retention_nightly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10min'
AS $$
DECLARE
  v_cutoff timestamptz := now() - interval '90 days';
  v_cache_cutoff timestamptz := now() - interval '1 day';
  v_deadline timestamptz := clock_timestamp() + interval '6 minutes';
  v_batch constant integer := 5000;
  v_n integer;
  v_total integer;
  v_t text;
  v_out jsonb := '{}'::jsonb;
BEGIN
  -- Abandoned checkouts: the whole row goes at 90 days.
  v_total := 0;
  IF to_regclass('public.payment_failures') IS NOT NULL THEN
    LOOP
      DELETE FROM public.payment_failures WHERE id IN (
        SELECT id FROM public.payment_failures
        WHERE failure_code = 'checkout_expired' AND created_at < v_cutoff
        LIMIT v_batch);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;
      EXIT WHEN v_n < v_batch OR clock_timestamp() > v_deadline;
    END LOOP;
  END IF;
  v_out := v_out || jsonb_build_object('abandoned_checkouts_deleted', v_total);

  -- Every other payment failure keeps its row (a decline is a payment record)
  -- and loses the email at 90 days.
  v_total := 0;
  IF to_regclass('public.payment_failures') IS NOT NULL THEN
    LOOP
      UPDATE public.payment_failures SET customer_email = NULL WHERE id IN (
        SELECT id FROM public.payment_failures
        WHERE customer_email IS NOT NULL AND created_at < v_cutoff
        LIMIT v_batch);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;
      EXIT WHEN v_n < v_batch OR clock_timestamp() > v_deadline;
    END LOOP;
  END IF;
  v_out := v_out || jsonb_build_object('failure_emails_dropped', v_total);

  -- Logs: the whole row goes at 90 days.
  FOREACH v_t IN ARRAY ARRAY['error_telemetry', 'heartbeat_results', 'parse_failures'] LOOP
    v_total := 0;
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      LOOP
        EXECUTE format(
          'DELETE FROM public.%I WHERE id IN (SELECT id FROM public.%I WHERE created_at < $1 LIMIT %s)',
          v_t, v_t, v_batch) USING v_cutoff;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_total := v_total + v_n;
        EXIT WHEN v_n < v_batch OR clock_timestamp() > v_deadline;
      END LOOP;
    END IF;
    v_out := v_out || jsonb_build_object(v_t || '_deleted', v_total);
  END LOOP;

  -- The visitor addresses stored before the triggers existed (cleared here,
  -- in batches, over the first nights), and any a trigger did not stop (one
  -- dropped by a later rebuild of its table): rows kept, address gone.
  v_total := 0;
  FOREACH v_t IN ARRAY ARRAY['scan_metrics', 'parse_failures', 'industry_detection_metrics'] LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      LOOP
        EXECUTE format(
          'UPDATE public.%I SET visitor_id = NULL WHERE id IN (SELECT id FROM public.%I WHERE visitor_id IS NOT NULL LIMIT %s)',
          v_t, v_t, v_batch);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_total := v_total + v_n;
        EXIT WHEN v_n < v_batch OR clock_timestamp() > v_deadline;
      END LOOP;
    END IF;
  END LOOP;
  v_out := v_out || jsonb_build_object('visitor_addresses_cleared', v_total);

  v_total := 0;
  IF to_regclass('public.used_stripe_sessions') IS NOT NULL THEN
    LOOP
      UPDATE public.used_stripe_sessions SET ip_address = 'withheld' WHERE session_id IN (
        SELECT session_id FROM public.used_stripe_sessions
        WHERE ip_address IS NOT NULL AND ip_address <> 'withheld'
        LIMIT v_batch);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;
      EXIT WHEN v_n < v_batch OR clock_timestamp() > v_deadline;
    END LOOP;
  END IF;
  v_out := v_out || jsonb_build_object('claim_addresses_withheld', v_total);

  -- check-subscription's "not subscribed" answer, remembered for five
  -- minutes (NOT_LIVE_CACHE_MS) and read by nothing after: gone after a day.
  -- A row with a Stripe customer, or any status but 'inactive', stays.
  v_total := 0;
  IF to_regclass('public.pro_subscribers') IS NOT NULL THEN
    DELETE FROM public.pro_subscribers
    WHERE status = 'inactive' AND stripe_customer_id IS NULL AND updated_at < v_cache_cutoff;
    GET DIAGNOSTICS v_total = ROW_COUNT;
  END IF;
  v_out := v_out || jsonb_build_object('subscription_cache_rows_deleted', v_total);

  RETURN v_out || jsonb_build_object('unfinished', clock_timestamp() > v_deadline);
END;
$$;

REVOKE ALL ON FUNCTION public.privacy_retention_nightly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.privacy_retention_nightly() TO service_role;

COMMENT ON FUNCTION public.privacy_retention_nightly() IS
  'The Privacy page''s 90-day log promise, enforced nightly by the job privacy-retention-nightly: deletes abandoned checkouts, error_telemetry, heartbeat_results and parse_failures rows older than 90 days, drops the email from older payment failures, clears any visitor or claim address left (claims keep the constant ''withheld'', never NULL), and deletes inactive no-customer pro_subscribers cache rows after a day. Batched with a six-minute budget. Service role only (20261112100000).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'privacy-retention-nightly', '41 4 * * *',
      $job$ SET statement_timeout = '10min'; SELECT public.privacy_retention_nightly(); $job$);
  END IF;
END $$;

-- ── 4. the four log writers answer the service role only ────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY['log_scan_metric', 'log_heartbeat_result', 'log_parse_failure', 'log_industry_detection'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ── self-checks: RAISE rolls the whole file back ────────────────────────────
DO $$
DECLARE
  v_fn oid := to_regprocedure('public.privacy_retention_nightly()');
  v_open text;
  v_cmd text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '20261112100000: privacy_retention_nightly() is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION '20261112100000: privacy_retention_nightly must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261112100000: a client role can run privacy_retention_nightly';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261112100000: the service role cannot run privacy_retention_nightly';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_open
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY['log_scan_metric', 'log_heartbeat_result', 'log_parse_failure', 'log_industry_detection'])
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION '20261112100000: a client role can still run %', v_open;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'privacy-retention-nightly';
    IF v_cmd IS NULL THEN
      RAISE EXCEPTION '20261112100000: the job privacy-retention-nightly was not scheduled';
    END IF;
    IF v_cmd !~ 'SET statement_timeout' THEN
      RAISE EXCEPTION '20261112100000: the job privacy-retention-nightly sets no statement_timeout in its command';
    END IF;
    IF v_cmd ~ 'cleanup_expired_stripe_sessions' THEN
      RAISE EXCEPTION '20261112100000: the job must never delete the claims assertPaidSession reads';
    END IF;
  END IF;
END $$;

-- A probe claim, written and rolled back: the stored address is the constant.
DO $$
DECLARE
  v_ip text;
BEGIN
  IF to_regclass('public.used_stripe_sessions') IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.used_stripe_sessions (session_id, ip_address)
    VALUES ('cs_privacy_retention_selfcheck', '203.0.113.7');
    SELECT ip_address INTO v_ip FROM public.used_stripe_sessions WHERE session_id = 'cs_privacy_retention_selfcheck';
    RAISE EXCEPTION 'privacy-retention-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'privacy-retention-selfcheck-rollback' THEN
      RAISE;
    END IF;
  END;
  IF v_ip IS DISTINCT FROM 'withheld' THEN
    RAISE EXCEPTION '20261112100000: a new claim stored % as its address, not withheld', coalesce(v_ip, 'NULL');
  END IF;
END $$;
