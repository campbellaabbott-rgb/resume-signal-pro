-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing; it re-creates the retry sweep's row selector with its signature and its columns unchanged (reviewed 2026-11-21, bug round of 2026-11-19, lane payments-delivery, S10-077).
--
-- A DELIVERY IS CLAIMED BY THE RUN THAT READS IT (S10-077).
--
-- WHAT WAS WRONG. retry-failed-deliveries asks get_failed_deliveries_for_retry
-- (20261011143000) for the orders it should finish, and that read claimed
-- nothing: it was a plain SELECT ... LIMIT. Generation is leased
-- (take_delivery_lease, 20261011144000), so two runs at once no longer pay for
-- two generations; but an order whose copy is already saved, and an order
-- whose mail failed, are mailed with no lease. Two runs that start together
-- were handed the same row and both mailed the buyer. They are the pg_cron run
-- and a run any visitor can start with a POST (the function is verify_jwt
-- false, six an hour per address).
--
-- NOW the read is the claim. The rows it hands out are locked as they are
-- chosen (FOR UPDATE SKIP LOCKED, so a second run at the same moment passes
-- over them rather than waiting) and their next_retry_at is pushed twenty
-- minutes on in the same statement, so a run that starts later in those
-- twenty minutes is not handed them either. Twenty minutes is past the
-- generation lease (ten) and far past the function's own wall clock. Whatever
-- the run then writes replaces the claim: delivered, a failure's next try
-- (update_delivery_retry), or infinity. A run that dies holding a row leaves
-- it to the run after the twenty minutes.
--
-- Everything else is as 20261011143000 left it: the same statuses and waits,
-- the same opt-ins, oldest first, the same eight columns, so the sweep that is
-- live when this file applies reads it unchanged. It is SECURITY INVOKER now:
-- its only caller is the service role, which reads and writes the table
-- itself, and a definer added nothing but a way past row level security.
-- service_role only, by name. Apply before retry-failed-deliveries
-- 2026-11-21.1 (the default order runs migrations first). Safe to re-run.

SET LOCAL statement_timeout = '2min';

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
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT pd.id AS due_id
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
    LIMIT p_limit
    FOR UPDATE OF pd SKIP LOCKED
  ),
  claimed AS (
    -- The claim: the next run is not handed these rows for twenty minutes.
    UPDATE product_deliveries AS held
       SET next_retry_at = now() + interval '20 minutes'
      FROM due
     WHERE held.id = due.due_id
    RETURNING held.id AS c_id, held.stripe_session_id AS c_session, held.product_type AS c_type,
              held.product_name AS c_name, held.customer_email AS c_email, held.status AS c_status,
              held.retry_count AS c_retries, held.metadata AS c_metadata, held.created_at AS c_created
  )
  SELECT c.c_id, c.c_session, c.c_type, c.c_name, c.c_email, c.c_status, c.c_retries, c.c_metadata
  FROM claimed c
  ORDER BY c.c_created ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean, boolean) TO service_role;

COMMENT ON FUNCTION public.get_failed_deliveries_for_retry(integer, boolean, boolean) IS
  'Deliveries the retry sweep may finish, CLAIMED by the call that reads them: each row handed out is locked '
  '(FOR UPDATE SKIP LOCKED) and its next_retry_at pushed 20 minutes on, so a second run is not handed it. '
  'payment_received after 10 minutes, generating after 15 minutes without a finish (only when p_include_generating), '
  'generated or content_generated with no mail sent 15 minutes after they were made and within 90 days of payment '
  '(only when p_include_unmailed), generation_failed and email_failed at once; never a row whose next_retry_at is in '
  'the future, never past max_retries. SECURITY INVOKER, service_role only. 20261121130000 (S10-077).';

-- Self-verifying: one selector, invoker, service-role only; and on probe rows
-- (rolled back) two calls in one transaction hand out disjoint rows, each row
-- handed out carries its twenty-minute claim, and what the selector picks is
-- what it picked before. The probe rows are dated centuries back so the
-- oldest-first reads take them before any real order.
DO $verify$
DECLARE
  v_bad      text[] := ARRAY[]::text[];
  v_sig      regprocedure := to_regprocedure('public.get_failed_deliveries_for_retry(integer,boolean,boolean)');
  v_first    text[];
  v_second   text[];
  v_held     integer;
  v_sentinel constant text := 'claimed-delivery probe: rolled back';
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'get_failed_deliveries_for_retry(integer, boolean, boolean) does not exist after this file';
  END IF;
  IF to_regprocedure('public.get_failed_deliveries_for_retry(integer,boolean)') IS NOT NULL
     OR to_regprocedure('public.get_failed_deliveries_for_retry(integer)') IS NOT NULL THEN
    v_bad := v_bad || 'an older selector still exists beside this one'::text;
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_sig) THEN
    v_bad := v_bad || 'get_failed_deliveries_for_retry is still SECURITY DEFINER'::text;
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('authenticated', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    v_bad := v_bad || 'get_failed_deliveries_for_retry is not service-role only'::text;
  END IF;

  BEGIN
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at) VALUES
      ('cs_selfcheck_130000_a', 'cover_letter', 'generation_failed', now() - interval '500 years'),
      ('cs_selfcheck_130000_b', 'cover_letter', 'email_failed',      now() - interval '499 years'),
      ('cs_selfcheck_130000_c', 'cover_letter', 'generation_failed', now() - interval '498 years'),
      ('cs_selfcheck_130000_d', 'cover_letter', 'email_failed',      now() - interval '497 years');

    SELECT array_agg(f.stripe_session_id ORDER BY f.stripe_session_id) INTO v_first
      FROM public.get_failed_deliveries_for_retry(2, true, true) f;
    SELECT array_agg(f.stripe_session_id ORDER BY f.stripe_session_id) INTO v_second
      FROM public.get_failed_deliveries_for_retry(2, true, true) f;
    IF v_first IS DISTINCT FROM ARRAY['cs_selfcheck_130000_a', 'cs_selfcheck_130000_b'] THEN
      v_bad := v_bad || format('the first call handed out %s, not the two oldest probe rows', v_first);
    END IF;
    IF v_second IS DISTINCT FROM ARRAY['cs_selfcheck_130000_c', 'cs_selfcheck_130000_d'] THEN
      v_bad := v_bad || format('the second call in the same transaction handed out %s, not the two rows the first left', v_second);
    END IF;
    IF v_first && v_second THEN
      v_bad := v_bad || format('two calls handed out the same row: %s and %s', v_first, v_second);
    END IF;

    SELECT count(*) INTO v_held
      FROM public.product_deliveries pd
     WHERE pd.stripe_session_id LIKE 'cs_selfcheck_130000_%'
       AND pd.next_retry_at >= now() + interval '19 minutes'
       AND pd.next_retry_at <= now() + interval '21 minutes';
    IF v_held <> 4 THEN
      v_bad := v_bad || format('%s of the 4 rows handed out carry the twenty-minute claim', v_held);
    END IF;

    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_bad := v_bad || ('the probe could not run: ' || SQLERRM);
    END IF;
  END;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'claimed-delivery selector self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'self-verify 20261121130000: a delivery is claimed by the run that reads it; two calls hand out disjoint rows';
END
$verify$;
