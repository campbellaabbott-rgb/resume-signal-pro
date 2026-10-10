-- A SUBSCRIPTION NOTICE IS SENT ONCE PER SUBSCRIPTION AND KIND.
--
-- WHAT WAS WRONG (commercial-readiness plan 2026-10-08, item 11; Cal. Bus. &
-- Prof. Code 17602). A new Pro or agent subscriber was sent nothing by us: no
-- terms, no cancellation policy, no way to cancel, and a trial subscriber was
-- not reminded before the first charge. stripe-webhook (2026-10-09.1) now
-- queues a confirmation on the checkout that created the plan and a reminder
-- on Stripe's customer.subscription.trial_will_end. Stripe redelivers events,
-- so each notice is claimed here first, keyed by the subscription and the
-- kind: a second delivery finds the row and sends nothing.
--
-- service_role only: the webhook claims (INSERT), gives a claim back when the
-- queue refused the mail (DELETE), and nothing else reads it but the owner.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.subscription_notices (
  subscription_id text NOT NULL CHECK (subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  kind text NOT NULL CHECK (kind IN ('confirmation', 'trial_ending')),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  queued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, kind)
);

ALTER TABLE public.subscription_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.subscription_notices TO service_role;

COMMENT ON TABLE public.subscription_notices IS
  'One row per subscription notice queued (confirmation, trial_ending): the claim that makes '
  'stripe-webhook send each once however often Stripe redelivers. service_role only. 20261009130000.';

-- Self-verifying: the table is there, closed to the client roles, and a
-- second claim of the same notice is refused. The probe row is rolled back.
DO $$
BEGIN
  IF to_regclass('public.subscription_notices') IS NULL THEN
    RAISE EXCEPTION 'subscription_notices was not created';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.subscription_notices'::regclass) THEN
    RAISE EXCEPTION 'subscription_notices has row level security off';
  END IF;
  IF has_table_privilege('anon', 'public.subscription_notices', 'SELECT')
     OR has_table_privilege('authenticated', 'public.subscription_notices', 'SELECT')
     OR has_table_privilege('anon', 'public.subscription_notices', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscription_notices', 'INSERT') THEN
    RAISE EXCEPTION 'subscription_notices is readable or writable by a client role';
  END IF;
  BEGIN
    INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_selfcheck', 'confirmation', 'check@example.invalid');
    BEGIN
      INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_selfcheck', 'confirmation', 'check@example.invalid');
      RAISE EXCEPTION 'subscription_notices accepted the same notice twice';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its row is rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
