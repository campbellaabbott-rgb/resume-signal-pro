-- AN AFFILIATE BUYING UNDER AN ALIAS OF THEIR OWN ADDRESS EARNS NOTHING
-- (audit 2026-10-31, S13-063).
--
-- WHAT WAS WRONG. 20261011211000 records a commission of 0 when the buyer's
-- address is the affiliate's own, compared as lower(btrim(address)). An
-- affiliate registered as jane@gmail.com who buys Pro with their own code as
-- jane+pro@gmail.com, or as j.a.n.e@gmail.com, or the other way round, reads
-- as a stranger and earns the $10: Gmail delivers all three to one mailbox.
--
-- WHAT THIS CHANGES. One function, public.affiliate_address_key(text), says
-- which mailbox an address reaches: lower-cased and trimmed; the local part
-- cut at its first '+' (sub-addressing, which Gmail, Outlook, iCloud,
-- Fastmail and Proton deliver to the same mailbox); googlemail.com read as
-- gmail.com, and the dots of a Gmail local part dropped (Gmail ignores them;
-- no other provider's dots are touched). record_affiliate_conversion (the
-- same single signature, still service_role only, everything else carried
-- forward from 20261011211000 verbatim) compares the buyer's key with the
-- affiliate's. Two addresses equal before are equal after, so nothing main
-- recorded at 0 is paid now.
--
-- Depends on: record_affiliate_conversion's single overload (20261011211000),
-- affiliates, affiliate_conversions, checkout_buyers, product_deliveries.
-- Safe to re-run. Verify: src/test/an-affiliate-buying-under-an-alias-of-their-own-address-earns-nothing.test.ts
-- runs this file twice in pglite from Supabase's default grants; the DO block
-- below checks the catalogue and the alias rule inside a rolled-back block.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.affiliate_address_key(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH a AS (
    SELECT lower(btrim(p_email)) AS e
  ), parts AS (
    SELECT e,
           substring(e FROM '^(.*)@[^@]*$') AS local_part,
           substring(e FROM '@([^@]*)$') AS domain_part
      FROM a
  ), mailbox AS (
    SELECT e,
           CASE WHEN domain_part = 'googlemail.com' THEN 'gmail.com' ELSE domain_part END AS d,
           coalesce(nullif(split_part(local_part, '+', 1), ''), local_part) AS l
      FROM parts
  )
  SELECT CASE
           WHEN e IS NULL OR e = '' THEN NULL
           WHEN d IS NULL OR l IS NULL OR l = '' THEN e
           WHEN d = 'gmail.com' THEN coalesce(nullif(replace(l, '.', ''), ''), l) || '@' || d
           ELSE l || '@' || d
         END
    FROM mailbox;
$$;

REVOKE ALL ON FUNCTION public.affiliate_address_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_address_key(text) TO service_role;

COMMENT ON FUNCTION public.affiliate_address_key(text) IS
  'The mailbox an address reaches, for telling an affiliate''s own purchase: lower-cased and trimmed, the local part cut '
  'at its first +, googlemail.com read as gmail.com and a Gmail local part''s dots dropped. 20261103100000. service_role only.';

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
       AND d.stripe_session_id <> p_stripe_session_id
       AND d.created_at < coalesce(v_at, now())
       AND ((v_email IS NOT NULL AND lower(btrim(coalesce(d.customer_email, ''))) = v_email)
            OR (v_user IS NOT NULL AND d.stripe_session_id IN (SELECT b.stripe_session_id FROM checkout_buyers b WHERE b.user_id = v_user)))
  ) THEN
    v_commission := 0;
  END IF;

  -- Never for the affiliate's own purchase, under any alias of their mailbox.
  IF v_commission > 0 AND v_email IS NOT NULL
     AND public.affiliate_address_key(v_email) = public.affiliate_address_key(v_affiliate_email) THEN
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
  'buyer whose address reaches the affiliate''s own mailbox (affiliate_address_key: + tags, Gmail dots) earns 0 '
  '(20261011211000, 20261103100000). service_role only.';

-- Self-verifying: one overload of each, closed to the client roles, the
-- definer with a fixed search_path; the key reads the mailbox; and, on the
-- live tables inside a rolled-back block, an alias of the affiliate's own
-- address records 0 while a stranger still earns.
DO $$
DECLARE
  n integer;
  f text := 'public.record_affiliate_conversion(text,text,integer,text,integer)';
  k text := 'public.affiliate_address_key(text)';
  v_def boolean;
  v_cfg text[];
  v_aff uuid;
  v_paid integer;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'record_affiliate_conversion';
  IF n <> 1 THEN RAISE EXCEPTION 'record_affiliate_conversion must be exactly one function, found %', n; END IF;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'affiliate_address_key';
  IF n <> 1 THEN RAISE EXCEPTION 'affiliate_address_key must be exactly one function, found %', n; END IF;
  SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg FROM pg_proc p WHERE p.oid = f::regprocedure;
  IF NOT coalesce(v_def, false) OR v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION '% is not a definer with a fixed search_path', f;
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR has_function_privilege('anon', k, 'EXECUTE') OR has_function_privilege('authenticated', k, 'EXECUTE') THEN
    RAISE EXCEPTION 'record_affiliate_conversion or affiliate_address_key is executable by a client role';
  END IF;
  IF public.affiliate_address_key(' Jane.Doe+Pro@GoogleMail.com ') IS DISTINCT FROM 'janedoe@gmail.com'
     OR public.affiliate_address_key('jane.doe+pro@example.com') IS DISTINCT FROM 'jane.doe@example.com'
     OR public.affiliate_address_key('jane@example.com') IS DISTINCT FROM 'jane@example.com'
     OR public.affiliate_address_key(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'affiliate_address_key does not read the mailbox an address reaches';
  END IF;

  BEGIN
    BEGIN
      INSERT INTO public.affiliates (email, password_hash, referral_code)
      VALUES ('alias.selfcheck@gmail.com', 'x', 'selfcheck-alias-1') RETURNING id INTO v_aff;
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, created_at)
      VALUES ('cs_test_selfcheck_alias_self', 'pro_subscription', 'AliasSelfcheck+pro@googlemail.com', 'delivered', now()),
             ('cs_test_selfcheck_alias_new', 'pro_subscription', 'stranger-selfcheck@example.invalid', 'delivered', now());
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'record_affiliate_conversion: the probe rows could not be written (%); the behaviour probe is skipped', SQLERRM;
      RETURN;
    END;
    PERFORM public.record_affiliate_conversion('selfcheck-alias-1', 'cs_test_selfcheck_alias_self', 4500, 'Pro', 1000);
    PERFORM public.record_affiliate_conversion('selfcheck-alias-1', 'cs_test_selfcheck_alias_new', 4500, 'Pro', 1000);
    IF (SELECT commission_amount FROM public.affiliate_conversions WHERE stripe_session_id = 'cs_test_selfcheck_alias_self') IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'an alias of the affiliate''s own address earned a commission';
    END IF;
    SELECT pending_payout INTO v_paid FROM public.affiliates WHERE id = v_aff;
    IF v_paid IS DISTINCT FROM 1000 THEN RAISE EXCEPTION 'the pending payout is % after one earning sale, want 1000', v_paid; END IF;
    RAISE EXCEPTION 'affiliate-alias-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'affiliate-alias-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;
