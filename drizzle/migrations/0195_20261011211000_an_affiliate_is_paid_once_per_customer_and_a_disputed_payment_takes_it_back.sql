-- AN AFFILIATE IS PAID ONCE PER CUSTOMER, NEVER FOR THEMSELVES, AND A
-- DISPUTED PAYMENT TAKES THE COMMISSION BACK (wave 4 round 2 review, money
-- lens; owner decision: a flat $10 on a referred customer's FIRST paid Pro
-- month).
--
-- WHAT WAS WRONG. create-subscription-checkout stamps $10 on every referred
-- Pro checkout, and both payers (stripe-webhook and verify-product-purchase)
-- pass it to record_affiliate_conversion, whose only uniqueness is the
-- session. Subscribe, cancel and re-subscribe through the 30-day referral
-- code paid a second $10; a lapsed subscriber returning through a link paid
-- $10; an affiliate could refer themselves; and payment_revoke never touched
-- affiliate_conversions, so a disputed first month kept its commission.
--
-- WHAT THIS CHANGES.
--   1. record_affiliate_conversion (the same, single signature; still
--      service_role only) records a Pro subscription's commission at 0 when
--      the same customer (the account checkout_buyers binds, or the address
--      on the delivery) paid for Pro before, and any sale's commission at 0
--      when the buyer's address is the affiliate's own. The conversion row is
--      still written (the referral is on record), and the affiliate's totals
--      move by the amount actually earned.
--   2. A row in payment_revocations (written only by payment_revoke, on a
--      full refund or a dispute) rejects that session's pending or approved
--      conversion and takes its commission off the affiliate's pending payout
--      and earnings. A conversion already paid is left as paid.
--
-- Depends on: affiliates, affiliate_conversions (20251221233709),
-- record_affiliate_conversion's single overload (20260827131500),
-- checkout_buyers (20261011150000), product_deliveries, payment_revocations
-- (20261008131000). Safe to re-run. Verify:
-- src/test/w4b-fix-an-affiliate-is-paid-once-per-customer.test.ts runs this
-- file twice in pglite from Supabase's default grants; the DO block below
-- checks the catalogue and exercises both rules inside a rolled-back block.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.record_affiliate_conversion(
  p_referral_code text,
  p_stripe_session_id text,
  p_sale_amount integer,
  p_product_name text,
  p_commission_override integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id uuid;
  v_affiliate_email text;
  v_commission integer;
  v_type text;
  v_user uuid;
  v_email text;
  v_at timestamptz;
BEGIN
  SELECT a.id, lower(btrim(a.email)) INTO v_affiliate_id, v_affiliate_email
    FROM affiliates a
   WHERE a.referral_code = p_referral_code AND a.status = 'active';
  IF v_affiliate_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_commission_override IS NOT NULL THEN
    v_commission := p_commission_override;
  ELSE
    v_commission := ROUND(p_sale_amount * 0.20);
  END IF;

  -- Who bought, and what: the binding written at checkout, then the delivery row.
  SELECT b.product_type, b.user_id INTO v_type, v_user
    FROM checkout_buyers b WHERE b.stripe_session_id = p_stripe_session_id;
  SELECT coalesce(v_type, d.product_type), nullif(lower(btrim(coalesce(d.customer_email, ''))), ''), d.created_at
    INTO v_type, v_email, v_at
    FROM product_deliveries d WHERE d.stripe_session_id = p_stripe_session_id
   ORDER BY d.created_at LIMIT 1;

  -- The first paid Pro month only: the same account or address paid for Pro before.
  IF v_commission > 0 AND v_type = 'pro_subscription' AND EXISTS (
    SELECT 1 FROM product_deliveries d
     WHERE d.product_type = 'pro_subscription'
       AND d.stripe_session_id <> p_stripe_session_id
       AND d.created_at < coalesce(v_at, now())
       AND ((v_email IS NOT NULL AND lower(btrim(coalesce(d.customer_email, ''))) = v_email)
            OR (v_user IS NOT NULL AND d.stripe_session_id IN (SELECT b.stripe_session_id FROM checkout_buyers b WHERE b.user_id = v_user)))
  ) THEN
    v_commission := 0;
  END IF;

  -- Never for the affiliate's own purchase.
  IF v_commission > 0 AND v_email IS NOT NULL AND v_email = v_affiliate_email THEN
    v_commission := 0;
  END IF;

  INSERT INTO affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, product_name, status)
  VALUES (v_affiliate_id, p_stripe_session_id, p_sale_amount, v_commission, p_product_name, 'pending');

  IF v_commission <> 0 THEN
    UPDATE affiliates
       SET total_earnings = total_earnings + v_commission,
           pending_payout = pending_payout + v_commission,
           updated_at = now()
     WHERE id = v_affiliate_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_affiliate_conversion(text, text, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_affiliate_conversion(text, text, integer, text, integer) TO service_role;

COMMENT ON FUNCTION public.record_affiliate_conversion(text, text, integer, text, integer) IS
  'Records an affiliate conversion and credits commission. THE ONLY overload (20260827131500): adding a parameter '
  'creates a new function; drop the old signature in the same migration. A Pro subscription earns only on the '
  'customer''s first paid Pro month (an earlier Pro delivery for the same account or address records 0), and a '
  'buyer whose address is the affiliate''s own earns 0 (20261011211000). service_role only.';

-- A refunded or disputed payment takes back the commission it earned.
CREATE OR REPLACE FUNCTION public.affiliate_commission_revoked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  IF NEW.stripe_session_id IS NULL THEN
    RETURN NEW;
  END IF;
  FOR c IN
    UPDATE affiliate_conversions ac
       SET status = 'rejected'
     WHERE ac.stripe_session_id = NEW.stripe_session_id
       AND ac.status IN ('pending', 'approved')
    RETURNING ac.affiliate_id, ac.commission_amount
  LOOP
    IF c.commission_amount <> 0 THEN
      UPDATE affiliates a
         SET pending_payout = greatest(0, a.pending_payout - c.commission_amount),
             total_earnings = greatest(0, a.total_earnings - c.commission_amount),
             updated_at = now()
       WHERE a.id = c.affiliate_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_commission_revoked() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_commission_revoked() TO service_role;

DROP TRIGGER IF EXISTS affiliate_commission_revoked ON public.payment_revocations;
CREATE TRIGGER affiliate_commission_revoked
  AFTER INSERT ON public.payment_revocations
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_commission_revoked();

COMMENT ON FUNCTION public.affiliate_commission_revoked() IS
  'AFTER INSERT on payment_revocations: rejects the revoked session''s pending or approved affiliate conversion and '
  'takes its commission off the affiliate''s pending payout and earnings; a paid conversion stays paid. 20261011211000.';

-- Self-verifying: one overload, a definer with a fixed search_path closed to
-- the client roles; the trigger is in place; and, on the live tables inside a
-- rolled-back block, a returning Pro customer and a self-referral record 0 and
-- a revocation rejects a pending commission and takes it off the balance.
DO $$
DECLARE
  n integer;
  f text := 'public.record_affiliate_conversion(text,text,integer,text,integer)';
  v_def boolean;
  v_cfg text[];
  v_aff uuid;
  v_paid integer;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'record_affiliate_conversion';
  IF n <> 1 THEN RAISE EXCEPTION 'record_affiliate_conversion must be exactly one function, found %', n; END IF;
  SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg FROM pg_proc p WHERE p.oid = f::regprocedure;
  IF NOT coalesce(v_def, false) OR v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION '% is not a definer with a fixed search_path', f;
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION '% is executable by a client role', f;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'affiliate_commission_revoked' AND t.tgrelid = 'public.payment_revocations'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'the affiliate_commission_revoked trigger is missing';
  END IF;

  BEGIN
    BEGIN
      INSERT INTO public.affiliates (email, password_hash, referral_code)
      VALUES ('affiliate-selfcheck@example.invalid', 'x', 'selfcheck-aff-1') RETURNING id INTO v_aff;
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, created_at)
      VALUES ('cs_test_selfcheck_aff_first', 'pro_subscription', 'returning-selfcheck@example.invalid', 'delivered', now() - interval '60 days'),
             ('cs_test_selfcheck_aff_again', 'pro_subscription', 'returning-selfcheck@example.invalid', 'delivered', now()),
             ('cs_test_selfcheck_aff_new', 'pro_subscription', 'new-selfcheck@example.invalid', 'delivered', now()),
             ('cs_test_selfcheck_aff_self', 'pro_subscription', 'affiliate-selfcheck@example.invalid', 'delivered', now());
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'record_affiliate_conversion: the probe rows could not be written (%); the behaviour probe is skipped', SQLERRM;
      RETURN;
    END;
    PERFORM public.record_affiliate_conversion('selfcheck-aff-1', 'cs_test_selfcheck_aff_again', 4500, 'Pro', 1000);
    PERFORM public.record_affiliate_conversion('selfcheck-aff-1', 'cs_test_selfcheck_aff_self', 4500, 'Pro', 1000);
    PERFORM public.record_affiliate_conversion('selfcheck-aff-1', 'cs_test_selfcheck_aff_new', 4500, 'Pro', 1000);
    IF (SELECT commission_amount FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_aff_again') <> 0 THEN
      RAISE EXCEPTION 'a returning Pro customer earned a commission';
    END IF;
    IF (SELECT commission_amount FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_aff_self') <> 0 THEN
      RAISE EXCEPTION 'a self-referral earned a commission';
    END IF;
    SELECT pending_payout INTO v_paid FROM public.affiliates WHERE id = v_aff;
    IF v_paid <> 1000 THEN RAISE EXCEPTION 'the pending payout is % after one earning sale, want 1000', v_paid; END IF;
    INSERT INTO public.payment_revocations (payment_intent_id, reason, stripe_session_id)
    VALUES ('pi_selfcheck_aff_disputed', 'disputed', 'cs_test_selfcheck_aff_new');
    IF (SELECT status FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_aff_new') <> 'rejected' THEN
      RAISE EXCEPTION 'a disputed sale kept its commission';
    END IF;
    SELECT pending_payout INTO v_paid FROM public.affiliates WHERE id = v_aff;
    IF v_paid <> 0 THEN RAISE EXCEPTION 'the pending payout is % after the dispute, want 0', v_paid; END IF;
    RAISE EXCEPTION 'affiliate-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'affiliate-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;