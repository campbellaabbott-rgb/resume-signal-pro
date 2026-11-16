-- S14X-073, RULE A (the owner's decision of 2026-11-15): AN EMPLOYER DELETES A
-- SHORTLIST CANDIDATE OR A ROLE, AND WHATEVER IS STILL HELD FOUR YEARS AFTER
-- IT WAS UPLOADED IS DELETED.
--
-- Before this file no client role could delete a Shortlist record (no DELETE
-- grant, no DELETE policy), nothing ever expired, and the page promised a
-- four-year retention that no job kept.
--
-- 1. THE EMPLOYER'S DELETE. DELETE on shortlist_roles and shortlist_candidates
--    for the owner's own rows (RLS), through shortlist_delete_candidate and
--    shortlist_delete_role (SECURITY INVOKER: the caller's own grants and RLS,
--    and the owner check written out again) or a plain REST delete. The
--    foreign keys cascade: a role takes its candidates and its notices, a
--    candidate takes its decisions.
-- 2. THE DELETIONS LOG. Which role and candidate ids went, when, when each
--    was uploaded, and whether the employer or the purge deleted them. No
--    resume text and no file name. A trigger writes it, so no path deletes
--    without a record; the owner may read their own rows and no client role
--    may write one. Closing an account takes its log with it: the trigger
--    writes nothing for an owner who is already gone.
-- 3. THE PURGE. shortlist_purge_expired() deletes candidates uploaded more
--    than four years ago and notices logged more than four years ago, in
--    batches, daily at 04:23 UTC with a statement_timeout of its own. A role
--    is the employer's own job description and stays until they delete it.
--
-- Depends on: the Shortlist tables and grants (20260704160023) and
-- 20261112210000 (shortlist_notices.logged_at). Safe to re-run.
-- Verify: src/test/an-employer-deletes-a-shortlist-candidate-or-role-and-four-year-old-records-go.test.ts
-- runs this file in pglite from Supabase's default grants; the DO block at
-- the end checks the live catalogue.

-- ── 1. The employer's delete
GRANT DELETE ON public.shortlist_roles TO authenticated;
GRANT DELETE ON public.shortlist_candidates TO authenticated;
DROP POLICY IF EXISTS "owners delete own roles" ON public.shortlist_roles;
CREATE POLICY "owners delete own roles" ON public.shortlist_roles
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners delete own candidates" ON public.shortlist_candidates;
CREATE POLICY "owners delete own candidates" ON public.shortlist_candidates
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- ── 2. The deletions log
CREATE TABLE IF NOT EXISTS public.shortlist_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  what text NOT NULL CHECK (what IN ('candidate', 'role')),
  how text NOT NULL CHECK (how IN ('employer', 'purge')),
  role_id uuid NOT NULL,
  candidate_id uuid,
  uploaded_at timestamptz,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shortlist_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shortlist_deletions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shortlist_deletions TO authenticated;
GRANT ALL ON public.shortlist_deletions TO service_role;
DROP POLICY IF EXISTS "owners read own deletions" ON public.shortlist_deletions;
CREATE POLICY "owners read own deletions" ON public.shortlist_deletions
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS shortlist_deletions_owner_idx ON public.shortlist_deletions (owner_id, deleted_at DESC);

CREATE OR REPLACE FUNCTION public.shortlist_log_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_how text := CASE WHEN coalesce(current_setting('shortlist.purging', true), '') = 'on' THEN 'purge' ELSE 'employer' END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.owner_id) THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'shortlist_roles' THEN
    INSERT INTO public.shortlist_deletions (owner_id, what, how, role_id, candidate_id, uploaded_at)
    VALUES (OLD.owner_id, 'role', v_how, OLD.id, NULL, OLD.created_at);
  ELSE
    INSERT INTO public.shortlist_deletions (owner_id, what, how, role_id, candidate_id, uploaded_at)
    VALUES (OLD.owner_id, 'candidate', v_how, OLD.role_id, OLD.id, OLD.created_at);
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_log_deletion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shortlist_roles_log_deletion ON public.shortlist_roles;
CREATE TRIGGER shortlist_roles_log_deletion
  AFTER DELETE ON public.shortlist_roles
  FOR EACH ROW EXECUTE FUNCTION public.shortlist_log_deletion();
DROP TRIGGER IF EXISTS shortlist_candidates_log_deletion ON public.shortlist_candidates;
CREATE TRIGGER shortlist_candidates_log_deletion
  AFTER DELETE ON public.shortlist_candidates
  FOR EACH ROW EXECUTE FUNCTION public.shortlist_log_deletion();

CREATE OR REPLACE FUNCTION public.shortlist_delete_candidate(p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_role uuid;
BEGIN
  DELETE FROM public.shortlist_candidates c
   WHERE c.id = p_candidate_id AND c.owner_id = auth.uid()
  RETURNING c.role_id INTO v_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That candidate was not found in your roles, so nothing was deleted' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('deleted', p_candidate_id, 'role_id', v_role);
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_delete_candidate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shortlist_delete_candidate(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shortlist_delete_role(p_role_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*)::integer INTO v_n FROM public.shortlist_candidates c
   WHERE c.role_id = p_role_id AND c.owner_id = auth.uid();
  DELETE FROM public.shortlist_roles r WHERE r.id = p_role_id AND r.owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That role was not found in your account, so nothing was deleted' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('deleted', p_role_id, 'candidates', v_n);
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_delete_role(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shortlist_delete_role(uuid) TO authenticated, service_role;

-- ── 3. The purge
CREATE OR REPLACE FUNCTION public.shortlist_purge_expired(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_cut timestamptz := p_now - interval '4 years';
  v_candidates integer := 0;
  v_notices integer := 0;
  v_batch integer;
  v_round integer := 0;
BEGIN
  PERFORM set_config('shortlist.purging', 'on', true);
  LOOP
    DELETE FROM public.shortlist_candidates c
     WHERE c.id IN (SELECT x.id FROM public.shortlist_candidates x WHERE x.created_at < v_cut LIMIT 1000);
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_candidates := v_candidates + v_batch;
    v_round := v_round + 1;
    EXIT WHEN v_batch < 1000 OR v_round >= 50;
  END LOOP;
  DELETE FROM public.shortlist_notices n WHERE coalesce(n.logged_at, n.sent_at) < v_cut;
  GET DIAGNOSTICS v_notices = ROW_COUNT;
  PERFORM set_config('shortlist.purging', '', true);
  RETURN jsonb_build_object('candidates', v_candidates, 'notices', v_notices, 'uploaded_before', v_cut);
END
$fn$;
REVOKE ALL ON FUNCTION public.shortlist_purge_expired(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shortlist_purge_expired(timestamptz) TO service_role;

COMMENT ON FUNCTION public.shortlist_purge_expired(timestamptz) IS
  'Daily (shortlist-four-year-purge): deletes Shortlist candidates uploaded more than four years ago (their decisions go with them) and notices logged more than four years ago; each candidate deleted is logged in shortlist_deletions as the purge. S14X-073 rule A.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; shortlist-four-year-purge is not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule('shortlist-four-year-purge', '23 4 * * *',
    'SET statement_timeout = ''2min''; SELECT public.shortlist_purge_expired();');
END $$;

-- ── SELF-CHECK: raise if any of it did not land
DO $check$
DECLARE
  v_bad text[] := ARRAY[]::text[];
  v_sig text;
  v_oid oid;
  v_cmd text;
  v_p text;
BEGIN
  IF to_regclass('public.shortlist_deletions') IS NULL THEN
    RAISE EXCEPTION 'shortlist_deletions missing';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.shortlist_deletions'::regclass) THEN
    v_bad := v_bad || 'shortlist_deletions has row level security off'::text;
  END IF;
  FOREACH v_p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege('anon', 'public.shortlist_deletions', v_p) THEN
      v_bad := v_bad || format('anon holds %s on shortlist_deletions', v_p);
    END IF;
  END LOOP;
  FOREACH v_p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege('authenticated', 'public.shortlist_deletions', v_p) THEN
      v_bad := v_bad || format('authenticated holds %s on shortlist_deletions', v_p);
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.shortlist_roles', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.shortlist_candidates', 'DELETE') THEN
    v_bad := v_bad || 'authenticated cannot delete its own roles or candidates'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.shortlist_roles'::regclass AND polname = 'owners delete own roles' AND polcmd = 'd')
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.shortlist_candidates'::regclass AND polname = 'owners delete own candidates' AND polcmd = 'd') THEN
    v_bad := v_bad || 'an owner delete policy is missing'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shortlist_roles_log_deletion' AND tgrelid = 'public.shortlist_roles'::regclass AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shortlist_candidates_log_deletion' AND tgrelid = 'public.shortlist_candidates'::regclass AND NOT tgisinternal) THEN
    v_bad := v_bad || 'a deletion log trigger is missing'::text;
  END IF;

  FOREACH v_sig IN ARRAY ARRAY['public.shortlist_delete_candidate(uuid)', 'public.shortlist_delete_role(uuid)', 'public.shortlist_purge_expired(timestamptz)', 'public.shortlist_log_deletion()'] LOOP
    v_oid := to_regprocedure(v_sig)::oid;
    IF v_oid IS NULL THEN
      v_bad := v_bad || format('%s is missing', v_sig);
      CONTINUE;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      v_bad := v_bad || format('%s is executable by anon', v_sig);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
                    WHERE p.oid = v_oid AND c.setting LIKE 'search_path=%') THEN
      v_bad := v_bad || format('%s has no search_path of its own', v_sig);
    END IF;
  END LOOP;
  IF to_regprocedure('public.shortlist_delete_candidate(uuid)') IS NOT NULL THEN
    IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.shortlist_delete_candidate(uuid)'::regprocedure)
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.shortlist_delete_role(uuid)'::regprocedure)
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.shortlist_purge_expired(timestamptz)'::regprocedure) THEN
      v_bad := v_bad || 'a Shortlist delete or the purge runs with its owner''s rights; each must run with the caller''s'::text;
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.shortlist_delete_candidate(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.shortlist_delete_role(uuid)', 'EXECUTE') THEN
      v_bad := v_bad || 'a signed-in employer cannot run the deletes'::text;
    END IF;
    IF has_function_privilege('authenticated', 'public.shortlist_purge_expired(timestamptz)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.shortlist_log_deletion()', 'EXECUTE') THEN
      v_bad := v_bad || 'a signed-in client can run the purge or the log trigger'::text;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.shortlist_log_deletion()'::regprocedure) THEN
      v_bad := v_bad || 'the deletion log trigger cannot write the log a client may not write'::text;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    EXECUTE $q$SELECT j.command FROM cron.job j WHERE j.jobname = 'shortlist-four-year-purge'$q$ INTO v_cmd;
    IF v_cmd IS NULL THEN
      v_bad := v_bad || 'no shortlist-four-year-purge job'::text;
    ELSIF v_cmd !~* '^[[:space:]]*SET[[:space:]]+statement_timeout[[:space:]]*=' OR position('public.shortlist_purge_expired()' IN v_cmd) = 0 THEN
      v_bad := v_bad || format('shortlist-four-year-purge runs %s; it must set its statement_timeout first and call public.shortlist_purge_expired()', v_cmd);
    END IF;
  END IF;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION 'S14X-073 rule A did not land: %', array_to_string(v_bad, '; ');
  END IF;
END
$check$;
