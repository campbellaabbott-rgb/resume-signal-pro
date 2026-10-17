-- A PAID DELIVERY IS RETRIED THROUGH THE DAY, AND AN OUTAGE DOES NOT SPEND ITS TRIES.
--
-- WHAT WAS WRONG (sweep S11-014). A paid delivery got three attempts in about
-- 45 minutes and was then abandoned: the webhook's failure counted as retry 1
-- (+5 minutes), the */15 sweep failed twice more (+15, +45), and
-- get_failed_deliveries_for_retry never selects a row with retry_count >=
-- max_retries (default 3). A 402 (AI credits exhausted), a 429, a 5xx or a
-- timeout counted the same as a real failure, so any gateway outage or credit
-- exhaustion longer than ~45 minutes left the sale charged and never
-- delivered. The résumé it is made from lives 24 hours.
--
-- OWNER DECISION 2026-10-11: retries are spread over 24 hours, transient
-- errors do not count toward the budget, and an alarm fires when a delivery
-- runs out (retry-failed-deliveries 2026-10-09.61 mails the owner).
--
-- WHAT THIS FILE DOES.
--   1. delivery_error_is_transient(text): a 402, 408, 425, 429 or 5xx status
--      in the error text the webhook and the sweep write ("Generation failed:
--      503", "send-product-email answered 502", "Email failed: 500"), a
--      timeout or abort, an unreachable network, a deadlock, or the limiter
--      being unavailable. Read from the text both the live and the new builds
--      already write, so the live webhook benefits the moment this applies.
--   2. product_deliveries.transient_failures counts the failures that did not
--      count; max_retries defaults to 8 counted failures.
--   3. update_delivery_retry (same signature, so every caller keeps working):
--        - a transient failure adds to transient_failures, not retry_count;
--        - the next try waits 5 min, 15 min, 1 h, 2 h, 4 h, 6 h, then 8 h
--          after the 1st, 2nd, 3rd ... failure of either kind;
--        - a try that would fall more than 24 hours after the purchase, or a
--          failure once that day is over, spends the row (retry_count =
--          max_retries): nothing a retry does can work once the résumé is gone.
--   4. Open rows bought in the last 24 hours keep their place: those still on
--      the old budget of 3 get 8, so a row an outage exhausted is selected
--      again.
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.delivery_error_is_transient(p_error text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(p_error, '') ~* '(failed|answered|status)\D{0,3}(402|408|425|429|5[0-9][0-9])\M'
      OR coalesce(p_error, '') ~* '(timed? ?out|timeout|aborted|aborterror|limiter_unavailable|rate.?limit|fetch failed|network|connection (reset|refused|closed)|econnreset|error sending request|temporarily unavailable|service unavailable|bad gateway|deadlock)'
      OR coalesce(p_error, '') ~* '^send-product-email threw:';
$$;

REVOKE ALL ON FUNCTION public.delivery_error_is_transient(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_error_is_transient(text) TO service_role;

COMMENT ON FUNCTION public.delivery_error_is_transient(text) IS
  'True for a delivery error that says nothing about the order: a 402/408/425/429/5xx status, a timeout, an '
  'unreachable network, a deadlock, the limiter unavailable. update_delivery_retry does not count these toward '
  'max_retries (S11-014, 20261009134100). service_role only.';

ALTER TABLE public.product_deliveries ADD COLUMN IF NOT EXISTS transient_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.product_deliveries ALTER COLUMN max_retries SET DEFAULT 8;

COMMENT ON COLUMN public.product_deliveries.transient_failures IS
  'Failures that did not count toward max_retries (delivery_error_is_transient): an outage, not the order. 20261009134100.';

CREATE OR REPLACE FUNCTION public.update_delivery_retry(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_increment_retry boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.product_deliveries%ROWTYPE;
  v_retry integer;
  v_transient integer;
  v_step integer;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_row FROM public.product_deliveries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT p_increment_retry THEN
    UPDATE public.product_deliveries
       SET status = p_status,
           last_retry_error = COALESCE(p_error, last_retry_error),
           next_retry_at = NULL
     WHERE id = p_id;
    RETURN true;
  END IF;

  v_retry := v_row.retry_count;
  v_transient := v_row.transient_failures;
  IF v_row.created_at <= now() - interval '24 hours' THEN
    -- The day is over: the résumé is gone, so no retry can work.
    v_retry := GREATEST(v_row.max_retries, v_retry + 1);
  ELSIF public.delivery_error_is_transient(p_error) THEN
    v_transient := v_transient + 1;
  ELSE
    v_retry := v_retry + 1;
  END IF;

  -- The schedule follows every failure, counted or not.
  v_step := v_retry + v_transient;
  v_next := now() + CASE LEAST(v_step, 7)
    WHEN 1 THEN interval '5 minutes'
    WHEN 2 THEN interval '15 minutes'
    WHEN 3 THEN interval '1 hour'
    WHEN 4 THEN interval '2 hours'
    WHEN 5 THEN interval '4 hours'
    WHEN 6 THEN interval '6 hours'
    ELSE interval '8 hours'
  END;
  -- A try that would land after the résumé's day spends the row now.
  IF v_retry >= v_row.max_retries OR v_next > v_row.created_at + interval '24 hours' THEN
    v_retry := GREATEST(v_retry, v_row.max_retries);
    v_next := NULL;
  END IF;

  UPDATE public.product_deliveries
     SET status = p_status,
         last_retry_error = COALESCE(p_error, last_retry_error),
         retry_count = v_retry,
         transient_failures = v_transient,
         next_retry_at = v_next
   WHERE id = p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_delivery_retry(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_delivery_retry(uuid, text, text, boolean) TO service_role;

COMMENT ON FUNCTION public.update_delivery_retry(uuid, text, text, boolean) IS
  'Records a failed delivery attempt: a transient error (delivery_error_is_transient) adds to transient_failures, '
  'any other to retry_count; the next try waits 5m, 15m, 1h, 2h, 4h, 6h, 8h by failure; a try past 24 hours after '
  'the purchase spends the row (retry_count = max_retries). S11-014, 20261009134100. service_role only.';

-- Rows still open, bought inside the day, under the old budget of three.
UPDATE public.product_deliveries
   SET max_retries = 8
 WHERE max_retries = 3
   AND status IN ('payment_received', 'generating', 'generation_failed', 'email_failed')
   AND created_at > now() - interval '24 hours';

-- Self-verifying: the classifier reads what the writers write, the schedule
-- and the day's end hold on a probe row, and both functions are closed to the
-- client roles. The probe rows are rolled back.
DO $verify$
DECLARE
  v_bad text[] := ARRAY[]::text[];
  v_id uuid;
  v_row public.product_deliveries%ROWTYPE;
BEGIN
  IF NOT public.delivery_error_is_transient('Generation failed: 402 - credits exhausted')
     OR NOT public.delivery_error_is_transient('Generation failed: 503')
     OR NOT public.delivery_error_is_transient('send-product-email answered 502')
     OR NOT public.delivery_error_is_transient('Email retry failed: 500')
     OR NOT public.delivery_error_is_transient('The signal has been aborted')
     OR NOT public.delivery_error_is_transient('limiter_unavailable') THEN
    v_bad := v_bad || 'a transient error was read as a real failure'::text;
  END IF;
  IF public.delivery_error_is_transient('Generation failed: 400 - bad request')
     OR public.delivery_error_is_transient('Resume data expired')
     OR public.delivery_error_is_transient('generate-cover-letter answered 200 with no content')
     OR public.delivery_error_is_transient(NULL) THEN
    v_bad := v_bad || 'a real failure was read as transient'::text;
  END IF;
  IF has_function_privilege('anon', 'public.update_delivery_retry(uuid,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.update_delivery_retry(uuid,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delivery_error_is_transient(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.delivery_error_is_transient(text)', 'EXECUTE') THEN
    v_bad := v_bad || 'a delivery retry function is callable by a client role'::text;
  END IF;

  BEGIN
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status)
      VALUES ('cs_selfcheck_134100', 'cover_letter', 'generation_failed') RETURNING id INTO v_id;
    PERFORM public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 402', true);
    SELECT * INTO v_row FROM public.product_deliveries WHERE id = v_id;
    IF v_row.retry_count <> 0 OR v_row.transient_failures <> 1 OR v_row.next_retry_at IS NULL THEN
      v_bad := v_bad || 'a 402 spent a try or was not scheduled'::text;
    END IF;
    IF v_row.max_retries <> 8 THEN
      v_bad := v_bad || 'a new row does not get eight counted tries'::text;
    END IF;
    PERFORM public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 400', true);
    SELECT * INTO v_row FROM public.product_deliveries WHERE id = v_id;
    IF v_row.retry_count <> 1 OR v_row.next_retry_at < now() + interval '14 minutes' THEN
      v_bad := v_bad || 'a real failure was not counted, or its second try was not 15 minutes out'::text;
    END IF;
    UPDATE public.product_deliveries SET created_at = now() - interval '25 hours' WHERE id = v_id;
    PERFORM public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 503', true);
    SELECT * INTO v_row FROM public.product_deliveries WHERE id = v_id;
    IF v_row.retry_count < v_row.max_retries OR v_row.next_retry_at IS NOT NULL THEN
      v_bad := v_bad || 'a failure after the day did not spend the row'::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'probe done; rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'delivery retry self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
END
$verify$;
