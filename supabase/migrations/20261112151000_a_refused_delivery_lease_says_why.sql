-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- A REFUSED DELIVERY LEASE SAYS WHY (S14X-111, M-S14-083).
--
-- WHAT WAS WRONG. take_delivery_lease (20261011144000) answers NULL for five
-- different refusals: the order was delivered, refunded or mailed (closed for
-- good), its status moved since the maker read it, or another maker holds a
-- live lease. verify-product-purchase reads every NULL as "another maker is
-- on it" and answers inProgress, so a buyer whose order was closed with no
-- saved copy was told it was still being made and that a mail was coming,
-- for five minutes of asking, and then the same again on every visit.
--
-- THE RULE NOW. take_delivery_lease_status takes the same row lock and the
-- same lease under the same rules, and says why it refused: closed_refunded,
-- closed_delivered, closed_mailed, moved or leased (token NULL), or hands
-- back the token (refusal NULL). take_delivery_lease is left exactly as it
-- is, for its other callers and for a verify-product-purchase build older
-- than this one; the new build falls back to it while this function is
-- absent (PGRST202), so the function may land before this file.
--
-- Service role only, like the lease it mirrors. Safe to re-run.
--
-- Apply BEFORE verify-product-purchase of the bug round (it falls back
-- without this file, so the order only decides when the closed answer starts).

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.take_delivery_lease_status(
  p_stripe_session_id text,
  p_seen_status text,
  p_minutes integer DEFAULT 10,
  p_product_type text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE(token uuid, refusal text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.product_deliveries%ROWTYPE;
  v_token uuid := gen_random_uuid();
  v_mins  integer := GREATEST(COALESCE(p_minutes, 10), 1);
BEGIN
  IF p_stripe_session_id IS NULL OR p_stripe_session_id = '' THEN
    RETURN QUERY SELECT NULL::uuid, 'moved'::text;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.product_deliveries
   WHERE stripe_session_id = p_stripe_session_id
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.product_deliveries (stripe_session_id, status, product_type, customer_email,
                                           content_generation_started_at, lease_token, lease_until)
    VALUES (p_stripe_session_id, 'generating', COALESCE(NULLIF(p_product_type, ''), 'unknown'), NULLIF(p_email, ''),
            now(), v_token, now() + make_interval(mins => v_mins));
    RETURN QUERY SELECT v_token, NULL::text;
    RETURN;
  END IF;

  -- Closed for good, refunded first: a refund outranks a delivery.
  IF v_row.status = 'refunded' THEN
    RETURN QUERY SELECT NULL::uuid, 'closed_refunded'::text;
    RETURN;
  END IF;
  IF v_row.status = 'delivered' THEN
    RETURN QUERY SELECT NULL::uuid, 'closed_delivered'::text;
    RETURN;
  END IF;
  IF v_row.email_sent_at IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'closed_mailed'::text;
    RETURN;
  END IF;
  -- The order moved since the maker read it: somebody else is on it.
  IF v_row.status IS DISTINCT FROM p_seen_status THEN
    RETURN QUERY SELECT NULL::uuid, 'moved'::text;
    RETURN;
  END IF;
  -- A live lease belongs to another maker.
  IF v_row.lease_until IS NOT NULL AND v_row.lease_until > now() THEN
    RETURN QUERY SELECT NULL::uuid, 'leased'::text;
    RETURN;
  END IF;

  UPDATE public.product_deliveries
     SET status = 'generating',
         content_generation_started_at = now(),
         lease_token = v_token,
         lease_until = now() + make_interval(mins => v_mins)
   WHERE id = v_row.id;
  RETURN QUERY SELECT v_token, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.take_delivery_lease_status(text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_delivery_lease_status(text, text, integer, text, text) TO service_role;

COMMENT ON FUNCTION public.take_delivery_lease_status(text, text, integer, text, text) IS
  'take_delivery_lease that says why it refused: (token, NULL) when the lease is taken, else (NULL, one of '
  'closed_refunded, closed_delivered, closed_mailed, moved, leased). service_role only. 20261112151000.';

-- Self-verifying: the function exists with its five arguments, no client role
-- may run it, and each state answers its own refusal or a token. The probe
-- rows are rolled back.
DO $verify$
DECLARE
  v_bad      text[] := ARRAY[]::text[];
  v_tok      uuid;
  v_why      text;
  v_sentinel constant text := 'lease-status probe: rolled back';
  v_case     record;
BEGIN
  IF to_regprocedure('public.take_delivery_lease_status(text,text,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'take_delivery_lease_status(text,text,integer,text,text) is missing';
  END IF;
  IF has_function_privilege('anon', 'public.take_delivery_lease_status(text,text,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.take_delivery_lease_status(text,text,integer,text,text)', 'EXECUTE') THEN
    v_bad := v_bad || 'a client role may run take_delivery_lease_status'::text;
  END IF;
  IF NOT has_function_privilege('service_role', 'public.take_delivery_lease_status(text,text,integer,text,text)', 'EXECUTE') THEN
    v_bad := v_bad || 'service_role may not run take_delivery_lease_status'::text;
  END IF;

  BEGIN
    FOR v_case IN
      SELECT * FROM (VALUES
        ('cs_selfcheck_151000_refunded',  'refunded',          NULL::timestamptz, NULL::timestamptz, 'refunded',          'closed_refunded'),
        ('cs_selfcheck_151000_delivered', 'delivered',         NULL,              NULL,              'delivered',         'closed_delivered'),
        ('cs_selfcheck_151000_mailed',    'content_generated', now(),             NULL,              'content_generated', 'closed_mailed'),
        ('cs_selfcheck_151000_moved',     'generation_failed', NULL,              NULL,              'payment_received',  'moved'),
        ('cs_selfcheck_151000_leased',    'generating',        NULL,              now() + interval '5 minutes', 'generating', 'leased'),
        ('cs_selfcheck_151000_open',      'payment_received',  NULL,              NULL,              'payment_received',  NULL)
      ) AS c(sid, status, mailed, lease_until, seen, want)
    LOOP
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, email_sent_at, lease_until)
        VALUES (v_case.sid, 'cover_letter', v_case.status, v_case.mailed, v_case.lease_until);
      SELECT s.token, s.refusal INTO v_tok, v_why FROM public.take_delivery_lease_status(v_case.sid, v_case.seen) s;
      IF v_why IS DISTINCT FROM v_case.want THEN
        v_bad := v_bad || format('%s answered refusal %s, not %s', v_case.status, coalesce(v_why, 'none'), coalesce(v_case.want, 'none'));
      END IF;
      IF (v_case.want IS NULL) <> (v_tok IS NOT NULL) THEN
        v_bad := v_bad || format('%s answered token %s with refusal %s', v_case.status, coalesce(v_tok::text, 'none'), coalesce(v_why, 'none'));
      END IF;
    END LOOP;
    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_bad := v_bad || ('the probe could not run: ' || SQLERRM);
    END IF;
  END;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'take_delivery_lease_status self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'self-verify 20261112151000: a refused lease says closed_refunded, closed_delivered, closed_mailed, moved or leased';
END
$verify$;
