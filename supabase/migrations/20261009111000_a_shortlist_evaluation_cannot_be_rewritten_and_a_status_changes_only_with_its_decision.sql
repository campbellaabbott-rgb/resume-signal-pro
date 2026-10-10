-- A SHORTLIST EVALUATION CANNOT BE REWRITTEN, AND A STATUS CHANGES ONLY WITH
-- ITS DECISION (sweep S8-041, S8-110).
--
-- S8-041. shortlist_candidates granted table-wide INSERT and UPDATE to
-- authenticated (20260704160023) under owner-only policies and no trigger.
-- The "immutable evaluation" COMPLIANCE.md sells as LL144/FEHA evidence was
-- not: an employer could PATCH score, signals, flags, redacted_text or
-- exclusions_applied, insert rows no model produced, and change status with
-- no decision row ("enforced in the app layer", 20260703120000). The page's
-- decide() wrote the decision and the status in two calls and read neither
-- result, and overrideScore() overwrote the AI score.
--   - INSERT is the service role's (shortlist-evaluate writes the row).
--   - authenticated may UPDATE the status column only, and the guard trigger
--     refuses any status change that has no advance/reject decision for the
--     same candidate written in the same transaction (created_at = now()),
--     and any change to another column.
--   - shortlist_decide() (SECURITY INVOKER: the caller's own grants and RLS)
--     writes the decision and the status in one transaction and raises what
--     the page shows. Overrides stay decisions; the score is never rewritten.
--   - a decision may be logged only against the caller's own candidate, its
--     created_at and actor_email are the server's (the clock and the JWT),
--     and an advance or reject is logged only by shortlist_decide, with the
--     status it sets. A direct insert could backdate a row, name any actor,
--     and log an advance or reject that never changed a status.
--
-- S8-110. shortlist-evaluate scored the JD the request body sent, and the row
-- recorded only shortlist_roles.jd_version, which nothing ever bumped when the
-- owner edited jd_text over REST. jd_version is now the server's: 1 on insert,
-- +1 whenever jd_text changes, never what the client sends. And each new
-- evaluation stores the exact JD text it was scored against (jd_text_scored).
--
-- Depends on: shortlist tables (20260703120000), their grants
-- (20260704160023). Safe to re-run. No SECURITY DEFINER function.
-- Verify: src/test/a-shortlist-record-could-be-rewritten-and-scored-a-jd-it-never-kept.test.ts
-- runs this file in pglite; the DO block below checks the live catalogue.

ALTER TABLE public.shortlist_candidates ADD COLUMN IF NOT EXISTS jd_text_scored text;

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

-- ── One transaction for a human decision and the status it sets
CREATE OR REPLACE FUNCTION public.shortlist_decide(p_candidate_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  c public.shortlist_candidates;
  v_new text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('advance', 'reject') THEN
    RAISE EXCEPTION 'Unknown decision: %', coalesce(p_action, 'null') USING ERRCODE = '22023';
  END IF;
  IF p_action = 'reject' AND coalesce(length(v_reason), 0) < 3 THEN
    RAISE EXCEPTION 'A brief reason is required to reject (it goes in the audit log)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.shortlist_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate not found' USING ERRCODE = 'P0002';
  END IF;
  v_new := CASE p_action WHEN 'advance' THEN 'advanced' ELSE 'rejected' END;
  PERFORM set_config('shortlist.deciding', c.id::text, true);
  INSERT INTO public.shortlist_decisions (candidate_id, owner_id, actor_email, action, old_value, new_value, reason)
  VALUES (c.id, c.owner_id, nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', p_action, c.status, v_new, v_reason)
  RETURNING id INTO v_id;
  PERFORM set_config('shortlist.deciding', '', true);
  UPDATE public.shortlist_candidates SET status = v_new WHERE id = c.id;
  RETURN jsonb_build_object('candidate_id', c.id, 'status', v_new, 'decision_id', v_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_decide(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shortlist_decide(uuid, text, text) TO authenticated, service_role;

-- ── jd_version is the server's
CREATE OR REPLACE FUNCTION public.shortlist_roles_jd_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.jd_version := 1;
  ELSIF NEW.jd_text IS DISTINCT FROM OLD.jd_text THEN
    NEW.jd_version := OLD.jd_version + 1;
  ELSE
    NEW.jd_version := OLD.jd_version;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_roles_jd_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shortlist_roles_jd_version ON public.shortlist_roles;
CREATE TRIGGER shortlist_roles_jd_version
  BEFORE INSERT OR UPDATE ON public.shortlist_roles
  FOR EACH ROW EXECUTE FUNCTION public.shortlist_roles_jd_version();

-- ── Self-check: raise if any of it did not land
DO $check$
BEGIN
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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shortlist_roles_jd_version' AND tgrelid = 'public.shortlist_roles'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'shortlist_roles_jd_version trigger missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.shortlist_decide(uuid,text,text)'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION 'shortlist_decide must run with the caller''s rights';
  END IF;
  IF has_function_privilege('anon', 'public.shortlist_decide(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.shortlist_decide(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'shortlist_decide grants are wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shortlist_candidates' AND column_name = 'jd_text_scored') THEN
    RAISE EXCEPTION 'shortlist_candidates.jd_text_scored missing';
  END IF;
END
$check$;
