-- A PAYOUT REQUEST IS A ROW THE OWNER CAN ACT ON (wave 2 email-ops, register
-- L13-63; owner decision 2026-10-07).
--
-- The affiliate dashboard's Request Payout button called nothing: PayoutRequest
-- was rendered without its handler, toasted "Payout request submitted! You'll
-- receive payment within 5-7 business days" whatever happened, and no record
-- or message reached anyone. The affiliate-payout-request function (service
-- role, the affiliate's own session token checked first) now writes one row
-- here per request and mails the owner; the button says "received" only when
-- the row exists.
--
-- One open request per affiliate (a partial unique index), so a double click
-- or a second tab cannot file two. Service role only: RLS on with no policy,
-- revoked from the client roles by name. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.affiliate_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  note text
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payout_requests_one_open_idx
  ON public.affiliate_payout_requests (affiliate_id) WHERE status = 'requested';

ALTER TABLE public.affiliate_payout_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.affiliate_payout_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.affiliate_payout_requests TO service_role;
-- The function reads the session and the balance with the service role.
GRANT SELECT ON public.affiliate_sessions, public.affiliates TO service_role;

COMMENT ON TABLE public.affiliate_payout_requests IS
  'Payout requests from the affiliate dashboard, written by affiliate-payout-request after it checks the caller''s session. The owner pays and marks a row paid or rejected. Service role only.';

DO $$
BEGIN
  IF to_regclass('public.affiliate_payout_requests') IS NULL THEN
    RAISE EXCEPTION 'self-check: affiliate_payout_requests was not created';
  END IF;
  IF to_regclass('public.affiliate_payout_requests_one_open_idx') IS NULL THEN
    RAISE EXCEPTION 'self-check: the one-open-request index is missing';
  END IF;
  IF has_table_privilege('anon', 'public.affiliate_payout_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.affiliate_payout_requests', 'SELECT')
     OR has_table_privilege('anon', 'public.affiliate_payout_requests', 'INSERT')
     OR has_table_privilege('authenticated', 'public.affiliate_payout_requests', 'INSERT') THEN
    RAISE EXCEPTION 'self-check: a client role can read or write affiliate_payout_requests';
  END IF;
END $$;
