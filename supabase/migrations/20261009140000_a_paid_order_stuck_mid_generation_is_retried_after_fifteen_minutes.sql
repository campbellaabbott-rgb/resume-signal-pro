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
-- missing), BUT ONLY FOR A CALLER THAT ASKS FOR IT (p_include_generating).
-- Nothing generates for that long: an edge function's wall clock is well
-- under it, so a row that old has no living writer and a retry cannot race
-- one. The ten-minute wait for a fresh payment_received row, the gate on
-- next_retry_at (the full analysis and the Freelance Boost rows stay off the
-- queue) and retry_count < max_retries are unchanged.
--
-- WHY AN OPT-IN (sweep S11-146). The live sweep (retry-failed-deliveries
-- 2026-10-05.1) handles only payment_received, generation_failed and
-- email_failed, with no else branch: handed a 'generating' row it neither
-- throws nor spends a retry, so the row stays as it was, and ordered by
-- created_at it takes the five-row batch first on every run. Retries of real
-- failures would stall until the new sweep deployed (this header used to say
-- the old build "would spend a retry, which is harmless"; it spends none).
-- So the old one-argument function is replaced by one with a second argument
-- that defaults to false: the live sweep's call ({p_limit}) resolves to it
-- and is handed no 'generating' row, and retry-failed-deliveries 2026-10-09.61
-- passes p_include_generating true and treats such a row as it treats
-- payment_received (generate, save, mail). Either order of deploy is safe.
--
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

DROP FUNCTION IF EXISTS public.get_failed_deliveries_for_retry(integer);

CREATE OR REPLACE FUNCTION public.get_failed_deliveries_for_retry(p_limit integer DEFAULT 10, p_include_generating boolean DEFAULT false)
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
    -- A generation nobody finished: no writer lives this long. Handed only
    -- to a sweep that asks for it: the live one would hold its batch with it.
    AND (pd.status <> 'generating'
         OR (p_include_generating
             AND COALESCE(pd.content_generation_started_at, pd.created_at) <= now() - interval '15 minutes'))
  ORDER BY pd.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean) TO service_role;

COMMENT ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean) IS
  'Deliveries the retry sweep may finish: payment_received after 10 minutes, '
  'generating after 15 minutes without a finish (only when p_include_generating), '
  'generation_failed and email_failed at once; never a row whose next_retry_at is '
  'in the future (infinity keeps the full analysis and Freelance Boost off), never '
  'past max_retries. service_role only.';

DO $verify$
DECLARE
  v_def text;
  v_bad text[] := ARRAY[]::text[];
  v_sig regprocedure := to_regprocedure('public.get_failed_deliveries_for_retry(integer,boolean)');
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'get_failed_deliveries_for_retry(integer, boolean) does not exist after this file';
  END IF;
  IF to_regprocedure('public.get_failed_deliveries_for_retry(integer)') IS NOT NULL THEN
    v_bad := v_bad || 'the one-argument selector still exists beside the new one'::text;
  END IF;
  v_def := pg_get_functiondef(v_sig);
  IF position('p_include_generating' in v_def) = 0 THEN
    v_bad := v_bad || 'a generating row is handed to a sweep that did not ask for it'::text;
  END IF;
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
