-- A SHORTLIST EVALUATION CANNOT BE REWRITTEN, AND A STATUS CHANGES ONLY WITH
-- ITS DECISION (sweep S8-041, S8-110): THE ADDITIVE HALF.
--
-- SPLIT IN TWO (register S11-056). This file used to revoke client INSERT on
-- shortlist_candidates in the same breath as it added what the new code
-- needs. The ledger applies migrations before functions, and the LIVE
-- shortlist-evaluate (2026-10-10.1) scores a candidate with a paid model call
-- and then inserts the row through the employer's own JWT; the live page
-- logs a decision and PATCHes the status in two calls. With the revoke and
-- the guard triggers landed first, every evaluation failed with 42501 after
-- its model call and every advance or reject was refused and dropped, for the
-- whole deploy window. Deploying the functions first fails too: the new
-- shortlist-evaluate writes jd_text_scored, which only this file adds.
--
-- So this half is ADDITIVE ONLY and goes before the functions: nothing the
-- live function or page does is refused by it. The revoke, the policy drop
-- and the guard and stamp triggers are 20261009112000, held in
-- docs/deploy-ledger.json until the new shortlist-evaluate serves and the
-- published page decides through shortlist_decide.
--
-- S8-110. shortlist-evaluate scored the JD the request body sent, and the row
-- recorded only shortlist_roles.jd_version, which nothing ever bumped when the
-- owner edited jd_text over REST. jd_version is now the server's: 1 on insert,
-- +1 whenever jd_text changes, never what the client sends. And each new
-- evaluation stores the exact JD text it was scored against (jd_text_scored).
--
-- S8-041 (the part that adds). shortlist_decide() (SECURITY INVOKER: the
-- caller's own grants and RLS) writes a decision and the status it sets in one
-- transaction and raises what the page shows. Until 20261009112000 lands it
-- runs under the old grants, which already let the owner do both writes.
--
-- Depends on: shortlist tables (20260703120000), their grants
-- (20260704160023). Safe to re-run. No SECURITY DEFINER function.
-- Verify: src/test/a-shortlist-record-could-be-rewritten-and-scored-a-jd-it-never-kept.test.ts
-- runs this file in pglite, alone and with 20261009112000; the DO block below
-- checks the live catalogue.

ALTER TABLE public.shortlist_candidates ADD COLUMN IF NOT EXISTS jd_text_scored text;

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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shortlist_candidates' AND column_name = 'jd_text_scored') THEN
    RAISE EXCEPTION 'shortlist_candidates.jd_text_scored missing';
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
  IF has_function_privilege('anon', 'public.shortlist_roles_jd_version()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.shortlist_roles_jd_version()', 'EXECUTE') THEN
    RAISE EXCEPTION 'shortlist_roles_jd_version is callable by a client';
  END IF;
END
$check$;
