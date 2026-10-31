-- A CONFIRMED PAST CAREER PATH BUYER IS REMEMBERED (wave 4 round 2 recheck;
-- the Career Path retirement, owner decision 2026-10-12).
--
-- WHAT WAS WRONG. Career Path is retired, but a past buyer's page (it has no
-- stored copy) keeps regenerating for 90 days after the purchase. Once the
-- 30-day claim row in used_stripe_sessions is gone, generate-career-path asks
-- Stripe whether the session was a paid Career Path purchase, behind a
-- per-address bucket (10 an hour) and a function-wide one (200 an hour) so a
-- stranger's made-up ids cannot spend the Stripe account's read limit. But
-- well-formed made-up ids from about 20 addresses an hour fill the
-- function-wide bucket, and then every genuine buyer between day 30 and day 90
-- got 402 for the rest of the hour.
--
-- WHAT THIS CHANGES. A table of confirmed past buyers: generate-career-path
-- writes a session here on Stripe's first yes, with the moment its 90 days
-- end, and reads it before either bucket, so a genuine buyer depends on the
-- shared bucket at most once. A refund or a dispute still stops it (the
-- function reads payment_revocations on every call). Rows past their end are
-- deleted by the function as it writes.
--
-- Service role only: the table is new, so Supabase's default grants gave ALL
-- to anon and authenticated; they are revoked here. RLS on with no policy.
-- Safe to re-run. Verify: the DO block below; src/test/w4b-fix2-a-confirmed-
-- past-buyer-never-waits-on-the-shared-bucket.test.ts (the handler) and the
-- default-grants guard.

SET LOCAL statement_timeout = '2min';

CREATE TABLE IF NOT EXISTS public.career_path_past_buyers (
  stripe_session_id text PRIMARY KEY CHECK (stripe_session_id ~ '^cs_(live|test)_[A-Za-z0-9]{20,200}$'),
  regenerate_until timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.career_path_past_buyers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.career_path_past_buyers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.career_path_past_buyers TO service_role;

COMMENT ON TABLE public.career_path_past_buyers IS
  'generate-career-path only: a Career Path purchase Stripe confirmed, kept until its 90 days of regeneration end, so the '
  'past buyer is not asked about again behind the shared Stripe read bucket. Service role only. 20261011213000.';

-- Self-verifying: the table exists with RLS on, neither client role holds any
-- privilege on it, service_role can read and write it, and its check refuses
-- an id that is not a Checkout session.
DO $$
DECLARE
  t text := 'public.career_path_past_buyers';
  p text;
BEGIN
  IF to_regclass(t) IS NULL THEN RAISE EXCEPTION '% is missing', t; END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = t::regclass) THEN
    RAISE EXCEPTION '% has row level security off', t;
  END IF;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('anon', t, p) OR has_table_privilege('authenticated', t, p) THEN
      RAISE EXCEPTION '% grants % to a client role', t, p;
    END IF;
    IF NOT has_table_privilege('service_role', t, p) THEN
      RAISE EXCEPTION '% does not grant % to service_role', t, p;
    END IF;
  END LOOP;
  BEGIN
    INSERT INTO public.career_path_past_buyers (stripe_session_id, regenerate_until) VALUES ('not-a-session', now());
    RAISE EXCEPTION 'past-buyers-selfcheck-accepted-a-bad-id';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'past-buyers-selfcheck-accepted-a-bad-id' THEN RAISE EXCEPTION '% accepted an id that is not a Checkout session', t; END IF;
      RAISE;
  END;
END $$;