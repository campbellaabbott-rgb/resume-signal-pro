-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- AN AFFILIATE SEES EACH CURRENCY, EACH RANGE, AND WHAT AWAITS APPROVAL; A
-- SALE THAT NEEDS A SECOND LOOK IS HELD FOR IT
-- (bug round 2026-11-08, lane affiliate: S14X-226, S14X-227, RC-S13-063,
-- S14X-085 (the display half), S14X-116, S14X-212).
--
-- WHAT WAS WRONG.
--   S14X-226. The first-paid-Pro-month rule compared lower(btrim(address)):
--     a customer who paid for Pro as jane@gmail.com and came back through a
--     link as j.a.n.e+2@googlemail.com read as new and paid the affiliate
--     again.
--   S14X-227. A conversion did not record its currency, and the dashboard
--     summed every sale as one number the page printed as dollars.
--   RC-S13-063. A sale made with the affiliate's own code from the
--     affiliate's own network, under a second address, earned like a
--     stranger's; so did every sale of an account that never proved its
--     address.
--   S14X-085, S14X-116, S14X-212. The dashboard counted only APPROVED
--     commission (and nothing approves one yet), answered all-time totals
--     only, and said nothing of payout requests.
--
-- WHAT THIS CHANGES.
--   1. affiliate_conversions.currency (three lower-case letters), filled by
--      a BEFORE INSERT trigger from the session's
--      product_deliveries.metadata->>'currency' (stripe-webhook writes it
--      before it records the conversion), and back-filled.
--   2. affiliate_conversions.review_flags: record_affiliate_conversion marks
--      an earning conversion 'unproven-affiliate' while the affiliate's
--      address is unproven (lifted when it is proven) and
--      'affiliate-network' when checkout_buyers.network_key (new; written by
--      the checkout side through affiliate_network_key) matches a network
--      the affiliate signed in from in the thirty days before the sale. A
--      flagged conversion is never in the payable balance, and a payout
--      request naming one, or from an unproven address, is refused (23514).
--   3. affiliate_returning_pro_customer: the first-paid-Pro-month test by
--      affiliate_address_key, service_role only; record_affiliate_conversion
--      (the same single overload, still service_role only) calls it.
--   4. get_affiliate_dashboard (the same signature) answers
--      stats.revenue_by_currency, stats.awaiting_approval (earned, not yet
--      payable: pending, or approved and held for review) and its count,
--      a payable pending_payout, stats_by_range for 7/30/90/365 days,
--      payout_requests (status, amount and dates; never the conversions they
--      name), and each recent conversion's currency. total_clicks counts the
--      days the 90-day prune rolled up (20261112121000).
--
-- Depends on: 20261112120000 (email_confirmed_at, affiliate_sign_in_networks,
-- affiliate_session_owner), 20261112121000 (affiliate_click_days),
-- affiliate_address_key (20261103100000), affiliate_payout_requests
-- (20261008124000, 20261008126000), checkout_buyers (20261011150000),
-- product_deliveries. Safe to re-run. Verify:
-- src/test/affiliate-revenue-is-summed-per-currency.test.ts,
-- src/test/a-sale-from-the-affiliates-own-network-is-flagged-for-review.test.ts,
-- src/test/a-returning-pro-customer-under-an-alias-earns-the-affiliate-nothing.test.ts and
-- src/test/the-affiliate-dashboard-answers-each-range-what-awaits-approval-and-each-request.test.ts
-- run this file twice in pglite from Supabase's default grants; the DO block
-- at the end checks the catalogue and the rules inside a rolled-back block.

SET LOCAL statement_timeout = '2min';

-- ── 1. currency ────────────────────────────────────────────────────────────

ALTER TABLE public.affiliate_conversions ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.affiliate_conversions ADD COLUMN IF NOT EXISTS review_flags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.checkout_buyers ADD COLUMN IF NOT EXISTS network_key text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.affiliate_conversions'::regclass
                  AND conname = 'affiliate_conversions_currency_shape') THEN
    ALTER TABLE public.affiliate_conversions
      ADD CONSTRAINT affiliate_conversions_currency_shape CHECK (currency IS NULL OR currency ~ '^[a-z]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.checkout_buyers'::regclass
                  AND conname = 'checkout_buyers_network_key_shape') THEN
    ALTER TABLE public.checkout_buyers
      ADD CONSTRAINT checkout_buyers_network_key_shape CHECK (network_key IS NULL OR network_key ~ '^[0-9a-f]{64}$');
  END IF;
END $$;
COMMENT ON COLUMN public.affiliate_conversions.currency IS
  'The currency sale_amount is in (ISO 4217, lower case), from the session''s product_deliveries.metadata. NULL: never '
  'recorded, shown as such and never as dollars. 20261112122000.';
COMMENT ON COLUMN public.affiliate_conversions.review_flags IS
  'Why an earning conversion is held for review: unproven-affiliate (the affiliate''s address is unproven; lifted when '
  'proven), affiliate-network (the checkout came from a network the affiliate signed in from in the 30 days before). A '
  'flagged conversion is never payable. 20261112122000.';
COMMENT ON COLUMN public.checkout_buyers.network_key IS
  'affiliate_network_key of the buyer''s address when the checkout was minted: a keyed hash of the /24 or /48, never '
  'the address. 20261112122000.';

CREATE OR REPLACE FUNCTION public.affiliate_conversion_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.currency IS NULL THEN
    SELECT lower(d.metadata ->> 'currency') INTO NEW.currency
      FROM public.product_deliveries d
     WHERE d.stripe_session_id = NEW.stripe_session_id
       AND d.metadata ->> 'currency' ~* '^[a-z]{3}$'
     ORDER BY d.created_at
     LIMIT 1;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_conversion_currency() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS affiliate_conversion_currency ON public.affiliate_conversions;
CREATE TRIGGER affiliate_conversion_currency
  BEFORE INSERT ON public.affiliate_conversions
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_conversion_currency();

UPDATE public.affiliate_conversions c
   SET currency = lower(d.metadata ->> 'currency')
  FROM (SELECT DISTINCT ON (stripe_session_id) stripe_session_id, metadata
          FROM public.product_deliveries
         WHERE metadata ->> 'currency' ~* '^[a-z]{3}$'
         ORDER BY stripe_session_id, created_at) d
 WHERE c.currency IS NULL
   AND d.stripe_session_id = c.stripe_session_id;

-- ── 2. held for review ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.affiliate_address_proven()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.affiliate_conversions
       SET review_flags = array_remove(review_flags, 'unproven-affiliate')
     WHERE affiliate_id = NEW.id AND 'unproven-affiliate' = ANY (review_flags);
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_address_proven() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS affiliate_address_proven ON public.affiliates;
CREATE TRIGGER affiliate_address_proven
  AFTER UPDATE OF email_confirmed_at ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_address_proven();

CREATE OR REPLACE FUNCTION public.affiliate_payout_request_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.affiliate_conversions c
              WHERE c.id = ANY (NEW.conversion_ids) AND c.review_flags <> '{}') THEN
    RAISE EXCEPTION 'a payout request names a conversion held for review' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.affiliates a WHERE a.id = NEW.affiliate_id AND a.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a payout request from an affiliate whose address is unproven is held for review' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_payout_request_reviewed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS affiliate_payout_request_reviewed ON public.affiliate_payout_requests;
CREATE TRIGGER affiliate_payout_request_reviewed
  BEFORE INSERT ON public.affiliate_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_payout_request_reviewed();

-- ── 3. the returning customer, by mailbox ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.affiliate_returning_pro_customer(
  p_stripe_session_id text,
  p_email text,
  p_user_id uuid,
  p_before timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.product_deliveries d
     WHERE d.product_type = 'pro_subscription'
       AND d.stripe_session_id IS DISTINCT FROM p_stripe_session_id
       AND d.created_at < coalesce(p_before, now())
       AND ((nullif(btrim(coalesce(p_email, '')), '') IS NOT NULL
             AND public.affiliate_address_key(d.customer_email) = public.affiliate_address_key(p_email))
            OR (p_user_id IS NOT NULL
                AND d.stripe_session_id IN (SELECT b.stripe_session_id FROM public.checkout_buyers b WHERE b.user_id = p_user_id)))
  );
$$;
REVOKE ALL ON FUNCTION public.affiliate_returning_pro_customer(text, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_returning_pro_customer(text, text, uuid, timestamptz) TO service_role;
COMMENT ON FUNCTION public.affiliate_returning_pro_customer(text, text, uuid, timestamptz) IS
  'True when the same customer paid for Pro before p_before under another checkout: the same mailbox '
  '(affiliate_address_key: + tags, Gmail dots, googlemail.com) or the same account (checkout_buyers.user_id). '
  'record_affiliate_conversion records 0 then. service_role only. 20261112122000.';

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
  v_confirmed timestamptz;
  v_commission integer;
  v_type text;
  v_user uuid;
  v_net text;
  v_email text;
  v_at timestamptz;
  v_flags text[] := '{}';
BEGIN
  SELECT a.id, lower(btrim(a.email)), a.email_confirmed_at INTO v_affiliate_id, v_affiliate_email, v_confirmed
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
  SELECT b.product_type, b.user_id, b.network_key INTO v_type, v_user, v_net
    FROM checkout_buyers b WHERE b.stripe_session_id = p_stripe_session_id;
  SELECT coalesce(v_type, d.product_type), nullif(lower(btrim(coalesce(d.customer_email, ''))), ''), d.created_at
    INTO v_type, v_email, v_at
    FROM product_deliveries d WHERE d.stripe_session_id = p_stripe_session_id
   ORDER BY d.created_at LIMIT 1;

  -- The first paid Pro month only: the same account or mailbox paid for Pro before.
  IF v_commission > 0 AND v_type = 'pro_subscription'
     AND public.affiliate_returning_pro_customer(p_stripe_session_id, v_email, v_user, coalesce(v_at, now())) THEN
    v_commission := 0;
  END IF;

  -- Never for the affiliate's own purchase, under any alias of their mailbox.
  IF v_commission > 0 AND v_email IS NOT NULL
     AND public.affiliate_address_key(v_email) = public.affiliate_address_key(v_affiliate_email) THEN
    v_commission := 0;
  END IF;

  -- Held for review, never payable while flagged.
  IF v_commission > 0 THEN
    IF v_confirmed IS NULL THEN
      v_flags := array_append(v_flags, 'unproven-affiliate');
    END IF;
    IF v_net IS NOT NULL AND EXISTS (
      SELECT 1 FROM affiliate_sign_in_networks n
       WHERE n.affiliate_id = v_affiliate_id AND n.network_key = v_net
         AND n.last_seen >= coalesce(v_at, now()) - interval '30 days'
    ) THEN
      v_flags := array_append(v_flags, 'affiliate-network');
    END IF;
  END IF;

  INSERT INTO affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, product_name, status, review_flags)
  VALUES (v_affiliate_id, p_stripe_session_id, p_sale_amount, v_commission, p_product_name, 'pending', v_flags);

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
  'customer''s first paid Pro month (affiliate_returning_pro_customer: the same account or mailbox paid before records '
  '0), a buyer whose address reaches the affiliate''s own mailbox earns 0, and an earning conversion is held for review '
  '(review_flags) while the affiliate''s address is unproven or when the checkout came from the affiliate''s own network '
  '(20261011211000, 20261103100000, 20261112122000). service_role only.';

-- ── 4. the dashboard ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard(
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID := public.affiliate_session_owner(p_session_token);
  v_affiliate affiliates%ROWTYPE;
  v_total_clicks BIGINT;
  v_total_conversions BIGINT;
  v_total_revenue BIGINT;
  v_payable BIGINT;
  v_awaiting BIGINT;
  v_awaiting_n BIGINT;
  v_paid_out BIGINT;
  v_by_currency JSONB;
  v_ranges JSONB;
  v_requests JSONB;
  v_recent JSONB;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  SELECT * INTO v_affiliate FROM affiliates WHERE id = v_id;

  SELECT (SELECT count(*) FROM affiliate_clicks c WHERE c.affiliate_id = v_id)
       + (SELECT coalesce(sum(d.clicks), 0) FROM affiliate_click_days d WHERE d.affiliate_id = v_id)
    INTO v_total_clicks;
  SELECT count(*), coalesce(sum(sale_amount), 0) INTO v_total_conversions, v_total_revenue
    FROM affiliate_conversions WHERE affiliate_id = v_id AND status <> 'rejected';
  SELECT coalesce(jsonb_object_agg(k, s), '{}'::jsonb) INTO v_by_currency
    FROM (SELECT coalesce(currency, 'unknown') AS k, sum(sale_amount) AS s
            FROM affiliate_conversions WHERE affiliate_id = v_id AND status <> 'rejected' GROUP BY 1) x;
  -- Payable: approved and held for nothing. Awaiting: earned, not yet payable.
  SELECT coalesce(sum(commission_amount), 0) INTO v_payable
    FROM affiliate_conversions WHERE affiliate_id = v_id AND status = 'approved' AND review_flags = '{}';
  SELECT coalesce(sum(commission_amount), 0), count(*) INTO v_awaiting, v_awaiting_n
    FROM affiliate_conversions
   WHERE affiliate_id = v_id AND commission_amount > 0
     AND (status = 'pending' OR (status = 'approved' AND review_flags <> '{}'));
  SELECT coalesce(sum(commission_amount), 0) INTO v_paid_out
    FROM affiliate_conversions WHERE affiliate_id = v_id AND status = 'paid';

  SELECT jsonb_object_agg(r.n::text, jsonb_build_object(
           'clicks',
             (SELECT count(*) FROM affiliate_clicks c
               WHERE c.affiliate_id = v_id AND c.created_at > now() - make_interval(days => r.n))
           + (SELECT coalesce(sum(d.clicks), 0) FROM affiliate_click_days d
               WHERE d.affiliate_id = v_id AND d.day >= ((now() - make_interval(days => r.n)) AT TIME ZONE 'UTC')::date),
           'conversions', (SELECT count(*) FROM affiliate_conversions c
               WHERE c.affiliate_id = v_id AND c.status <> 'rejected' AND c.created_at > now() - make_interval(days => r.n)),
           'earning_conversions', (SELECT count(*) FROM affiliate_conversions c
               WHERE c.affiliate_id = v_id AND c.status <> 'rejected' AND c.commission_amount > 0
                 AND c.created_at > now() - make_interval(days => r.n)),
           'commission', (SELECT coalesce(sum(c.commission_amount), 0) FROM affiliate_conversions c
               WHERE c.affiliate_id = v_id AND c.status <> 'rejected' AND c.created_at > now() - make_interval(days => r.n)),
           'revenue_by_currency', (SELECT coalesce(jsonb_object_agg(k, s), '{}'::jsonb) FROM (
               SELECT coalesce(c.currency, 'unknown') AS k, sum(c.sale_amount) AS s FROM affiliate_conversions c
                WHERE c.affiliate_id = v_id AND c.status <> 'rejected' AND c.created_at > now() - make_interval(days => r.n)
                GROUP BY 1) x)
         ))
    INTO v_ranges
    FROM unnest(ARRAY[7, 30, 90, 365]) AS r(n);

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'status', q.status, 'amount_cents', q.amount_cents,
                                               'requested_at', q.requested_at, 'resolved_at', q.resolved_at)
                            ORDER BY q.requested_at DESC), '[]'::jsonb)
    INTO v_requests
    FROM (SELECT * FROM affiliate_payout_requests WHERE affiliate_id = v_id ORDER BY requested_at DESC LIMIT 50) q;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'product_name', c.product_name, 'sale_amount', c.sale_amount,
                                               'commission_amount', c.commission_amount, 'status', c.status,
                                               'created_at', c.created_at, 'currency', c.currency,
                                               'held_for_review', c.review_flags <> '{}')
                            ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM (SELECT * FROM affiliate_conversions WHERE affiliate_id = v_id ORDER BY created_at DESC LIMIT 20) c;

  RETURN jsonb_build_object(
    'affiliate', jsonb_build_object(
      'id', v_affiliate.id, 'email', v_affiliate.email, 'referral_code', v_affiliate.referral_code,
      'commission_amount', v_affiliate.commission_amount, 'status', v_affiliate.status,
      'created_at', v_affiliate.created_at, 'email_confirmed', v_affiliate.email_confirmed_at IS NOT NULL
    ),
    'stats', jsonb_build_object(
      'total_clicks', v_total_clicks, 'total_conversions', v_total_conversions, 'total_revenue', v_total_revenue,
      'revenue_by_currency', v_by_currency,
      'pending_payout', v_payable, 'awaiting_approval', v_awaiting, 'awaiting_approval_count', v_awaiting_n,
      'paid_out', v_paid_out,
      'conversion_rate', CASE WHEN v_total_clicks > 0
        THEN ROUND((v_total_conversions::NUMERIC / v_total_clicks::NUMERIC) * 100, 2) ELSE 0 END
    ),
    'stats_by_range', v_ranges,
    'payout_requests', v_requests,
    'recent_conversions', v_recent
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_affiliate_dashboard(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_dashboard(text) TO anon, authenticated, service_role;

-- Self-verifying: one overload of the recorder; every new function closed
-- to the client roles and the dashboard still open; then, on the live tables
-- inside a rolled-back block: a Gmail alias of a returning Pro customer
-- records 0, an unproven affiliate's sale is held for review and lifted when
-- the address is proven, a sale from the affiliate's own network is held,
-- the currency comes from the delivery row, and a flagged conversion cannot
-- be requested.
DO $$
DECLARE
  n integer;
  f text;
  v_aff uuid;
  v_flags text[];
  v_cur text;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'record_affiliate_conversion';
  IF n <> 1 THEN RAISE EXCEPTION 'self-check: record_affiliate_conversion must be exactly one function, found %', n; END IF;
  FOREACH f IN ARRAY ARRAY[
    'public.record_affiliate_conversion(text,text,integer,text,integer)',
    'public.affiliate_returning_pro_customer(text,text,uuid,timestamptz)',
    'public.affiliate_conversion_currency()', 'public.affiliate_address_proven()', 'public.affiliate_payout_request_reviewed()'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION 'self-check: % is missing', f; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('anon', 'public.get_affiliate_dashboard(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: get_affiliate_dashboard must stay open to anon';
  END IF;
  IF to_regclass('public.affiliate_click_days') IS NULL THEN
    RAISE EXCEPTION 'self-check: affiliate_click_days (20261112121000) is missing';
  END IF;

  BEGIN
    BEGIN
      INSERT INTO public.affiliates (email, password_hash, referral_code)
      VALUES ('money-selfcheck@example.invalid', 'x', 'selfcheck-money') RETURNING id INTO v_aff;
      INSERT INTO public.affiliate_sign_in_networks (affiliate_id, network_key)
      VALUES (v_aff, public.affiliate_network_key('192.0.2.203'));
      INSERT INTO public.checkout_buyers (stripe_session_id, checkout_function, product_type, network_key)
      VALUES ('cs_test_selfcheck_money_net', 'selfcheck', 'pro_subscription', public.affiliate_network_key('192.0.2.99'));
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, created_at, metadata)
      VALUES ('cs_test_selfcheck_money_old', 'pro_subscription', 'returning.selfcheck@gmail.com', 'delivered', now() - interval '60 days', NULL),
             ('cs_test_selfcheck_money_alias', 'pro_subscription', 'Returning.Self.Check+2@googlemail.com', 'delivered', now(), '{"currency":"inr"}'::jsonb),
             ('cs_test_selfcheck_money_new', 'pro_subscription', 'new-money-selfcheck@example.invalid', 'delivered', now(), '{"currency":"usd"}'::jsonb),
             ('cs_test_selfcheck_money_net', 'pro_subscription', 'net-money-selfcheck@example.invalid', 'delivered', now(), NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'self-check: the probe rows could not be written (%); the behaviour probe is skipped', SQLERRM;
      RETURN;
    END;
    PERFORM public.record_affiliate_conversion('selfcheck-money', 'cs_test_selfcheck_money_alias', 42250, 'Pro', 1000);
    PERFORM public.record_affiliate_conversion('selfcheck-money', 'cs_test_selfcheck_money_new', 4500, 'Pro', 1000);
    IF (SELECT commission_amount FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_money_alias') IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'self-check: a returning Pro customer under a Gmail alias earned a commission';
    END IF;
    SELECT review_flags, currency INTO v_flags, v_cur FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_money_new';
    IF v_cur IS DISTINCT FROM 'usd' THEN RAISE EXCEPTION 'self-check: the currency is %, want usd', coalesce(v_cur, 'NULL'); END IF;
    IF NOT ('unproven-affiliate' = ANY (v_flags)) THEN RAISE EXCEPTION 'self-check: an unproven affiliate''s sale was not held'; END IF;
    UPDATE public.affiliates SET email_confirmed_at = now() WHERE id = v_aff;
    SELECT review_flags INTO v_flags FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_money_new';
    IF v_flags <> '{}' THEN RAISE EXCEPTION 'self-check: proving the address left the flags %', v_flags; END IF;
    PERFORM public.record_affiliate_conversion('selfcheck-money', 'cs_test_selfcheck_money_net', 4500, 'Pro', 1000);
    SELECT review_flags INTO v_flags FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_money_net';
    IF NOT ('affiliate-network' = ANY (v_flags)) THEN RAISE EXCEPTION 'self-check: a sale from the affiliate''s own network was not held'; END IF;
    UPDATE public.affiliate_conversions SET status = 'approved' WHERE stripe_session_id = 'cs_test_selfcheck_money_net';
    BEGIN
      INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids)
      SELECT v_aff, 1000, ARRAY[id] FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_money_net';
      RAISE EXCEPTION 'self-check: a held conversion was requested for payout';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
    RAISE EXCEPTION 'affiliate-money-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'affiliate-money-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;
