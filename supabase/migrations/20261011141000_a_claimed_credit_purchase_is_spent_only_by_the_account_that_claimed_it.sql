-- A CLAIMED CREDIT PURCHASE IS SPENT ONLY BY THE ACCOUNT THAT CLAIMED IT.
--
-- WHAT WAS WRONG (S12-154, a regression of S10-161 / S11-062). A scan-credit
-- purchase is proven by its Stripe Checkout session id, which the success
-- page keeps in the buyer's browser. 20261005120000 lets the first signed-in
-- account that presents it claim it (claimed_by), and from then on that
-- account spends it on any device. But scan_credit_redeem and
-- scan_credit_balance never read claimed_by on the session-id path: on a
-- shared or library computer, the next person to use the browser (signed out,
-- or signed in as somebody else) still presented the stored session id, saw
-- the buyer's balance and address, and spent the buyer's credits.
--
-- THE RULE NOW. A purchase nobody has claimed is spent by whoever holds its
-- session id (the bearer proof, as before). A purchase an account has claimed
-- is spent, and counted in a balance, only for that account: the session id
-- alone no longer reaches it. The scanner passes the caller's verified auth
-- user id (p_user_id); a caller with none passes NULL and is refused every
-- claimed purchase. A deliberate sign-out also clears the stored ids in the
-- browser (R1, AuthContext PERSONAL_LOCAL_KEYS); this is the server half.
--
-- scan_credit_redeem gains p_user_id (default NULL). Every other overload is
-- found in the catalogue and dropped first, so the old two-argument call
-- ({p_email, p_session_hash}) resolves to the new function: an unclaimed
-- purchase still spends, a claimed one is refused until the scanner that
-- passes p_user_id is deployed. Apply this file BEFORE that scanner
-- (free-keyword-scan restamped for _shared/scan-credits.ts): the new call names
-- p_user_id, which no older function takes.
--
-- Scan Packs are no longer sold (2026-10-12); balances already bought stay
-- spendable for 90 days, which is what this protects. Safe to re-run.

SET LOCAL statement_timeout = '2min';

DO $drop_redeem$
DECLARE
  -- The one signature that stays: PostgREST resolves an RPC by parameter
  -- names and refuses two candidates, so every other overload in the
  -- catalogue is dropped (the same shape as 20260827131500).
  keep CONSTANT text := 'p_email text, p_session_hash text, p_user_id uuid';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'scan_credit_redeem'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    RAISE NOTICE 'dropping scan_credit_redeem overload %', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END
$drop_redeem$;

-- Spends one credit. With no hash it draws on the address's pool (the
-- signed-in account whose mailbox the edge function proved); with a hash it
-- also needs that purchase to have a credit left and to be unclaimed or
-- claimed by p_user_id, and the two move together or neither does.
CREATE OR REPLACE FUNCTION public.scan_credit_redeem(p_email text, p_session_hash text DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF position('@' in v_email) < 2 THEN RETURN false; END IF;
  IF p_session_hash IS NOT NULL THEN
    UPDATE public.scan_credit_session_grants g
       SET credits_used = g.credits_used + 1, updated_at = now()
     WHERE g.session_hash = p_session_hash
       AND g.email = v_email
       AND g.credits_used < g.credits_bought
       AND (g.claimed_by IS NULL OR g.claimed_by = p_user_id);
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  UPDATE public.user_scan_credits c
     SET credits_remaining = c.credits_remaining - 1, updated_at = now()
   WHERE c.email = v_email AND c.credits_remaining > 0;
  IF NOT FOUND THEN
    IF p_session_hash IS NOT NULL THEN
      UPDATE public.scan_credit_session_grants g
         SET credits_used = g.credits_used - 1, updated_at = now()
       WHERE g.session_hash = p_session_hash AND g.credits_used > 0;
    END IF;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- What a proven identity can spend: the pool of the address the edge function
-- proved (p_email, NULL when none was), plus, for each OTHER address among the
-- held purchases and the purchases p_user_id claimed, what those purchases
-- have left (never more than that address's pool). A held purchase another
-- account claimed counts for nobody but that account.
CREATE OR REPLACE FUNCTION public.scan_credit_balance(p_email text DEFAULT NULL, p_session_hashes text[] DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_own   integer := 0;
  v_held  integer := 0;
BEGIN
  IF v_email IS NOT NULL THEN
    SELECT c.credits_remaining INTO v_own FROM public.user_scan_credits c WHERE c.email = v_email;
  END IF;
  IF (p_session_hashes IS NOT NULL AND cardinality(p_session_hashes) > 0) OR p_user_id IS NOT NULL THEN
    SELECT coalesce(sum(least(s.left_by_purchase, s.pool)), 0)::integer INTO v_held
      FROM (SELECT g.email,
                   sum(g.credits_bought - g.credits_used) AS left_by_purchase,
                   coalesce(max(c.credits_remaining), 0) AS pool
              FROM public.scan_credit_session_grants g
              LEFT JOIN public.user_scan_credits c ON c.email = g.email
             WHERE ((g.session_hash = ANY ((coalesce(p_session_hashes, '{}'::text[]))[1:10])
                     AND (g.claimed_by IS NULL OR g.claimed_by = p_user_id))
                    OR (p_user_id IS NOT NULL AND g.claimed_by = p_user_id))
               AND (v_email IS NULL OR g.email <> v_email)
             GROUP BY g.email) s;
  END IF;
  RETURN greatest(coalesce(v_own, 0), 0) + greatest(coalesce(v_held, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.scan_credit_redeem(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_credit_balance(text, text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_credit_redeem(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_credit_balance(text, text[], uuid) TO service_role;

COMMENT ON FUNCTION public.scan_credit_redeem(text, text, uuid) IS
  'Spends one scan credit: the address pool alone, or a held purchase (session hash) that is unclaimed or claimed '
  'by p_user_id, together with the pool. A purchase another account claimed is refused. S12-154, 20261011141000. '
  'service_role only.';

-- Self-verifying: one redeem, closed to clients; a claimed purchase answers only
-- its claimer on both the spend and the balance; an unclaimed one still answers
-- its bearer; the original rules (the cap, the pool) hold. Rolled back.
DO $verify$
DECLARE
  v_n        integer;
  v_bal      integer;
  v_fail     text;
  v_sentinel constant text := 'claimed credit probe: rolled back';
  v_probe    constant text := 'migration-check+claimed@example.invalid';
  v_hash     constant text := repeat('c', 64);
  v_open     constant text := repeat('d', 64);
  v_buyer    constant uuid := '00000000-0000-4000-8000-0000000001b1';
  v_other    constant uuid := '00000000-0000-4000-8000-0000000001b2';
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'scan_credit_redeem';
  IF v_n <> 1 OR to_regprocedure('public.scan_credit_redeem(text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'expected exactly one scan_credit_redeem(text, text, uuid), found % overloads', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.scan_credit_redeem(text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.scan_credit_redeem(text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.scan_credit_balance(text,text[],uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.scan_credit_balance(text,text[],uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a scan credit spender or reader is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.scan_credit_redeem(text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.scan_credit_balance(text,text[],uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot spend or read scan credits';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.scan_credit_redeem(text,text,uuid)'::regprocedure
                    AND p.prosecdef AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg WHERE cfg LIKE 'search_path=%')) THEN
    RAISE EXCEPTION 'scan_credit_redeem is not a definer with a pinned search_path';
  END IF;

  BEGIN
    INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased)
    VALUES (v_probe, 5, 5)
    ON CONFLICT (email) DO UPDATE SET credits_remaining = 5, total_credits_purchased = 5;
    INSERT INTO public.scan_credit_session_grants (session_hash, email, product_type, credits_bought, claimed_by)
    VALUES (v_hash, v_probe, 'scan_pack', 2, v_buyer), (v_open, v_probe, 'scan_pack', 1, NULL)
    ON CONFLICT (session_hash) DO NOTHING;

    -- The next person at the same browser, signed out, then signed in as someone else.
    IF public.scan_credit_redeem(v_probe, v_hash, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a signed-out caller spent a purchase another account claimed';
    END IF;
    IF public.scan_credit_redeem(v_probe, v_hash, v_other) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'another account spent a purchase it never claimed';
    END IF;
    IF public.scan_credit_balance(NULL, ARRAY[v_hash], NULL) <> 0 OR public.scan_credit_balance(NULL, ARRAY[v_hash], v_other) <> 0 THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a claimed purchase showed its balance to a caller who did not claim it';
    END IF;
    -- The claimer, on any device.
    IF NOT public.scan_credit_redeem(v_probe, v_hash, v_buyer) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the claiming account could not spend its own purchase';
    END IF;
    v_bal := public.scan_credit_balance(NULL, ARRAY[v_hash], v_buyer);
    IF v_bal <> 1 THEN
      v_fail := coalesce(v_fail || '; ', '') || format('the claiming account reports %s left on its purchase, want 1', v_bal);
    END IF;
    -- An unclaimed purchase still answers whoever holds its id.
    IF NOT public.scan_credit_redeem(v_probe, v_open, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'an unclaimed purchase could not be spent by its bearer';
    END IF;
    IF public.scan_credit_redeem(v_probe, v_open, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a purchase spent more credits than it bought';
    END IF;
    -- The pool path is unchanged.
    IF NOT public.scan_credit_redeem(v_probe, NULL, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the proven address could not spend its own pool';
    END IF;

    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the probe could not run: ' || SQLERRM;
    END IF;
  END;
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION 'claimed scan credits do not behave as this file intends: %', v_fail;
  END IF;
  RAISE NOTICE 'self-verify 20261011141000: a claimed purchase is spent and counted only for the account that claimed it; an unclaimed one still answers its bearer';
END
$verify$;
