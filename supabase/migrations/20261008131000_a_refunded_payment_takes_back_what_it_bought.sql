-- A REFUNDED PAYMENT TAKES BACK WHAT IT BOUGHT.
--
-- WHAT WAS WRONG (platform sweep 2026-10-04, L6-18). Stripe refunds and
-- disputes changed nothing: a refunded $29 pass kept its clock and its
-- applications, a refunded scan pack's credits stayed spendable, a refunded
-- product could be regenerated from its session id for as long as the claim
-- lived, and a refunded subscription kept every grant it had minted. Wave 1
-- made the webhook mail the owner and left every entitlement in place;
-- agent_passes allowed close_reason 'refunded' and nothing ever wrote it.
--
-- OWNER DECISION 2026-10-04: refunds and disputes REVOKE. stripe-webhook
-- (charge.refunded in full, charge.dispute.created) resolves the payment to
-- what it bought and calls payment_revoke ONCE per payment intent:
--
--   - the receipt: payment_revocations, keyed by the payment intent, so a
--     redelivered event (or a dispute after a refund) changes nothing twice;
--   - a one-time product's Checkout session: its claim in
--     used_stripe_sessions is rewritten to the product 'refunded' (written
--     if it did not exist), so no paid generator accepts the session again
--     (assertPaidSession compares the claim's product with the ones it
--     sells) and no verifier can claim it as a first use; its delivery row
--     leaves the retry sweeper's selection (status 'refunded');
--   - an Agent Pass: closed with close_reason 'refunded', after every queued
--     or prepared application it paid for and never sent is stopped (queue
--     rows dismissed, packets failed with the reason) -- the money is back,
--     so nothing more goes out on it;
--   - a scan-credit purchase: the credits it bought that are still unspent
--     leave the address's pool (never below zero), the pool's purchased total
--     drops by what was bought (so a later refund of a reserved credit cannot
--     lift it back), and the purchase's own grant row is spent out;
--   - a subscription payment: every Pro grant the account minted since that
--     payment is revoked (pro_grants.revoked_at; every redeemer refuses it),
--     a spent one's claim rewritten to 'refunded' as above, and the scan
--     credits a spent scan-pack grant added leave the pool the same way.
--     The webhook cancels the subscription itself, immediately, in Stripe.
--
-- A partial refund changes nothing here: it is a goodwill amount the owner
-- chose, and the webhook only tells the owner about it.
--
-- service_role only. The owner must subscribe the webhook endpoint to
-- charge.refunded and charge.dispute.created in the Stripe dashboard.

CREATE TABLE IF NOT EXISTS public.payment_revocations (
  payment_intent_id text PRIMARY KEY CHECK (btrim(payment_intent_id) <> ''),
  reason text NOT NULL CHECK (reason IN ('refunded', 'disputed')),
  stripe_event_id text,
  stripe_session_id text,
  product_type text,
  email text,
  user_id uuid,
  subscription_id text,
  paid_at timestamptz,
  claim_revoked boolean NOT NULL DEFAULT false,
  pass_closed boolean NOT NULL DEFAULT false,
  applications_stopped integer NOT NULL DEFAULT 0,
  credits_clawed integer NOT NULL DEFAULT 0,
  grants_revoked integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_revocations_session_idx
  ON public.payment_revocations (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
ALTER TABLE public.payment_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_revocations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payment_revocations TO service_role;
COMMENT ON TABLE public.payment_revocations IS
  'One row per refunded (in full) or disputed payment intent: what payment_revoke took back. Read by verify-product-purchase and analyze-resume, which refuse a session named here. service_role only.';

-- Takes the given number of unspent credits out of an address's pool; never
-- below zero. Answers how many it took. Internal to payment_revoke.
CREATE OR REPLACE FUNCTION public.payment_revoke_credits(p_email text, p_credits integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_left integer;
  v_take integer;
BEGIN
  IF position('@' in v_email) < 2 OR coalesce(p_credits, 0) <= 0 THEN RETURN 0; END IF;
  SELECT c.credits_remaining INTO v_left FROM public.user_scan_credits c WHERE c.email = v_email FOR UPDATE;
  IF v_left IS NULL THEN RETURN 0; END IF;
  v_take := least(p_credits, greatest(v_left, 0));
  UPDATE public.user_scan_credits c
     SET credits_remaining = c.credits_remaining - v_take,
         total_credits_purchased = greatest(c.total_credits_purchased - p_credits, c.credits_remaining - v_take, 0),
         updated_at = now()
   WHERE c.email = v_email;
  RETURN v_take;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_revoke_credits(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_revoke_credits(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.payment_revoke(
  p_payment_intent_id text,
  p_reason text,
  p_stripe_event_id text DEFAULT NULL,
  p_stripe_session_id text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_credits integer DEFAULT 0,
  p_subscription_id text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pi text := btrim(coalesce(p_payment_intent_id, ''));
  v_session text := nullif(btrim(coalesce(p_stripe_session_id, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_n integer;
  v_pass uuid;
  v_claim boolean := false;
  v_pass_closed boolean := false;
  v_stopped integer := 0;
  v_credits integer := 0;
  v_bought integer;
  v_grants integer := 0;
  g record;
  v_receipt jsonb;
BEGIN
  IF v_pi = '' OR p_reason IS NULL OR p_reason NOT IN ('refunded', 'disputed') THEN
    RAISE EXCEPTION 'payment_revoke: a payment intent and a reason (refunded or disputed) are required';
  END IF;

  INSERT INTO public.payment_revocations
    (payment_intent_id, reason, stripe_event_id, stripe_session_id, product_type, email, user_id, subscription_id, paid_at)
  VALUES
    (v_pi, p_reason, p_stripe_event_id, v_session, p_product_type, v_email, p_user_id, p_subscription_id, p_paid_at)
  ON CONFLICT (payment_intent_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    -- Already taken back: the receipt is the answer, nothing runs twice.
    SELECT to_jsonb(r) || jsonb_build_object('duplicate', true) INTO v_receipt
      FROM public.payment_revocations r WHERE r.payment_intent_id = v_pi;
    RETURN v_receipt;
  END IF;

  -- 1. The session's claim: no generator accepts it, no verifier claims it.
  IF v_session IS NOT NULL THEN
    INSERT INTO public.used_stripe_sessions (session_id, product_type)
    VALUES (v_session, 'refunded')
    ON CONFLICT (session_id) DO UPDATE SET product_type = 'refunded';
    v_claim := true;
    UPDATE public.product_deliveries d
       SET status = 'refunded', next_retry_at = 'infinity'::timestamptz
     WHERE d.stripe_session_id = v_session AND d.status IS DISTINCT FROM 'refunded';
  END IF;

  -- 2. An Agent Pass this payment bought: nothing more goes out on it.
  SELECT ap.id INTO v_pass
    FROM public.agent_passes ap
   WHERE ap.stripe_payment_intent_id = v_pi
      OR (v_session IS NOT NULL AND ap.stripe_session_id = v_session)
   ORDER BY ap.purchased_at DESC
   LIMIT 1
   FOR UPDATE;
  IF v_pass IS NOT NULL THEN
    UPDATE public.agent_submissions s
       SET status = 'failed', error = 'pass refunded: not sent', claimable_at = NULL
     WHERE s.pass_id = v_pass
       AND s.status IN ('preparing', 'ready', 'blocked')
       AND s.submitted_at IS NULL;
    GET DIAGNOSTICS v_stopped = ROW_COUNT;
    UPDATE public.agent_queue q
       SET status = 'dismissed', decided_at = now()
     WHERE q.pass_id = v_pass
       AND q.status IN ('ready', 'approved')
       AND NOT EXISTS (
         SELECT 1 FROM public.agent_submissions s
          WHERE s.user_id = q.user_id AND s.posting_id = q.posting_id AND s.status = 'submitted'
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_stopped := v_stopped + v_n;
    UPDATE public.agent_passes ap
       SET closed_at = coalesce(ap.closed_at, now()), close_reason = 'refunded'
     WHERE ap.id = v_pass;
    v_pass_closed := true;
  END IF;

  -- 3. A scan-credit purchase: what it bought and is still unspent leaves
  --    the pool. The delivery row's record of what was bought wins over the
  --    caller's reading of the session.
  IF v_session IS NOT NULL AND p_product_type IN ('scan_pack', 'scan_credits', 'career_bundle') THEN
    SELECT nullif(d.metadata->>'credits', '')::integer INTO v_bought
      FROM public.product_deliveries d
     WHERE d.stripe_session_id = v_session
     ORDER BY d.created_at
     LIMIT 1;
    v_bought := coalesce(v_bought, nullif(p_credits, 0));
    IF coalesce(v_bought, 0) > 0 AND v_email IS NOT NULL THEN
      v_credits := v_credits + public.payment_revoke_credits(v_email, v_bought);
    END IF;
    UPDATE public.scan_credit_session_grants sg
       SET credits_used = sg.credits_bought, updated_at = now()
     WHERE sg.session_hash = encode(sha256(convert_to(v_session, 'UTF8')), 'hex');
  END IF;

  -- 4. A subscription payment: every Pro grant the account minted since it.
  IF p_subscription_id IS NOT NULL OR p_product_type IN ('pro_subscription', 'apply_agent') THEN
    FOR g IN
      UPDATE public.pro_grants pg
         SET revoked_at = now()
       WHERE pg.revoked_at IS NULL
         AND pg.created_at >= coalesce(p_paid_at, now() - interval '31 days')
         AND ((p_user_id IS NOT NULL AND pg.user_id = p_user_id)
              OR (v_email IS NOT NULL AND lower(btrim(pg.email)) = v_email))
      RETURNING pg.id, pg.email, pg.product_type, pg.credits, pg.consumed_at
    LOOP
      v_grants := v_grants + 1;
      IF g.consumed_at IS NOT NULL THEN
        UPDATE public.used_stripe_sessions u SET product_type = 'refunded' WHERE u.session_id = 'pro_' || g.id::text;
        IF g.product_type IN ('scan_pack', 'scan_credits', 'career_bundle') AND coalesce(g.credits, 0) > 0 THEN
          v_credits := v_credits + public.payment_revoke_credits(g.email, g.credits);
        END IF;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.payment_revocations r
     SET claim_revoked = v_claim, pass_closed = v_pass_closed, applications_stopped = v_stopped,
         credits_clawed = v_credits, grants_revoked = v_grants
   WHERE r.payment_intent_id = v_pi;
  SELECT to_jsonb(r) || jsonb_build_object('duplicate', false) INTO v_receipt
    FROM public.payment_revocations r WHERE r.payment_intent_id = v_pi;
  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_revoke(text, text, text, text, text, text, uuid, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_revoke(text, text, text, text, text, text, uuid, integer, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.payment_revoke(text, text, text, text, text, text, uuid, integer, text, timestamptz) IS
  'Takes back what a refunded (in full) or disputed payment bought, once per payment intent: the session claim, an Agent Pass and its unsent applications, unspent scan credits, the Pro grants a subscription payment minted. Called by stripe-webhook. service_role only.';

-- ── self-check: the catalogue ───────────────────────────────────────────────
DO $$
DECLARE
  v_fn oid;
BEGIN
  IF to_regclass('public.payment_revocations') IS NULL THEN
    RAISE EXCEPTION 'self-check: payment_revocations is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_revocations'::regclass) THEN
    RAISE EXCEPTION 'self-check: payment_revocations has row level security off';
  END IF;
  IF has_table_privilege('anon', 'public.payment_revocations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_revocations', 'SELECT') THEN
    RAISE EXCEPTION 'self-check: a client role can read payment_revocations';
  END IF;
  FOR v_fn IN SELECT unnest(ARRAY[
    to_regprocedure('public.payment_revoke(text,text,text,text,text,text,uuid,integer,text,timestamptz)'),
    to_regprocedure('public.payment_revoke_credits(text,integer)')
  ]) LOOP
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'self-check: payment_revoke or payment_revoke_credits is missing';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
      RAISE EXCEPTION 'self-check: % is not SECURITY DEFINER', v_fn::regprocedure;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', v_fn::regprocedure;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: service_role cannot execute %', v_fn::regprocedure;
    END IF;
  END LOOP;
END $$;

-- ── self-check, exercised ───────────────────────────────────────────────────
-- A scan-pack refund on a probe address, run twice, inside a block that
-- always ends by raising RB000, so nothing it writes survives.
DO $$
DECLARE
  v_probe constant text := 'migration-check+refund@example.invalid';
  v_session constant text := 'cs_self_check_refund_' || replace(gen_random_uuid()::text, '-', '');
  v_pi constant text := 'pi_self_check_' || replace(gen_random_uuid()::text, '-', '');
  r jsonb;
  v_left integer;
BEGIN
  BEGIN
    INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased)
    VALUES (v_probe, 4, 10)
    ON CONFLICT (email) DO UPDATE SET credits_remaining = 4, total_credits_purchased = 10;
    INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES (v_session, 'scan_pack')
    ON CONFLICT (session_id) DO UPDATE SET product_type = 'scan_pack';

    r := public.payment_revoke(v_pi, 'refunded', 'evt_self_check', v_session, 'scan_pack', v_probe, NULL, 10, NULL, now());
    SELECT c.credits_remaining INTO v_left FROM public.user_scan_credits c WHERE c.email = v_probe;
    IF v_left <> 0 OR (r->>'credits_clawed')::integer <> 4 THEN
      RAISE EXCEPTION 'self-check: a refunded 10-credit pack with 4 unspent left % in the pool (clawed %)', v_left, r->>'credits_clawed';
    END IF;
    IF (SELECT u.product_type FROM public.used_stripe_sessions u WHERE u.session_id = v_session) IS DISTINCT FROM 'refunded' THEN
      RAISE EXCEPTION 'self-check: the refunded session''s claim still names what it bought';
    END IF;
    IF (SELECT c.total_credits_purchased FROM public.user_scan_credits c WHERE c.email = v_probe) <> 0 THEN
      RAISE EXCEPTION 'self-check: the refunded purchase still counts toward what the address bought';
    END IF;

    UPDATE public.user_scan_credits SET credits_remaining = 3 WHERE email = v_probe;
    r := public.payment_revoke(v_pi, 'disputed', 'evt_self_check_2', v_session, 'scan_pack', v_probe, NULL, 10, NULL, now());
    IF (r->>'duplicate')::boolean IS DISTINCT FROM true
       OR (SELECT c.credits_remaining FROM public.user_scan_credits c WHERE c.email = v_probe) <> 3 THEN
      RAISE EXCEPTION 'self-check: a second event for one payment took something back again';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
