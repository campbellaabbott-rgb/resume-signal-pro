-- A PRO MEMBER MINTS AT MOST TEN GRANTS A DAY, A CHECKOUT NAMES ITS SIGNED-IN
-- BUYER, AND A PLAN CANCELLED AT PERIOD END SAYS SO (wave 4 round 2,
-- checkout-catalogue; S12-067, S12-076, critical-path CP-022 and CP-025,
-- owner decision D7).
--
-- WHAT WAS WRONG.
--   1. A Pro member's included tool is a pro_grants row, and every grant pays
--      for a model run. create-checkout (the Full Analysis) and
--      create-product-checkout (the Freelance tiers) minted one per press
--      with no count, so a loop of presses was unbounded model spend.
--   2. A one-time purchase made while signed in named no account: the order
--      could not be listed under that account (CP-022).
--   3. Cancelling in Stripe's portal leaves the plan active to its period
--      end, and the cache had nowhere to say so, so the Pro card kept
--      reading "Renews <date>" (S12-076).
--
-- WHAT THIS ADDS, all service_role only:
--   - pro_grants_cap(): a BEFORE INSERT trigger on pro_grants refusing the
--     11th grant in 24 hours and the 61st in 30 days for one account (the
--     grant's user_id, else its address), serialised per account by an
--     advisory lock so two presses at once cannot both pass. The refusal is
--     RAISE with SQLSTATE P0001 and a message starting 'pro_grant_cap:',
--     which the checkouts answer as a fair-use 429 and never as a charge.
--   - checkout_buyers: one row per Stripe session a signed-in buyer started
--     (session id, account, the checkout and product), written by the
--     checkout before the browser has the url. ON DELETE SET NULL: deleting
--     an account leaves the payment record (owner decision D9) without the
--     account.
--   - pro_subscribers.cancel_at_period_end: written by checkProByEmail
--     (_shared/pro.ts) from the subscription Stripe answers for.
--
-- Safe to re-run. The DO block at the end checks the catalogue and exercises
-- the cap inside a sub-transaction that it always rolls back. Verify:
-- src/test/w4b-a-pro-member-mints-ten-grants-a-day.test.ts runs this file in
-- pglite from Supabase's default grants; scripts/verify-deploy.d/
-- 92-w4b-checkout-catalogue.sh probes the grants read-only.

-- ── 1. the grant cap ────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS pro_grants_lower_email_created_idx
  ON public.pro_grants (lower(email), created_at DESC);

CREATE OR REPLACE FUNCTION public.pro_grants_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_day integer;
  v_month integer;
BEGIN
  v_key := coalesce(NEW.user_id::text, lower(btrim(coalesce(NEW.email, ''))));
  IF v_key = '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pro_grants_cap:' || v_key));
  IF NEW.user_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE g.created_at > now() - interval '24 hours'),
           count(*)
      INTO v_day, v_month
      FROM public.pro_grants g
     WHERE g.user_id = NEW.user_id
       AND g.created_at > now() - interval '30 days';
  ELSE
    SELECT count(*) FILTER (WHERE g.created_at > now() - interval '24 hours'),
           count(*)
      INTO v_day, v_month
      FROM public.pro_grants g
     WHERE g.user_id IS NULL
       AND lower(g.email) = v_key
       AND g.created_at > now() - interval '30 days';
  END IF;
  IF v_day >= 10 THEN
    RAISE EXCEPTION 'pro_grant_cap: daily' USING ERRCODE = 'P0001',
      HINT = 'Pro includes 10 tools a day and 60 a month';
  END IF;
  IF v_month >= 60 THEN
    RAISE EXCEPTION 'pro_grant_cap: monthly' USING ERRCODE = 'P0001',
      HINT = 'Pro includes 10 tools a day and 60 a month';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pro_grants_cap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_grants_cap() TO service_role;

COMMENT ON FUNCTION public.pro_grants_cap() IS
  'BEFORE INSERT on pro_grants: refuses the 11th grant in 24 hours and the 61st in 30 days for one account '
  '(user_id, else the address), with SQLSTATE P0001 and a message starting pro_grant_cap: (owner decision D7). '
  'Serialised per account by an advisory lock. 20261011150000.';

DROP TRIGGER IF EXISTS pro_grants_cap ON public.pro_grants;
CREATE TRIGGER pro_grants_cap
  BEFORE INSERT ON public.pro_grants
  FOR EACH ROW EXECUTE FUNCTION public.pro_grants_cap();

-- ── 2. a checkout names its signed-in buyer ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.checkout_buyers (
  stripe_session_id text PRIMARY KEY CHECK (stripe_session_id ~ '^cs_[A-Za-z0-9_]{8,250}$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checkout_function text NOT NULL,
  product_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkout_buyers_user_idx
  ON public.checkout_buyers (user_id, created_at DESC) WHERE user_id IS NOT NULL;

ALTER TABLE public.checkout_buyers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_buyers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkout_buyers TO service_role;

COMMENT ON TABLE public.checkout_buyers IS
  'One row per Stripe Checkout session a signed-in buyer started: the account that bought it '
  '(create-checkout, create-product-checkout, create-subscription-checkout write it before the browser has the url). '
  'Read by the account orders reader. service_role only. 20261011150000.';

-- ── 3. a plan cancelled at period end says so ──────────────────────────────

ALTER TABLE public.pro_subscribers ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pro_subscribers.cancel_at_period_end IS
  'True when the subscription Stripe answered for is set to end at current_period_end (cancelled in the portal, '
  'still live until then). Written by checkProByEmail (_shared/pro.ts); the Pro card then says Ends, not Renews. '
  '20261011150000.';

-- ── self-check ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_fn oid := to_regprocedure('public.pro_grants_cap()');
  v_capped text := NULL;
  v_user uuid := '00000000-0000-4000-8000-0000000c4b01';
  i integer;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'self-check: pro_grants_cap() is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.pro_grants'::regclass
       AND t.tgname = 'pro_grants_cap'
       AND t.tgfoid = v_fn
       AND t.tgenabled <> 'D'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'self-check: the pro_grants_cap trigger is not on pro_grants, or is disabled';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: pro_grants_cap() is executable by a client role';
  END IF;

  IF has_table_privilege('anon', 'public.checkout_buyers', 'SELECT')
     OR has_table_privilege('anon', 'public.checkout_buyers', 'INSERT')
     OR has_table_privilege('authenticated', 'public.checkout_buyers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.checkout_buyers', 'INSERT')
     OR has_table_privilege('authenticated', 'public.checkout_buyers', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.checkout_buyers', 'DELETE') THEN
    RAISE EXCEPTION 'self-check: a client role holds a privilege on checkout_buyers';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.checkout_buyers'::regclass) THEN
    RAISE EXCEPTION 'self-check: checkout_buyers has row level security off';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pro_subscribers' AND column_name = 'cancel_at_period_end'
  ) THEN
    RAISE EXCEPTION 'self-check: pro_subscribers.cancel_at_period_end is missing';
  END IF;

  -- The cap, exercised: ten grants for one account pass and the eleventh is
  -- refused. Everything written here is rolled back by the sentinel below.
  BEGIN
    FOR i IN 1..10 LOOP
      INSERT INTO public.pro_grants (email, product_id, product_type, user_id)
      VALUES ('cap-self-check@example.invalid', 'selfCheck', 'self_check', v_user);
    END LOOP;
    BEGIN
      INSERT INTO public.pro_grants (email, product_id, product_type, user_id)
      VALUES ('cap-self-check@example.invalid', 'selfCheck', 'self_check', v_user);
    EXCEPTION WHEN raise_exception THEN
      v_capped := SQLERRM;
    END;
    RAISE EXCEPTION 'self-check rollback' USING ERRCODE = 'RB150';
  EXCEPTION WHEN SQLSTATE 'RB150' THEN
    NULL;
  END;
  IF v_capped IS NULL OR v_capped NOT LIKE 'pro_grant_cap:%' THEN
    RAISE EXCEPTION 'self-check: the eleventh grant in a day was not refused by pro_grants_cap (got %)', coalesce(v_capped, 'no refusal');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pro_grants WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'self-check: the cap exercise left rows behind';
  END IF;
END $$;
