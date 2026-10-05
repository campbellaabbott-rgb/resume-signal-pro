-- A SCAN CREDIT IS SPENT ONLY BY WHOEVER PROVED THE PURCHASE, AND ONLY WHEN A
-- REPORT WAS DELIVERED FOR IT.
--
-- WHAT WAS WRONG (defect sweep 2026-10-02; each re-read on main d1b118a1).
--
-- 1.26  The credit reader and the credit spender (the two siblings of the
--       credit writer that 20260730070000 closed) were SECURITY DEFINER and
--       still held Supabase's direct grants to anon and authenticated. Anyone
--       holding the publishable key could read any customer's balance by
--       email, learn which addresses had bought, and drain a balance one call
--       at a time.
--
-- 2.07  free-keyword-scan spent the credits of whatever address an anonymous
--       caller put in the request body (the only check was that it contained
--       an "@"), and gave unlimited scans to anyone who named an active Pro
--       subscriber's address. It ran as service_role, so closing the grants
--       above did not close it.
--
-- 2.06  The credit was spent before the report cache lookup and the model
--       call and never given back: a busy gateway, a 500 or a cache hit each
--       cost a credit, and the client's automatic retries spent one more each.
--
-- WHAT THIS FILE ADDS. The scanner (supabase/functions/_shared/scan-credits.ts)
-- now spends a credit for exactly two proven identities:
--   * the signed-in account: the address on the JWT the platform verified;
--   * a purchase the caller holds: the Stripe Checkout session id from the
--     success redirect, a bearer secret only the buyer's browser saw. It is
--     checked once with Stripe and recorded below by its SHA-256 (the id
--     itself is never stored), and it can spend AT MOST the credits that
--     purchase bought. Stripe never checked that the email typed at checkout
--     belongs to the buyer, so a one-credit purchase made "as" somebody else
--     must not unlock everything that address holds; the cap is what stops it.
-- A credit is RESERVED before the scan (so two concurrent requests cannot
-- share one) and REFUNDED unless a full report is delivered. The refund can
-- never lift a balance above what the address ever purchased, so a stray
-- second refund cannot mint a credit.
--
-- WHO CALLS WHAT, all with the service-role key: the scanner (redeem, refund,
-- balance, record), the new scan-credits function (balance, record),
-- get-account-data and verify-scan-pack-purchase (the reader), the webhook,
-- the purchase verifier and the retry sweep (the writer). No browser calls any
-- of them any more; src/hooks/use-scan-credits.ts asks scan-credits instead.

-- ── 1. the three original credit functions: service_role only ───────────────
REVOKE ALL ON FUNCTION public.use_scan_credit(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_scan_credits(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_scan_credits(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_scan_credit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_scan_credits(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_scan_credits(text, integer) TO service_role;

-- Any other overload of those names (none was ever written by a migration,
-- but the live catalogue has held functions the migrations never created) is
-- closed too, found through the catalogue rather than a typed signature.
DO $close_overloads$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('use_scan_credit', 'get_scan_credits', 'add_scan_credits')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$close_overloads$;

-- ── 2. one row per credit purchase a browser has presented ──────────────────
CREATE TABLE IF NOT EXISTS public.scan_credit_session_grants (
  session_hash   text PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  email          text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
  product_type   text NOT NULL DEFAULT '',
  credits_bought integer NOT NULL CHECK (credits_bought BETWEEN 1 AND 500),
  credits_used   integer NOT NULL DEFAULT 0 CHECK (credits_used >= 0 AND credits_used <= credits_bought),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_credit_session_grants_email_idx
  ON public.scan_credit_session_grants (email);
ALTER TABLE public.scan_credit_session_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scan_credit_session_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scan_credit_session_grants TO service_role;

COMMENT ON TABLE public.scan_credit_session_grants IS
  'One row per scan-credit purchase a browser presented by its Stripe Checkout session id. '
  'session_hash is the SHA-256 of that id (the id is a bearer secret and is not stored). '
  'A purchase can spend at most credits_bought from its address''s pool in user_scan_credits. '
  'Written only by scan_credit_grant_record after the session was checked with Stripe (20261005120000).';

-- Records a purchase the edge function checked with Stripe. True when the row
-- for this hash names this address, written now or before. A recorded purchase
-- is never re-pointed at another address.
CREATE OR REPLACE FUNCTION public.scan_credit_grant_record(
  p_session_hash text, p_email text, p_product_type text, p_credits_bought integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_stored text;
BEGIN
  IF p_session_hash IS NULL OR p_session_hash !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  IF position('@' in v_email) < 2 THEN RETURN false; END IF;
  IF p_credits_bought IS NULL OR p_credits_bought < 1 OR p_credits_bought > 500 THEN RETURN false; END IF;
  INSERT INTO public.scan_credit_session_grants (session_hash, email, product_type, credits_bought)
  VALUES (p_session_hash, v_email, left(coalesce(p_product_type, ''), 40), p_credits_bought)
  ON CONFLICT (session_hash) DO NOTHING;
  SELECT g.email INTO v_stored FROM public.scan_credit_session_grants g WHERE g.session_hash = p_session_hash;
  RETURN v_stored IS NOT DISTINCT FROM v_email;
END;
$$;

-- Spends one credit. With no hash it draws on the address's pool (the
-- signed-in account); with a hash it also needs that purchase to have a credit
-- left, and the two move together or neither does.
CREATE OR REPLACE FUNCTION public.scan_credit_redeem(p_email text, p_session_hash text DEFAULT NULL)
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
       AND g.credits_used < g.credits_bought;
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

-- Gives back a credit the scanner reserved and did not deliver against. Never
-- lifts a balance above what the address ever purchased.
CREATE OR REPLACE FUNCTION public.scan_credit_refund(p_email text, p_session_hash text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF position('@' in v_email) < 2 THEN RETURN false; END IF;
  UPDATE public.user_scan_credits c
     SET credits_remaining = c.credits_remaining + 1, updated_at = now()
   WHERE c.email = v_email AND c.credits_remaining < c.total_credits_purchased;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_session_hash IS NOT NULL THEN
    UPDATE public.scan_credit_session_grants g
       SET credits_used = g.credits_used - 1, updated_at = now()
     WHERE g.session_hash = p_session_hash AND g.email = v_email AND g.credits_used > 0;
  END IF;
  RETURN true;
END;
$$;

-- What a proven identity can spend: the account's pool, plus, for each OTHER
-- address among the held purchases, what those purchases have left (never more
-- than that address's pool).
CREATE OR REPLACE FUNCTION public.scan_credit_balance(p_email text DEFAULT NULL, p_session_hashes text[] DEFAULT NULL)
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
  IF p_session_hashes IS NOT NULL AND cardinality(p_session_hashes) > 0 THEN
    SELECT coalesce(sum(least(s.left_by_purchase, s.pool)), 0)::integer INTO v_held
      FROM (SELECT g.email,
                   sum(g.credits_bought - g.credits_used) AS left_by_purchase,
                   coalesce(max(c.credits_remaining), 0) AS pool
              FROM public.scan_credit_session_grants g
              LEFT JOIN public.user_scan_credits c ON c.email = g.email
             WHERE g.session_hash = ANY (p_session_hashes[1:10])
               AND (v_email IS NULL OR g.email <> v_email)
             GROUP BY g.email) s;
  END IF;
  RETURN greatest(coalesce(v_own, 0), 0) + greatest(coalesce(v_held, 0), 0);
END;
$$;

-- What the held purchases bought, for the success page's "N credits added".
CREATE OR REPLACE FUNCTION public.scan_credit_grants_bought(p_session_hashes text[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(g.credits_bought), 0)::integer
    FROM public.scan_credit_session_grants g
   WHERE p_session_hashes IS NOT NULL
     AND g.session_hash = ANY (p_session_hashes[1:10]);
$$;

REVOKE ALL ON FUNCTION public.scan_credit_grant_record(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_credit_redeem(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_credit_refund(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_credit_balance(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_credit_grants_bought(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_credit_grant_record(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_credit_redeem(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_credit_refund(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_credit_balance(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_credit_grants_bought(text[]) TO service_role;

-- ── 3. the catalogue and the behaviour are what this file intends ───────────
DO $check$
DECLARE
  v_sig      regprocedure;
  v_role     text;
  v_priv     text;
  v_n        integer;
  v_bal      integer;
  v_fail     text;
  v_sentinel constant text := 'scan credit probe: rolled back';
  v_probe    constant text := 'migration-check+credits@example.invalid';
  v_hash     constant text := repeat('a', 64);
BEGIN
  -- Every credit function: no client role may execute it; service_role must.
  FOR v_sig IN
    SELECT p.oid::regprocedure
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('use_scan_credit', 'get_scan_credits', 'add_scan_credits',
                         'scan_credit_grant_record', 'scan_credit_redeem', 'scan_credit_refund',
                         'scan_credit_balance', 'scan_credit_grants_bought')
  LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION '% is still executable by %', v_sig, v_role;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not executable by service_role, so the scanner could not spend or refund', v_sig;
    END IF;
  END LOOP;
  IF to_regprocedure('public.get_scan_credits(text)') IS NULL OR to_regprocedure('public.add_scan_credits(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'the credit reader or writer is missing; get-account-data, the verifiers and the webhook call them';
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('scan_credit_grant_record', 'scan_credit_redeem', 'scan_credit_refund',
                       'scan_credit_balance', 'scan_credit_grants_bought')
     AND p.prosecdef
     AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg WHERE cfg LIKE 'search_path=%');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'expected 5 SECURITY DEFINER credit functions with a pinned search_path, found %', v_n;
  END IF;

  -- The purchase table: RLS on, nothing for a client role.
  IF NOT coalesce((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.scan_credit_session_grants'::regclass), false) THEN
    RAISE EXCEPTION 'scan_credit_session_grants does not have row level security enabled';
  END IF;
  FOR v_role, v_priv IN
    SELECT ro.rolname, pv.privname
      FROM unnest(ARRAY['anon', 'authenticated']) ro(rolname)
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pv(privname)
  LOOP
    IF has_table_privilege(v_role, 'public.scan_credit_session_grants', v_priv) THEN
      RAISE EXCEPTION 'scan_credit_session_grants is open to a client role: % holds %', v_role, v_priv;
    END IF;
  END LOOP;

  -- THE BEHAVIOUR, rolled back.
  BEGIN
    INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased)
    VALUES (v_probe, 2, 2)
    ON CONFLICT (email) DO UPDATE SET credits_remaining = 2, total_credits_purchased = 2;

    IF NOT public.scan_credit_grant_record(v_hash, v_probe, 'scan_pack', 1) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'recording a purchase did not answer true';
    END IF;
    IF public.scan_credit_grant_record(v_hash, 'someone-else@example.invalid', 'scan_pack', 50) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a recorded purchase was re-pointed at another address';
    END IF;
    IF public.scan_credit_grants_bought(ARRAY[v_hash]) <> 1 THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the recorded purchase does not report what it bought';
    END IF;
    IF NOT public.scan_credit_redeem(v_probe, v_hash) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a purchase with a credit left could not spend it';
    END IF;
    IF public.scan_credit_redeem(v_probe, v_hash) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a purchase spent more credits than it bought';
    END IF;
    IF public.scan_credit_redeem(v_probe, repeat('b', 64)) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'an unrecorded purchase spent a credit';
    END IF;
    v_bal := public.scan_credit_balance(NULL, ARRAY[v_hash]);
    IF v_bal <> 0 THEN
      v_fail := coalesce(v_fail || '; ', '') || format('a spent purchase reports %s left, want 0', v_bal);
    END IF;
    v_bal := public.scan_credit_balance(v_probe, NULL);
    IF v_bal <> 1 THEN
      v_fail := coalesce(v_fail || '; ', '') || format('the account pool reports %s, want 1', v_bal);
    END IF;
    IF NOT public.scan_credit_redeem(v_probe, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the account could not spend its own pool';
    END IF;
    IF public.scan_credit_redeem(v_probe, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'an empty pool spent a credit';
    END IF;
    IF NOT public.scan_credit_refund(v_probe, v_hash) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a reserved purchase credit could not be refunded';
    END IF;
    v_bal := public.scan_credit_balance(NULL, ARRAY[v_hash]);
    IF v_bal <> 1 THEN
      v_fail := coalesce(v_fail || '; ', '') || format('a refunded purchase reports %s left, want 1', v_bal);
    END IF;
    IF NOT public.scan_credit_refund(v_probe, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a reserved account credit could not be refunded';
    END IF;
    IF public.scan_credit_refund(v_probe, NULL) THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a refund lifted a balance above what was ever purchased';
    END IF;

    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the probe could not run: ' || SQLERRM;
    END IF;
  END;
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION 'scan credits do not behave as this file intends: %', v_fail;
  END IF;
  RAISE NOTICE 'self-verify 20261005120000: every credit function closed to clients and open to service_role; a purchase spends at most what it bought; refunds never mint';
END
$check$;
