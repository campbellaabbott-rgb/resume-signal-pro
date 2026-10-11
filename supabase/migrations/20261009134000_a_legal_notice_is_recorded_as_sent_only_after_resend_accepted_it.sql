-- A LEGAL NOTICE IS RECORDED AS SENT ONLY AFTER RESEND ACCEPTED IT.
--
-- WHAT WAS WRONG (sweep S11-053). stripe-webhook (2026-10-09.4) wrote each
-- subscription notice's ledger row (20261009130000) when the mail was QUEUED.
-- Production has no drain for that queue, a restored drain dead-letters a
-- mail after 60 minutes or five failures, and the queue's sender domain has
-- no DNS: the Cal. B&P 17602 confirmation and the pre-charge trial reminder
-- were lost for good while the ledger said each went once, and a redelivered
-- Stripe event found the row and sent nothing.
--
-- OWNER DECISION 2026-10-11: the notices go DIRECTLY through Resend, the path
-- paid deliveries use, with an idempotency key, and a notice is recorded as
-- sent only after a 2xx. stripe-webhook 2026-10-09.61 and withdraw-subscription
-- 2026-10-09.61 (_shared/subscription-notice.ts sendLegalNotice) do that.
-- This file gives the ledger what they write:
--   sent_at              when Resend accepted the mail (2xx); NULL for none;
--   provider_message_id  Resend's id for it;
--   pending_mail         a withdrawal acknowledgement written before its plan
--                        is cancelled (subject, html, text), cleared when it
--                        is sent. stripe-webhook sends a waiting one on the
--                        customer.subscription.deleted that the cancel causes.
-- and lets service_role stamp a row (UPDATE). queued_at stays as the time the
-- row was written.
--
-- Apply BEFORE stripe-webhook 2026-10-09.61 and withdraw-subscription
-- 2026-10-09.61: both write the new columns. Depends on 20261009130000.
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

ALTER TABLE public.subscription_notices ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE public.subscription_notices ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE public.subscription_notices ADD COLUMN IF NOT EXISTS pending_mail jsonb;

ALTER TABLE public.subscription_notices DROP CONSTRAINT IF EXISTS subscription_notices_provider_id_len;
ALTER TABLE public.subscription_notices
  ADD CONSTRAINT subscription_notices_provider_id_len CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200);

REVOKE ALL ON TABLE public.subscription_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscription_notices TO service_role;

COMMENT ON TABLE public.subscription_notices IS
  'One row per subscription notice (confirmation, trial_ending, withdrawal). sent_at is set only after Resend '
  'accepted the mail (2xx); a row without it is a withdrawal acknowledgement waiting in pending_mail. '
  'stripe-webhook and withdraw-subscription write it. service_role only. 20261009130000, 20261009134000.';
COMMENT ON COLUMN public.subscription_notices.sent_at IS
  'When Resend accepted the notice (a 2xx). NULL: not sent. Never written for a queued or attempted mail (S11-053).';
COMMENT ON COLUMN public.subscription_notices.pending_mail IS
  'A withdrawal acknowledgement written before its plan was cancelled ({subject, html, text}), cleared once sent.';

-- Self-verifying: the columns are there, the table is closed to the client
-- roles and open to service_role for the stamp, and a row can wait unsent and
-- then be stamped. The probe row is rolled back.
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(c) INTO v_missing
    FROM unnest(ARRAY['sent_at', 'provider_message_id', 'pending_mail']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'subscription_notices' AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'subscription_notices is missing %', v_missing;
  END IF;
  IF has_table_privilege('anon', 'public.subscription_notices', 'SELECT')
     OR has_table_privilege('authenticated', 'public.subscription_notices', 'SELECT')
     OR has_table_privilege('anon', 'public.subscription_notices', 'INSERT')
     OR has_table_privilege('authenticated', 'public.subscription_notices', 'INSERT')
     OR has_table_privilege('anon', 'public.subscription_notices', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.subscription_notices', 'UPDATE') THEN
    RAISE EXCEPTION 'subscription_notices is readable or writable by a client role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.subscription_notices', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role cannot stamp a sent notice';
  END IF;
  BEGIN
    INSERT INTO public.subscription_notices (subscription_id, kind, email, pending_mail)
      VALUES ('sub_selfcheck', 'withdrawal', 'check@example.invalid', '{"subject":"s","html":"h","text":"t"}'::jsonb);
    UPDATE public.subscription_notices
       SET sent_at = now(), provider_message_id = 'selfcheck', pending_mail = NULL
     WHERE subscription_id = 'sub_selfcheck' AND kind = 'withdrawal';
    IF NOT EXISTS (SELECT 1 FROM public.subscription_notices
                    WHERE subscription_id = 'sub_selfcheck' AND sent_at IS NOT NULL AND pending_mail IS NULL) THEN
      RAISE EXCEPTION 'a waiting acknowledgement could not be stamped as sent';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its row is rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
