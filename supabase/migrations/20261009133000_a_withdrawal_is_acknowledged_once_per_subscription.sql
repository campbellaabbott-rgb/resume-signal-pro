-- A WITHDRAWAL IS ACKNOWLEDGED ONCE PER SUBSCRIPTION.
--
-- Owner decision 3 (2026-10-08): EU/UK sales are built behind a switch
-- (EU_UK_SALES, off until the owner registers for VAT). With it on, a plan
-- bought in the last 14 days can be withdrawn from the account page
-- (withdraw-subscription, 2026-10-09.1): the plan is cancelled, what was paid
-- less the days provided is refunded, and the withdrawal is acknowledged on a
-- durable medium (Directive 2011/83/EU art. 11(3)). That mail is claimed in
-- subscription_notices (20261009130000) like the other two notices, so a
-- retried request acknowledges once; this widens the ledger's kinds to hold
-- it. While the switch is off nothing writes the new kind.
--
-- Depends on 20261009130000. Safe to re-run.

ALTER TABLE public.subscription_notices
  DROP CONSTRAINT IF EXISTS subscription_notices_kind_check;
ALTER TABLE public.subscription_notices
  ADD CONSTRAINT subscription_notices_kind_check
  CHECK (kind IN ('confirmation', 'trial_ending', 'withdrawal'));

-- Self-verifying: the new kind is accepted once, an unknown kind is still
-- refused, and the table is still closed to the client roles. The probe rows
-- are rolled back.
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.subscription_notices', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscription_notices', 'INSERT') THEN
    RAISE EXCEPTION 'subscription_notices is writable by a client role';
  END IF;
  BEGIN
    INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_selfcheck', 'withdrawal', 'check@example.invalid');
    BEGIN
      INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_selfcheck', 'withdrawal', 'check@example.invalid');
      RAISE EXCEPTION 'subscription_notices accepted the same withdrawal twice';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    BEGIN
      INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_selfcheck', 'anything', 'check@example.invalid');
      RAISE EXCEPTION 'subscription_notices accepted an unknown kind';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
