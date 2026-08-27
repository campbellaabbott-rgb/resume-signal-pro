-- Every affiliate conversion has been failing with PGRST203 since 2025-12-24.
--
-- record_affiliate_conversion exists three times, because three migrations each
-- used CREATE OR REPLACE with a DIFFERENT parameter list — and a different list
-- is a new function, not a replacement:
--
--   20251221233709  (text, text, text, integer)           4 args
--   20251221234209  (text, text, text, integer, integer)  + p_commission_override
--   20251224045355  (text, text, integer, text, integer)  same 5 NAMES, p_sale_amount
--                                                          and p_product_name swapped
--
-- The last two carry the SAME FIVE PARAMETER NAMES. PostgREST resolves a JSON
-- body by name, so a call naming all five matches both and it refuses to guess.
-- Reproduced live 2026-08-27 with the callers' exact body:
--
--   HTTP 300  PGRST203  "Could not choose the best candidate function between:
--   record_affiliate_conversion(p_referral_code => text, p_stripe_session_id =>
--   text, p_product_name => text, p_sale_amount => integer, p_commission_override
--   => integer), record_affiliate_conversion(p_referral_code => text,
--   p_stripe_session_id => text, p_sale_amount => integer, p_product_name =>
--   text, p_commission_override => integer)"
--
-- The four-argument shape is ambiguous too, against the five-arg one whose last
-- parameter has a DEFAULT.
--
-- SO NO AFFILIATE HAS EVER BEEN CREDITED through this path. Both callers —
-- stripe-webhook and verify-product-purchase — log the failure and continue,
-- and stripe-webhook's log line reads "Affiliate conversion recording failed
-- (likely already recorded by verify-product-purchase)". The message explained
-- the error away as a duplicate at the exact moment neither had recorded
-- anything. A swallowed error with a reassuring caption is how a revenue path
-- stays broken for eight months.
--
-- KEEPING THE NEWEST, which computes 20% of the sale — that migration's own
-- title is "use 20% commission", so it is the current policy. The one it
-- superseded fell back to the affiliate's stored commission_amount instead.
-- In practice the rate is moot: both callers always pass p_commission_override,
-- so the fallback only decides what happens if that is ever null.
--
-- DROP, not rename. Renaming the parameters would resolve the ambiguity while
-- leaving two live functions with divergent commission logic, and the next
-- caller would pick one by accident.
--
-- DROPPED FROM THE CATALOG, NOT BY LISTING SIGNATURES, because this database
-- is known to hold functions the migrations do not describe. Probing
-- log_industry_correction on 2026-08-27 with a parameter set that appears in
-- NO migration answered 204, not 404 — so at least one function here was
-- created outside this folder. A migration that drops three named signatures
-- would silently leave a fourth behind and the ambiguity with it. This drops
-- every overload that is not the intended one, whatever is actually there.
DO $$
DECLARE
  keep CONSTANT text :=
    'p_referral_code text, p_stripe_session_id text, p_sale_amount integer, p_product_name text, p_commission_override integer';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'record_affiliate_conversion'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    RAISE NOTICE 'dropping ambiguous overload %', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

-- Self-verifying: exactly one must remain, and it must be the 20% one. A
-- migration whose whole purpose is "there is only one of these now" should not
-- be able to report success while there are still two.
DO $$
DECLARE
  n int;
  sig text;
BEGIN
  SELECT count(*), string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
    INTO n, sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'record_affiliate_conversion';

  IF n <> 1 THEN
    RAISE EXCEPTION
      'record_affiliate_conversion must be exactly one function, found % — every call stays PGRST203: %',
      n, COALESCE(sig, '<none>');
  END IF;

  IF sig NOT LIKE '%p_sale_amount integer, p_product_name text%' THEN
    RAISE EXCEPTION
      'the surviving overload is not the 20%%-commission one (signature: %)', sig;
  END IF;
END $$;

COMMENT ON FUNCTION public.record_affiliate_conversion(text, text, integer, text, integer) IS
  'Records an affiliate conversion and credits commission. THE ONLY overload — '
  'three coexisted until 20260827131500 and two shared all five parameter names, '
  'so PostgREST answered PGRST203 to every call from 2025-12-24 onward and no '
  'affiliate was ever credited. Adding a parameter here creates a NEW function '
  'rather than replacing this one; drop the old signature in the same migration.';
