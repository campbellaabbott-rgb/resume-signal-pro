-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- AN UNOPENED PRO GRANT STOPS COUNTING AGAINST THE DAY'S TEN AFTER AN HOUR
-- (bug round 2026-11-08, lane payments, S14X-079).
--
-- WHAT WAS WRONG. pro_grants_cap() (20261011150000) counted every grant an
-- account minted, used or not. A Pro member who pressed "Full Analysis" ten
-- times without finishing (a closed tab, a second device, a reload) was told
-- the day's ten were used when none had been: a grant is spent only when it
-- is redeemed (consumed_at), and only a redemption costs a model run.
--
-- WHAT CHANGES. The same trigger, the same limits (10 a day, 60 in 30 days,
-- one account by user_id else by address, serialised per account), the same
-- refusal (SQLSTATE P0001, 'pro_grant_cap: daily|monthly'), counting:
--   - grants that were redeemed (consumed_at set), and
--   - grants younger than an hour that were not, so a burst of presses is
--     still bounded while they are fresh.
-- create-checkout also hands a member back their newest unopened Full
-- Analysis grant of the day instead of minting another (S14X-079), so a
-- second press no longer adds a row at all.
--
-- THIS TRIGGER COUNTS MINTS. A grant minted on an earlier day and left
-- unopened costs nothing here, and stays redeemable until its paid period
-- ends plus a week, so the same limits are counted again when a grant is
-- opened: analyze-resume (redemption-cap.ts) counts the account's grants by
-- consumed_at, ten in 24 hours and sixty in 30 days, before any model run,
-- and refuses the next with code grant_cap and the grant left unspent.
--
-- Same signature, owner and grants: REVOKE from PUBLIC, anon, authenticated;
-- EXECUTE for service_role. Safe to re-run. Independent of every function.
-- The self-check exercises both halves inside a sub-transaction it always
-- rolls back.

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
       AND g.created_at > now() - interval '30 days'
       AND (g.consumed_at IS NOT NULL OR g.created_at > now() - interval '1 hour');
  ELSE
    SELECT count(*) FILTER (WHERE g.created_at > now() - interval '24 hours'),
           count(*)
      INTO v_day, v_month
      FROM public.pro_grants g
     WHERE g.user_id IS NULL
       AND lower(g.email) = v_key
       AND g.created_at > now() - interval '30 days'
       AND (g.consumed_at IS NOT NULL OR g.created_at > now() - interval '1 hour');
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
  '(user_id, else the address), counting redeemed grants and unredeemed ones younger than an hour, with SQLSTATE '
  'P0001 and a message starting pro_grant_cap: (owner decision D7; S14X-079). Serialised per account by an '
  'advisory lock. 20261011150000, 20261112111000.';

DROP TRIGGER IF EXISTS pro_grants_cap ON public.pro_grants;
CREATE TRIGGER pro_grants_cap
  BEFORE INSERT ON public.pro_grants
  FOR EACH ROW EXECUTE FUNCTION public.pro_grants_cap();

-- ── self-check ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_fn oid := to_regprocedure('public.pro_grants_cap()');
  v_open uuid := '00000000-0000-4000-8000-0000000c4b11';
  v_used uuid := '00000000-0000-4000-8000-0000000c4b12';
  v_open_refused text := NULL;
  v_used_refused text := NULL;
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

  -- Ten unopened grants two hours old no longer refuse the eleventh; ten
  -- redeemed ones still do. Everything written here is rolled back.
  BEGIN
    FOR i IN 1..10 LOOP
      INSERT INTO public.pro_grants (email, product_id, product_type, user_id, created_at)
      VALUES ('cap-open-self-check@example.invalid', 'selfCheck', 'self_check', v_open, now() - interval '2 hours');
      INSERT INTO public.pro_grants (email, product_id, product_type, user_id, created_at, consumed_at)
      VALUES ('cap-used-self-check@example.invalid', 'selfCheck', 'self_check', v_used, now() - interval '2 hours', now() - interval '1 hour');
    END LOOP;
    BEGIN
      INSERT INTO public.pro_grants (email, product_id, product_type, user_id)
      VALUES ('cap-open-self-check@example.invalid', 'selfCheck', 'self_check', v_open);
    EXCEPTION WHEN raise_exception THEN
      v_open_refused := SQLERRM;
    END;
    BEGIN
      INSERT INTO public.pro_grants (email, product_id, product_type, user_id)
      VALUES ('cap-used-self-check@example.invalid', 'selfCheck', 'self_check', v_used);
    EXCEPTION WHEN raise_exception THEN
      v_used_refused := SQLERRM;
    END;
    RAISE EXCEPTION 'self-check rollback' USING ERRCODE = 'RB111';
  EXCEPTION WHEN SQLSTATE 'RB111' THEN
    NULL;
  END;
  IF v_open_refused IS NOT NULL THEN
    RAISE EXCEPTION 'self-check: ten unopened grants older than an hour still refused the eleventh (%)', v_open_refused;
  END IF;
  IF v_used_refused IS NULL OR v_used_refused NOT LIKE 'pro_grant_cap: daily%' THEN
    RAISE EXCEPTION 'self-check: ten redeemed grants did not refuse the eleventh (got %)', coalesce(v_used_refused, 'no refusal');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pro_grants WHERE user_id IN (v_open, v_used)) THEN
    RAISE EXCEPTION 'self-check: the cap exercise left rows behind';
  END IF;
END $$;
