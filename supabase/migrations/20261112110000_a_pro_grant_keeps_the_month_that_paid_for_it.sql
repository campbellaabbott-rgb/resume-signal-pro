-- A PRO GRANT KEEPS THE MONTH THAT PAID FOR IT (bug round 2026-11-08, lane
-- payments, S14X-078).
--
-- WHAT WAS WRONG. A Pro member's Full Analysis is a pro_grants row minted
-- while the plan is paid. Every redeemer asked whether the plan may mint
-- consumables NOW, so a member whose card declined (past_due) or who
-- cancelled between pressing the button and running the analysis was refused
-- the analysis their paid month had already handed them.
--
-- WHAT THIS ADDS. pro_grants.redeem_until: the minting period's end plus a
-- week, stamped by create-checkout at mint. Until then an unrevoked grant
-- naming an account is redeemable whatever the plan's standing is now
-- (_shared/pro.ts proGrantRefusal). A row without it (every grant minted
-- before this, and any minted while the period end is unknown) keeps
-- today's rule. Revocation (a refund) still wins.
--
-- No grant changes: pro_grants keeps its RLS and its service_role-only
-- access; a new column inherits the table's privileges. Safe to re-run.
-- Apply BEFORE the functions that read it; they also work without it.

ALTER TABLE public.pro_grants ADD COLUMN IF NOT EXISTS redeem_until timestamptz;

COMMENT ON COLUMN public.pro_grants.redeem_until IS
  'Until when an unrevoked grant naming an account may be redeemed whatever the plan''s standing is now: '
  'the minting period''s end plus 7 days, stamped by create-checkout (S14X-078). NULL keeps the plan-standing rule. '
  '20261112110000.';

-- ── self-check ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pro_grants'
       AND column_name = 'redeem_until' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'self-check: pro_grants.redeem_until is missing or not a timestamptz';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pro_grants'::regclass) THEN
    RAISE EXCEPTION 'self-check: pro_grants has row level security off';
  END IF;
END $$;
