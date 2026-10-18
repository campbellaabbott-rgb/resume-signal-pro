-- A PAID ORDER MADE BUT NEVER MAILED IS MAILED FROM ITS SAVED COPY.
--
-- WHAT WAS WRONG (critical-path plan 2026-10-12, CP-021, CP-C item 3). An
-- order is made in one step and mailed in the next, by three writers:
--   * the webhook and the retry sweep save the copy, write 'content_generated'
--     and then call send-product-email;
--   * the success page's verifier saves the copy, writes 'generated' (the
--     generation_completed step of log_delivery_step) and then mails it.
-- An isolate that dies between the two (its wall clock, a deploy recycling
-- the worker, a model call that ran long) leaves a made, paid order whose mail
-- never left. get_failed_deliveries_for_retry (20261009140000) selects only
-- payment_received, generating, generation_failed and email_failed, so that
-- order was never selected, never mailed, and never alarmed: the buyer paid
-- and heard nothing.
--
-- NOW a 'generated' or 'content_generated' row whose mail was never sent
-- (email_sent_at is null) is selected once it was made fifteen minutes ago
-- (content_generation_completed_at, or created_at when the stamp is missing):
-- nothing still mailing it lives that long. The sweep mails the saved copy and
-- never makes it again (retry-failed-deliveries 2026-10-11.22). Only orders
-- paid in the last 90 days, the time past buyers keep what they bought (owner
-- decision 2026-10-12): an older one is the owner's to settle by hand, and a
-- buyer is never mailed a stale order out of nowhere. Like the
-- 'generating' rows, they are handed only to a caller that asks for them
-- (p_include_unmailed): the sweep that is live when this file applies has no
-- branch for those two statuses and would hold its two-row batch with them.
-- Everything else is as before: the ten-minute wait for a fresh
-- payment_received row, the next_retry_at gate (infinity keeps the products
-- made on their own page off the queue), retry_count < max_retries.
--
-- Apply BEFORE retry-failed-deliveries 2026-10-11.22 (no ledger entry: the
-- default order runs migrations before the functions). The live sweep's call
-- names p_limit and p_include_generating, which resolve to this function with
-- p_include_unmailed false; the new sweep's call names no function until this
-- file has run. Safe to re-run.

SET LOCAL statement_timeout = '2min';

DROP FUNCTION IF EXISTS public.get_failed_deliveries_for_retry(integer, boolean);

CREATE OR REPLACE FUNCTION public.get_failed_deliveries_for_retry(
  p_limit integer DEFAULT 10,
  p_include_generating boolean DEFAULT false,
  p_include_unmailed boolean DEFAULT false
)
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
  WHERE pd.status IN ('payment_received', 'generating', 'generation_failed', 'email_failed', 'generated', 'content_generated')
    AND pd.retry_count < pd.max_retries
    AND (pd.next_retry_at IS NULL OR pd.next_retry_at <= now())
    -- The webhook may still be generating a row it wrote moments ago.
    AND (pd.status <> 'payment_received' OR pd.created_at <= now() - interval '10 minutes')
    -- A generation nobody finished: no writer lives this long. Handed only
    -- to a sweep that asks for it.
    AND (pd.status <> 'generating'
         OR (p_include_generating
             AND COALESCE(pd.content_generation_started_at, pd.created_at) <= now() - interval '15 minutes'))
    -- Made, never mailed: the writer that would have mailed it is gone.
    -- Handed only to a sweep that asks for it; a mailed copy is never picked.
    AND (pd.status NOT IN ('generated', 'content_generated')
         OR (p_include_unmailed
             AND pd.email_sent_at IS NULL
             AND COALESCE(pd.content_generation_completed_at, pd.created_at) <= now() - interval '15 minutes'
             AND pd.created_at > now() - interval '90 days'))
  ORDER BY pd.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean, boolean) TO service_role;

COMMENT ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean, boolean) IS
  'Deliveries the retry sweep may finish: payment_received after 10 minutes, generating after 15 minutes '
  'without a finish (only when p_include_generating), generated or content_generated with no mail sent 15 '
  'minutes after they were made and within 90 days of payment (only when p_include_unmailed), '
  'generation_failed and email_failed at once; '
  'never a row whose next_retry_at is in the future, never past max_retries. service_role only. 20261011143000.';

-- Self-verifying: one selector, service-role only, and on probe rows (rolled
-- back) it picks a made-but-unmailed order only when asked, only after
-- fifteen minutes and only inside 90 days, never a mailed one, and still picks
-- what it picked before.
DO $verify$
DECLARE
  v_bad      text[] := ARRAY[]::text[];
  v_sig      regprocedure := to_regprocedure('public.get_failed_deliveries_for_retry(integer,boolean,boolean)');
  v_got      text[];
  v_sentinel constant text := 'unmailed-order probe: rolled back';
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'get_failed_deliveries_for_retry(integer, boolean, boolean) does not exist after this file';
  END IF;
  IF to_regprocedure('public.get_failed_deliveries_for_retry(integer,boolean)') IS NOT NULL
     OR to_regprocedure('public.get_failed_deliveries_for_retry(integer)') IS NOT NULL THEN
    v_bad := v_bad || 'an older selector still exists beside the new one'::text;
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('authenticated', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    v_bad := v_bad || 'get_failed_deliveries_for_retry is not service-role only'::text;
  END IF;

  BEGIN
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, content_generation_completed_at, email_sent_at) VALUES
      ('cs_selfcheck_143000_made_old',    'cover_letter', 'content_generated', now() - interval '1 hour', now() - interval '20 minutes', NULL),
      ('cs_selfcheck_143000_page_old',    'cover_letter', 'generated',         now() - interval '1 hour', now() - interval '20 minutes', NULL),
      ('cs_selfcheck_143000_made_fresh',  'cover_letter', 'content_generated', now() - interval '1 hour', now() - interval '5 minutes',  NULL),
      ('cs_selfcheck_143000_made_mailed', 'cover_letter', 'content_generated', now() - interval '1 hour', now() - interval '20 minutes', now() - interval '19 minutes'),
      ('cs_selfcheck_143000_made_stale',  'cover_letter', 'content_generated', now() - interval '100 days', now() - interval '100 days', NULL),
      ('cs_selfcheck_143000_failed',      'cover_letter', 'generation_failed', now() - interval '1 hour', NULL, NULL);

    SELECT array_agg(f.stripe_session_id ORDER BY f.stripe_session_id) INTO v_got
      FROM public.get_failed_deliveries_for_retry(100, true, true) f
     WHERE f.stripe_session_id LIKE 'cs_selfcheck_143000_%';
    IF v_got IS DISTINCT FROM ARRAY['cs_selfcheck_143000_failed', 'cs_selfcheck_143000_made_old', 'cs_selfcheck_143000_page_old'] THEN
      v_bad := v_bad || format('asked for unmailed orders, the selector picked %s', v_got);
    END IF;

    SELECT array_agg(f.stripe_session_id ORDER BY f.stripe_session_id) INTO v_got
      FROM public.get_failed_deliveries_for_retry(100, true) f
     WHERE f.stripe_session_id LIKE 'cs_selfcheck_143000_%';
    IF v_got IS DISTINCT FROM ARRAY['cs_selfcheck_143000_failed'] THEN
      v_bad := v_bad || format('a sweep that did not ask was handed %s', v_got);
    END IF;

    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_bad := v_bad || ('the probe could not run: ' || SQLERRM);
    END IF;
  END;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'unmailed-order selector self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'self-verify 20261011143000: a paid order made but never mailed is selected after fifteen minutes, only by a sweep that asks';
END
$verify$;
