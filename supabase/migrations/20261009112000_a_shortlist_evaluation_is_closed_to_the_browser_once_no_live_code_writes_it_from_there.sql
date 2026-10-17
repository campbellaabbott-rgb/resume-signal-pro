-- A SHORTLIST EVALUATION IS CLOSED TO THE BROWSER ONCE NO LIVE CODE WRITES IT
-- FROM THERE (sweep S8-041; the lockdown half of 20261009111000, register
-- S11-056).
--
-- HELD in docs/deploy-ledger.json (holdUntilVerified) until the new
-- shortlist-evaluate serves (its evaluation insert is the service role's) and
-- the published Shortlist page decides through shortlist_decide. Applied
-- while the old ones serve, every evaluation fails with 42501 after its paid
-- model call and every advance or reject click is refused and dropped.
--
-- S8-041. shortlist_candidates granted table-wide INSERT and UPDATE to
-- authenticated (20260704160023) under owner-only policies and no trigger.
-- The "immutable evaluation" COMPLIANCE.md sells as LL144/FEHA evidence was
-- not: an employer could PATCH score, signals, flags, redacted_text or
-- exclusions_applied, insert rows no model produced, and change status with
-- no decision row ("enforced in the app layer", 20260703120000).
--   - INSERT is the service role's (shortlist-evaluate writes the row).
--   - authenticated may UPDATE the status column only, and the guard trigger
--     refuses any status change that has no advance/reject decision for the
--     same candidate written in the same transaction (created_at = now()),
--     and any change to another column.
--   - a decision may be logged only against the caller's own candidate, its
--     created_at and actor_email are the server's (the clock and the JWT),
--     and an advance or reject is logged only by shortlist_decide (added by
--     20261009111000), with the status it sets. A direct insert could
--     backdate a row, name any actor, and log an advance or reject that never
--     changed a status.
--
-- Depends on: 20261009111000 (shortlist_decide, jd_text_scored). Safe to
-- re-run. No SECURITY DEFINER function.
-- Verify: src/test/a-shortlist-record-could-be-rewritten-and-scored-a-jd-it-never-kept.test.ts
-- runs this file in pglite after 20261009111000; the DO block below checks the
-- live catalogue.

-- ── Candidates: SELECT and status for owners; everything else the service role's
REVOKE ALL ON public.shortlist_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shortlist_candidates TO authenticated;
GRANT UPDATE (status) ON public.shortlist_candidates TO authenticated;
GRANT ALL ON public.shortlist_candidates TO service_role;
DROP POLICY IF EXISTS "owners insert own candidates" ON public.shortlist_candidates;

CREATE OR REPLACE FUNCTION public.shortlist_candidates_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'A Shortlist evaluation is immutable; only its status changes, through shortlist_decide'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM public.shortlist_decisions d
     WHERE d.candidate_id = NEW.id
       AND d.owner_id = NEW.owner_id
       AND d.action IN ('advance', 'reject')
       AND d.new_value = NEW.status
       AND d.created_at = now()
  ) THEN
    RAISE EXCEPTION 'A status change needs its logged decision in the same transaction (shortlist_decide)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_candidates_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shortlist_candidates_guard ON public.shortlist_candidates;
CREATE TRIGGER shortlist_candidates_guard
  BEFORE UPDATE ON public.shortlist_candidates
  FOR EACH ROW EXECUTE FUNCTION public.shortlist_candidates_guard();

-- ── Decisions: still INSERT + SELECT only, and only against one's own candidate
DROP POLICY IF EXISTS "owners insert own decisions" ON public.shortlist_decisions;
CREATE POLICY "owners insert own decisions" ON public.shortlist_decisions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (SELECT 1 FROM public.shortlist_candidates c WHERE c.id = candidate_id AND c.owner_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.shortlist_decisions_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  NEW.created_at := now();
  NEW.actor_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  IF NEW.action IN ('advance', 'reject')
     AND coalesce(current_setting('shortlist.deciding', true), '') IS DISTINCT FROM NEW.candidate_id::text THEN
    RAISE EXCEPTION 'An advance or reject is logged only with the status it sets, through shortlist_decide'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_decisions_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shortlist_decisions_stamp ON public.shortlist_decisions;
CREATE TRIGGER shortlist_decisions_stamp
  BEFORE INSERT ON public.shortlist_decisions
  FOR EACH ROW EXECUTE FUNCTION public.shortlist_decisions_stamp();

-- ── Self-check: raise if any of it did not land
DO $check$
BEGIN
  IF to_regprocedure('public.shortlist_decide(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'shortlist_decide missing: apply 20261009111000 first';
  END IF;
  IF has_table_privilege('authenticated', 'public.shortlist_candidates', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated can still insert Shortlist evaluations';
  END IF;
  IF has_column_privilege('authenticated', 'public.shortlist_candidates', 'score', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.shortlist_candidates', 'signals', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can still rewrite an AI column';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.shortlist_candidates', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated lost the status column a decision sets';
  END IF;
  IF has_table_privilege('anon', 'public.shortlist_candidates', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read Shortlist evaluations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shortlist_candidates_guard' AND tgrelid = 'public.shortlist_candidates'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'shortlist_candidates_guard trigger missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shortlist_decisions_stamp' AND tgrelid = 'public.shortlist_decisions'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'shortlist_decisions_stamp trigger missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.shortlist_candidates_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.shortlist_decisions_stamp()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a Shortlist trigger function is callable by a client';
  END IF;
END
$check$;
