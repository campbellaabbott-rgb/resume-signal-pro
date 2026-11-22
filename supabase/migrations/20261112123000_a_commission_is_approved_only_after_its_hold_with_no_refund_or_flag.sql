-- lovable-cron-fallback-reviewed: no sub-hourly cron; this file schedules affiliate-commission-approval daily at 04:47 UTC (reviewed 2026-11-18 in the bug round B integration, on the owner's 30-day hold of that day).
--
-- A COMMISSION IS APPROVED ONLY AFTER ITS HOLD, WITH NO REFUND AND NO FLAG
-- (bug round 2026-11-08, lane affiliate: S14X-085, the owner-gated half;
-- the owner chose this rule, the 30-day hold, on 2026-11-18).
--
-- WHAT WAS WRONG. A referred sale is recorded as a pending conversion, and
-- nothing ever approved one: no job, no admin action. A payout request
-- covers approved conversions only, so no affiliate could ever be paid by
-- the program's own steps, and the commission mail promised payment
-- "monthly" on a schedule nothing kept.
--
-- WHAT THIS CHANGES (the owner's pick of 2026-11-18, the 30-day hold):
--   1. affiliate_conversions.approved_at: when a conversion was approved.
--   2. affiliate_approve_held_commissions(p_hold_days default 30, 14..365)
--      approves every pending conversion with a commission that is at least
--      p_hold_days old (the sale's created_at), carries no review flag
--      (20261112122000: 'affiliate-network', 'unproven-affiliate'), whose
--      checkout session has no payment_revocations row (a refund or a
--      dispute, 20261008131000: main's trigger rejects a conversion when the
--      revocation comes after it; this covers one recorded before it), and
--      whose affiliate is active with a proven address (20261112120000). It
--      returns how many it approved.
--   3. pg_cron runs it daily at 04:47 UTC as 'affiliate-commission-approval',
--      its statement_timeout SET inside the command.
--
-- ORDER. This file lands only after the payments lane's M-S14-052/C-S14-013,
-- which writes a payment_revocations row when a referred Pro first month is
-- refunded or disputed (with its checkout session id): before that, a
-- refunded subscription month would look clean here.
--
-- service_role only: REVOKE ALL from PUBLIC, anon and authenticated, checked
-- below. Safe to re-run.
--
-- Verify: get_cron_health (anon) lists 'affiliate-commission-approval',
-- '47 4 * * *', last run succeeded (section 99zzzzzzz-bugs-affiliate, O1).

ALTER TABLE public.affiliate_conversions ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE OR REPLACE FUNCTION public.affiliate_approve_held_commissions(p_hold_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_hold_days IS NULL OR p_hold_days < 14 OR p_hold_days > 365 THEN
    RAISE EXCEPTION 'affiliate_approve_held_commissions: a hold of % days is outside 14..365', p_hold_days;
  END IF;
  UPDATE public.affiliate_conversions c
     SET status = 'approved', approved_at = now()
   WHERE c.status = 'pending'
     AND c.commission_amount > 0
     AND c.created_at <= now() - make_interval(days => p_hold_days)
     AND cardinality(c.review_flags) = 0
     AND NOT EXISTS (SELECT 1 FROM public.payment_revocations r WHERE r.stripe_session_id = c.stripe_session_id)
     AND EXISTS (SELECT 1 FROM public.affiliates a
                  WHERE a.id = c.affiliate_id AND a.status = 'active' AND a.email_confirmed_at IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_approve_held_commissions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_approve_held_commissions(integer) TO service_role;
COMMENT ON FUNCTION public.affiliate_approve_held_commissions(integer) IS
  'Approves pending commissions at least p_hold_days (default 30) old with no review flag, no payment_revocations row '
  'for their checkout session, and an active affiliate with a proven address; returns the count. Daily from pg_cron '
  '(affiliate-commission-approval). service_role only. 20261112123000 (S14X-085, owner-gated).';

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed here: the affiliate-commission-approval job is not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-commission-approval') THEN
    PERFORM cron.unschedule('affiliate-commission-approval');
  END IF;
  PERFORM cron.schedule('affiliate-commission-approval', '47 4 * * *',
    $c$SET statement_timeout = '2min'; SELECT public.affiliate_approve_held_commissions(30);$c$);
END $$;

DO $$
DECLARE
  v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'affiliate_conversions' AND column_name = 'approved_at') THEN
    RAISE EXCEPTION 'self-check: affiliate_conversions.approved_at is missing';
  END IF;
  IF to_regprocedure('public.affiliate_approve_held_commissions(integer)') IS NULL THEN
    RAISE EXCEPTION 'self-check: affiliate_approve_held_commissions(integer) is missing';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.affiliate_approve_held_commissions(integer)', 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % can run affiliate_approve_held_commissions', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.affiliate_approve_held_commissions(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: service_role cannot run affiliate_approve_held_commissions';
  END IF;
  -- Nested: a condition naming cron.job is planned whole, so it may not
  -- share an IF with the test for the schema.
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-commission-approval' AND schedule = '47 4 * * *'
                      AND command LIKE 'SET statement_timeout = %; SELECT public.affiliate_approve_held_commissions(30);') THEN
      RAISE EXCEPTION 'self-check: the affiliate-commission-approval job is missing, mis-scheduled or has no statement_timeout in its command';
    END IF;
  END IF;
END $$;
