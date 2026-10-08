-- A PLAN IS READ BY THE ACCOUNT THAT BOUGHT IT, BY ONE RULE.
--
-- WHAT WAS WRONG (platform sweep 2026-10-04, L6-08 and L6-29; owner decision
-- 2026-10-04 "go with your recommendations").
--
--   - Five functions each decided "is this person Pro" their own way:
--     generate-apply-package counted only `active` with no grace, so every
--     trialing Agent subscriber the Account page called a Pro member got
--     402 on batch prep; the two product checkouts and the purchase verifier
--     read pro_subscribers only, so a comped agent account was sent to Stripe
--     for a tool its plan includes; the scanner read pro_subscribers only.
--   - Every one of them asked BY ADDRESS. Sign-ups are confirmed
--     automatically, so registering a Pro subscriber's address (one with no
--     account yet) made the subscription answer for the new account -- the
--     hole 20261005130000 closed for the agent tier and left open here.
--   - A trialing subscription counted for the whole paid catalogue: start the
--     seven-day agent trial, mint a free grant for every one-off product and a
--     scan pack, cancel, repeat.
--
-- WHAT THIS FILE DOES. The data half of the one predicate in
-- supabase/functions/_shared/pro.ts (accountProStanding / proStandingFrom):
--
--   1. pro_subscribers gains user_id, exactly as agent_subscribers did: the
--      buyer's account, stamped on the Stripe subscription by the (signed-in)
--      subscription checkouts and copied onto the row by checkProByEmail.
--      Rows that exist now are bound once to the account that holds their
--      address now -- what every gate already served -- so nobody who pays is
--      dropped. From here on an address alone binds nothing, and a re-run of
--      this file binds nothing either.
--
--   2. pro_entitlement_rows(user id) answers the account's subscription rows
--      from BOTH caches: a pro_subscribers row bound to the account, or an
--      unbound one on its own address when account_mailbox_proven; and the
--      agent row agent_subscription_rows already answers by the same rule.
--      Which of those rows count, and for what, is decided in ONE place, in
--      TypeScript, from these rows: active or trialing within a day of the
--      period end unlocks the plan's ongoing features; only a live row that
--      is NOT a trial may mint a consumable (a scan-credit grant, a free paid
--      one-off product).
--
--   3. pro_grants gains user_id (the account that minted the grant, so the
--      re-check at redemption asks that account, never the grant's address)
--      and revoked_at (written by 20261008131000 when a refunded or disputed
--      payment takes back what it minted; every redeemer refuses it).
--
-- No function here is callable by a client role; every reader is an edge
-- function holding the service-role key.

-- ── 1. the Pro cache knows whose plan it is ──────────────────────────────────

-- THE BINDING RUNS ONCE, in the run that adds the column. After it, an
-- unbound row is deliberate: a plan made in the Stripe dashboard with no
-- metadata.user_id, or one on an address whose password account has not
-- proven the mailbox. Binding those again on a re-run (the staged runner
-- re-stages files) would hand each to whoever registered its address -- the
-- hole this file closes -- and checkProByEmail never overrides a binding.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'pro_subscribers' AND column_name = 'user_id') THEN
    RAISE NOTICE 'pro_subscribers.user_id exists already: its rows were bound when it was added; nothing is bound again';
    RETURN;
  END IF;
  ALTER TABLE public.pro_subscribers ADD COLUMN user_id uuid;
  UPDATE public.pro_subscribers p
     SET user_id = u.id
    FROM auth.users u
   WHERE p.user_id IS NULL
     AND coalesce(btrim(u.email), '') <> ''
     AND lower(btrim(u.email)) = lower(btrim(p.email));
  IF EXISTS (
    SELECT 1 FROM public.pro_subscribers p JOIN auth.users u
        ON lower(btrim(u.email)) = lower(btrim(p.email)) AND coalesce(btrim(u.email), '') <> ''
     WHERE p.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'self-check: a Pro row whose address had an account was left unbound by the one-time binding';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pro_subscribers_user_idx
  ON public.pro_subscribers (user_id) WHERE user_id IS NOT NULL;
COMMENT ON COLUMN public.pro_subscribers.user_id IS
  'The account this plan belongs to: the user id the subscription checkout stamped on the Stripe subscription (copied here by checkProByEmail), or the account that held the address when 20261008130000 first ran (bound once, never again). Read through pro_entitlement_rows; an unbound row answers only for an account that has proven its mailbox.';

-- ── 2. one read of both caches, by account ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.pro_entitlement_rows(p_user_id uuid)
RETURNS TABLE (
  tier text,
  status text,
  current_period_end timestamptz,
  bound boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'pro'::text, p.status, p.current_period_end, (p.user_id IS NOT NULL)
    FROM auth.users u
    JOIN public.pro_subscribers p
      ON p.user_id = u.id
      OR (p.user_id IS NULL
          AND lower(btrim(p.email)) = lower(btrim(u.email))
          AND public.account_mailbox_proven(u.id))
   WHERE p_user_id IS NOT NULL
     AND u.id = p_user_id
  UNION ALL
  SELECT 'agent'::text, r.status, r.current_period_end, coalesce(r.bound, false)
    FROM public.agent_subscription_rows(ARRAY[p_user_id]) r
   WHERE p_user_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.pro_entitlement_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_entitlement_rows(uuid) TO service_role;

COMMENT ON FUNCTION public.pro_entitlement_rows(uuid) IS
  'Every subscription row the account may use, from pro_subscribers (bound to it, or unbound on its own proven address) and agent_subscribers (agent_subscription_rows). The rule that reads them is _shared/pro.ts proStandingFrom. service_role only.';

-- ── 3. a grant names its account and can be taken back ──────────────────────

ALTER TABLE public.pro_grants ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.pro_grants ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE INDEX IF NOT EXISTS pro_grants_user_idx
  ON public.pro_grants (user_id, created_at DESC) WHERE user_id IS NOT NULL;
COMMENT ON COLUMN public.pro_grants.user_id IS
  'The verified account that minted this grant. Redemption re-checks THIS account through pro_entitlement_rows; a grant without one (minted before 20261008130000) is refused and the member mints a new one.';
COMMENT ON COLUMN public.pro_grants.revoked_at IS
  'Set when a refunded or disputed subscription payment took back what it minted (payment_revoke, 20261008131000). Every redeemer refuses a revoked grant.';

-- ── self-check: the catalogue ───────────────────────────────────────────────
DO $$
DECLARE
  v_fn oid := to_regprocedure('public.pro_entitlement_rows(uuid)');
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'self-check: pro_entitlement_rows(uuid) is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'self-check: pro_entitlement_rows is not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: pro_entitlement_rows is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: service_role cannot execute pro_entitlement_rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'pro_subscribers' AND column_name = 'user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'pro_grants' AND column_name = 'user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'pro_grants' AND column_name = 'revoked_at') THEN
    RAISE EXCEPTION 'self-check: pro_subscribers.user_id, pro_grants.user_id or pro_grants.revoked_at is missing';
  END IF;
END $$;

-- ── self-check, exercised ───────────────────────────────────────────────────
--
-- Run against the real tables with one existing account, inside a block that
-- always ends by raising RB000, so every row it writes is rolled back.
DO $$
DECLARE
  v_uid uuid;
  v_email text;
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_stranger uuid := gen_random_uuid();
  v_proven boolean;
  v_n integer;
BEGIN
  SELECT u.id, lower(btrim(u.email)) INTO v_uid, v_email
    FROM auth.users u
   WHERE coalesce(btrim(u.email), '') <> ''
   ORDER BY u.created_at NULLS LAST, u.id
   LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'self-check: no account exists to exercise pro_entitlement_rows against; the catalogue checks above are all that ran';
    RETURN;
  END IF;

  BEGIN
    v_proven := public.account_mailbox_proven(v_uid);
    DELETE FROM public.pro_subscribers WHERE email = v_email OR user_id = v_uid;
    UPDATE public.agent_subscribers SET status = 'canceled' WHERE email = v_email OR user_id = v_uid;

    -- Bound to the account under another address: it is the account's.
    INSERT INTO public.pro_subscribers (email, status, current_period_end, user_id)
    VALUES ('bound-' || v_tag || '@self-check.invalid', 'active', now() + interval '20 days', v_uid);
    SELECT count(*) INTO v_n FROM public.pro_entitlement_rows(v_uid) r WHERE r.tier = 'pro' AND r.status = 'active' AND r.bound;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'self-check: a Pro row bound to the account does not answer for it';
    END IF;
    DELETE FROM public.pro_subscribers WHERE email = 'bound-' || v_tag || '@self-check.invalid';

    -- On the account's address but bound to ANOTHER account: never.
    INSERT INTO public.pro_subscribers (email, status, current_period_end, user_id)
    VALUES (v_email, 'active', now() + interval '20 days', v_stranger);
    SELECT count(*) INTO v_n FROM public.pro_entitlement_rows(v_uid) r WHERE r.tier = 'pro';
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'self-check: a Pro row bound to another account answers for whoever holds its address';
    END IF;

    -- On the account's address and unbound: only for a proven mailbox.
    UPDATE public.pro_subscribers SET user_id = NULL WHERE email = v_email;
    SELECT count(*) INTO v_n FROM public.pro_entitlement_rows(v_uid) r WHERE r.tier = 'pro';
    IF (v_n = 1) IS DISTINCT FROM v_proven THEN
      RAISE EXCEPTION 'self-check: an unbound Pro row answered for an address nobody proved (or refused a proven one)';
    END IF;

    -- Nobody asked, nothing answered.
    IF EXISTS (SELECT 1 FROM public.pro_entitlement_rows(NULL)) THEN
      RAISE EXCEPTION 'self-check: pro_entitlement_rows answered rows for no account';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
