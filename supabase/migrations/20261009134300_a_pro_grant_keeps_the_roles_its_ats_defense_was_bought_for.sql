-- A PRO GRANT KEEPS THE ROLES ITS ATS DEFENSE WAS BOUGHT FOR.
--
-- WHAT WAS WRONG (sweep S11-074). ATS Defense ($15) sold "multi-role
-- targeting (up to 3 roles)", but no purchase or delivery path collected the
-- roles: every deliverer sent targetRoles: [], and the model guessed them.
-- Owner decision 2026-10-11: the buy button asks for up to three roles before
-- checkout, and every purchase and delivery path passes them on. A Stripe
-- purchase carries them in the session's metadata (target_roles); a Pro
-- member's included copy is a pro_grants row, which needs a column for them.
-- verify-product-purchase reads it into the grant's synthetic session.
--
-- create-product-checkout 2026-10-09.61 writes it, and mints the grant without
-- it if this file has not applied (so no member is sent to Stripe for an
-- included tool). Apply before or with the function. Safe to re-run.

SET LOCAL statement_timeout = '2min';

ALTER TABLE public.pro_grants ADD COLUMN IF NOT EXISTS target_roles text;
ALTER TABLE public.pro_grants DROP CONSTRAINT IF EXISTS pro_grants_target_roles_len;
ALTER TABLE public.pro_grants
  ADD CONSTRAINT pro_grants_target_roles_len CHECK (target_roles IS NULL OR length(target_roles) <= 300);

COMMENT ON COLUMN public.pro_grants.target_roles IS
  'Up to three roles an ATS Defense grant targets, joined by " | " (_shared/target-roles.ts). S11-074, 20261009134300.';

-- Self-verifying: the column is there and bounded. (Who may write the table
-- is unchanged: its row policy admits service_role only.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'pro_grants' AND column_name = 'target_roles') THEN
    RAISE EXCEPTION 'pro_grants.target_roles was not added';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pro_grants_target_roles_len') THEN
    RAISE EXCEPTION 'pro_grants.target_roles has no length bound';
  END IF;
END $$;
