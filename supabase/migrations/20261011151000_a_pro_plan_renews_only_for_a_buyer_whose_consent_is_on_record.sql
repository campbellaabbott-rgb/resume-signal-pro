-- A PRO PLAN RENEWS ONLY FOR A BUYER WHOSE CONSENT IS ON RECORD (wave 4
-- round 2, checkout-catalogue; owner decision 2026-10-17).
--
-- WHAT WAS WRONG. Pro renews every month until cancelled. California's
-- automatic renewal law (Business and Professions Code 17600 and following,
-- as amended by AB 2863) asks for the buyer's affirmative consent to the
-- renewal terms, given separately from the rest of the purchase, and for the
-- seller to keep a record of it. The Pro card showed the renewal sentence and
-- the Terms line, and nothing recorded that the buyer agreed to renewal.
--
-- WHAT THIS ADDS: pro_auto_renew_consents, one row per Stripe session a Pro
-- buyer started after ticking the separate, unticked renewal box. The
-- checkout (create-subscription-checkout, _shared/auto-renew-consent.ts)
-- writes it before the browser has the Stripe url, and expires the session
-- if it cannot: which wording the buyer agreed to (renewal_terms_version),
-- the Terms version the page showed, the price and interval, and the time.
-- service_role only. ON DELETE SET NULL: deleting an account leaves the
-- consent record, as a payment record (owner decision D9), without the
-- account; the Stripe session id still ties it to the purchase.
--
-- Safe to re-run. The DO block at the end checks the table, its grants and
-- its row level security, and writes and reads a row inside a sub-transaction
-- it always rolls back. Verify: src/test/w4b-pro-renews-only-with-the-buyers-own-tick.test.ts
-- runs this file in pglite from Supabase's default grants.

CREATE TABLE IF NOT EXISTS public.pro_auto_renew_consents (
  stripe_session_id text PRIMARY KEY CHECK (stripe_session_id ~ '^cs_[A-Za-z0-9_]{8,250}$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  renewal_terms_version text NOT NULL CHECK (renewal_terms_version ~ '^\d{4}-\d{2}-\d{2}$'),
  terms_version text,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  renewal_interval text NOT NULL DEFAULT 'month' CHECK (renewal_interval IN ('month', 'year')),
  consented_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pro_auto_renew_consents_user_idx
  ON public.pro_auto_renew_consents (user_id, consented_at DESC) WHERE user_id IS NOT NULL;

ALTER TABLE public.pro_auto_renew_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pro_auto_renew_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pro_auto_renew_consents TO service_role;

COMMENT ON TABLE public.pro_auto_renew_consents IS
  'One row per Stripe Checkout session a Pro buyer started after ticking the separate automatic-renewal box: '
  'the wording version agreed to, the Terms version shown, the price, the interval and the time '
  '(create-subscription-checkout writes it before the browser has the url; California ARL as amended by AB 2863). '
  'Keep for at least three years, or one year after the plan ends, whichever is longer. service_role only. 20261011151000.';

-- ── self-check ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_read text := NULL;
BEGIN
  IF to_regclass('public.pro_auto_renew_consents') IS NULL THEN
    RAISE EXCEPTION 'self-check: pro_auto_renew_consents is missing';
  END IF;
  IF has_table_privilege('anon', 'public.pro_auto_renew_consents', 'SELECT')
     OR has_table_privilege('anon', 'public.pro_auto_renew_consents', 'INSERT')
     OR has_table_privilege('anon', 'public.pro_auto_renew_consents', 'UPDATE')
     OR has_table_privilege('anon', 'public.pro_auto_renew_consents', 'DELETE')
     OR has_table_privilege('authenticated', 'public.pro_auto_renew_consents', 'SELECT')
     OR has_table_privilege('authenticated', 'public.pro_auto_renew_consents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.pro_auto_renew_consents', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.pro_auto_renew_consents', 'DELETE') THEN
    RAISE EXCEPTION 'self-check: a client role holds a privilege on pro_auto_renew_consents';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pro_auto_renew_consents'::regclass) THEN
    RAISE EXCEPTION 'self-check: pro_auto_renew_consents has row level security off';
  END IF;

  -- A row as the checkout writes it, read back, then rolled back.
  BEGIN
    INSERT INTO public.pro_auto_renew_consents
      (stripe_session_id, user_id, renewal_terms_version, terms_version, price_cents, renewal_interval, consented_at)
    VALUES ('cs_test_selfcheck151000', NULL, '2026-10-17', '2026-07-10', 4500, 'month', now());
    SELECT renewal_terms_version INTO v_read
      FROM public.pro_auto_renew_consents WHERE stripe_session_id = 'cs_test_selfcheck151000';
    RAISE EXCEPTION 'self-check rollback' USING ERRCODE = 'RB151';
  EXCEPTION WHEN SQLSTATE 'RB151' THEN
    NULL;
  END;
  IF v_read IS DISTINCT FROM '2026-10-17' THEN
    RAISE EXCEPTION 'self-check: a consent row could not be written and read back (got %)', coalesce(v_read, 'nothing');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pro_auto_renew_consents WHERE stripe_session_id = 'cs_test_selfcheck151000') THEN
    RAISE EXCEPTION 'self-check: the write exercise left a row behind';
  END IF;
END $$;
