-- A PAID ORDER STUCK MID-GENERATION IS RETRIED AFTER FIFTEEN MINUTES.
--
-- get_failed_deliveries_for_retry (20261005110000) selects payment_received,
-- generation_failed and email_failed rows. A row the webhook (or the success
-- page) moved to 'generating' and then never finished -- the isolate died at
-- its wall clock, the model call hung past it, a deploy recycled the worker --
-- stays 'generating' for ever: product_delivery_health counts it as stuck
-- after two hours, and nothing ever tries again (commercial-readiness
-- 2026-10-08, item 2).
--
-- A 'generating' row is now selected once its generation began fifteen
-- minutes ago (content_generation_started_at, or created_at when the stamp is
-- missing). Nothing generates for that long: an edge function's wall clock is
-- well under it, so a row that old has no living writer and a retry cannot
-- race one. The ten-minute wait for a fresh payment_received row, the gate on
-- next_retry_at (the full analysis and the Freelance Boost rows stay off the
-- queue) and retry_count < max_retries are unchanged. Same signature and
-- return shape, so CREATE OR REPLACE keeps the name; the grants are restated.
--
-- retry-failed-deliveries 2026-10-09.1 treats a stuck 'generating' row as it
-- treats payment_received (generate, save, mail); the older build would
-- leave it as it found it and spend a retry, which is harmless.
--
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.get_failed_deliveries_for_retry(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  stripe_session_id text,
  product_type text,
  product_name text,
  customer_email text,
  status text,
  retry_count integer,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pd.id,
    pd.stripe_session_id,
    pd.product_type,
    pd.product_name,
    pd.customer_email,
    pd.status,
    pd.retry_count,
    pd.metadata
  FROM product_deliveries pd
  WHERE pd.status IN ('payment_received', 'generating', 'generation_failed', 'email_failed')
    AND pd.retry_count < pd.max_retries
    AND (pd.next_retry_at IS NULL OR pd.next_retry_at <= now())
    -- The webhook may still be generating a row it wrote moments ago.
    AND (pd.status <> 'payment_received' OR pd.created_at <= now() - interval '10 minutes')
    -- A generation nobody finished: no writer lives this long.
    AND (pd.status <> 'generating'
         OR COALESCE(pd.content_generation_started_at, pd.created_at) <= now() - interval '15 minutes')
  ORDER BY pd.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_failed_deliveries_for_retry(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_failed_deliveries_for_retry(integer) TO service_role;

COMMENT ON FUNCTION public.get_failed_deliveries_for_retry(integer) IS
  'Deliveries the retry sweep may finish: payment_received after 10 minutes, '
  'generating after 15 minutes without a finish, generation_failed and '
  'email_failed at once; never a row whose next_retry_at is in the future '
  '(infinity keeps the full analysis and Freelance Boost off), never past '
  'max_retries. service_role only.';

DO $verify$
DECLARE
  v_def text;
  v_bad text[] := ARRAY[]::text[];
  v_sig regprocedure := to_regprocedure('public.get_failed_deliveries_for_retry(integer)');
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'get_failed_deliveries_for_retry(integer) does not exist after this file';
  END IF;
  v_def := pg_get_functiondef(v_sig);
  IF position('''generating''' in v_def) = 0 OR position('interval ''15 minutes''' in v_def) = 0 THEN
    v_bad := v_bad || 'the selector does not pick a generating row after fifteen minutes'::text;
  END IF;
  IF position('interval ''10 minutes''' in v_def) = 0 THEN
    v_bad := v_bad || 'the selector no longer waits ten minutes for the webhook'::text;
  END IF;
  IF position('next_retry_at IS NULL OR pd.next_retry_at <= now()' in v_def) = 0 THEN
    v_bad := v_bad || 'the selector no longer gates on next_retry_at'::text;
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('authenticated', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    v_bad := v_bad || 'get_failed_deliveries_for_retry is not service-role only'::text;
  END IF;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'stuck-generation retry self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'the retry sweep now finishes a generating row nobody finished after fifteen minutes';
END
$verify$;
