-- A STAGING TABLE ANYONE CAN REWRITE RUNS AS THE DEFINER.
--
-- WHAT WAS FOUND (2026-09-15, read-only, with the public anon key that every
-- visitor's browser carries). The deploy runner applies this repo's
-- migrations by staging each file's text in public._mig_stage and executing
-- it through public._mig_exec(p_sql text), a SECURITY DEFINER function
-- (drizzle/migrations/0020_mig_exec_helper.sql). The function is revoked from
-- anon and authenticated by name (0021, 0023) and answers 42501 to both. The
-- TABLE it reads from was not: as anon,
--
--   GET   /rest/v1/_mig_stage?select=name,applied_at,sql   -> 200, eight rows,
--         the full SQL of every migration applied that day;
--   PATCH /rest/v1/_mig_stage?name=eq.<no such row>        -> 204 (UPDATE granted);
--   DELETE                                                 -> 204 (DELETE granted);
--   POST  with name = NULL                                 -> 23502, the NOT NULL
--         constraint -- the row reached the table, so INSERT is granted too.
--
-- Nothing was written by the probes: the filters matched no row and the
-- insert violated the primary key before it landed. But the path is real:
-- the runner's wrapper reads `SELECT sql FROM public._mig_stage WHERE name =
-- '<file>'` and hands it to the definer. Every migration file name is public
-- (the repo is), so a visitor who UPDATEs the `sql` of a staged row -- or
-- INSERTs a row under the name of a file that is not yet applied -- has their
-- text executed as the function's owner the next time the runner applies that
-- name. That is the definer-exposure incident (20260821: 107 of 121 definer
-- functions anon-callable) with the SQL supplied from outside.
--
-- WHY THE OTHER EIGHT TABLES PROBED ARE NOT THIS. job_board_board_state,
-- job_board_board_watch, job_board_click_rollup, job_board_company_dim_snapshots,
-- job_board_company_flow, job_board_exit_rollup, job_board_field_changes and
-- job_board_search_rollup all answered 200 [] and 204 to the same probes. Each
-- has ROW LEVEL SECURITY enabled with no client policy in the migration that
-- created it, so an anon SELECT returns no rows and an anon UPDATE touches
-- none: a 200 [] under RLS is indistinguishable from an open empty table from
-- outside, and is not a finding. _mig_stage answered 200 WITH ROWS, which no
-- RLS-locked table can. (The lifecycle-moat lesson in reverse: a permission
-- probe proves exposure only when it returns data or moves a row.)
--
-- WHAT THIS FILE DOES, idempotently and only where the objects exist (this
-- repo does not create them; the runner does):
--   * REVOKE ALL on _mig_stage and _mig_probe FROM PUBLIC, anon AND
--     authenticated -- by name, because revoking from PUBLIC alone leaves a
--     direct grant standing (revoking-from-public-does-not-revoke-from-anon);
--   * ENABLE ROW LEVEL SECURITY on both and drop every existing policy, so a
--     grant that comes back later still shows nothing;
--   * GRANT ALL to service_role (bypasses RLS) and, when the role exists, to
--     sandbox_exec -- the role the runner's helper is granted to while it
--     applies (0020/0022) -- with an explicit policy for it, so the runner
--     keeps working whether or not that role bypasses RLS;
--   * re-assert the helper's own REVOKE by name, harmless if already so.
--
-- WHAT IT DOES NOT DO. It does not drop the helper or the table: they are the
-- runner's, and this repo's migrations reach production only through them.
-- The runner should stop reading SQL out of a table at all -- inline text in
-- the wrapper, as 0033 does -- and that request goes in the deploy note, not
-- here. Harness: scripts/verify-migration-20260915090000.mjs. Guard:
-- src/test/the-deploy-runner-read-a-table-anyone-could-write.test.ts.

DO $lock$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['_mig_stage', '_mig_probe'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'public.% does not exist here; nothing to lock', t;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO sandbox_exec', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO sandbox_exec USING (true) WITH CHECK (true)', t || '_runner_only', t);
    END IF;
  END LOOP;

  IF to_regprocedure('public._mig_exec(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public._mig_exec(text) FROM PUBLIC, anon, authenticated;
  END IF;
END
$lock$;
