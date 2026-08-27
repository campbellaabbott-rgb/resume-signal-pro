-- The paid API wall had an unlocked door beside it: the table itself.
--
-- job_board_postings has carried `CREATE POLICY ... FOR SELECT USING (true)`
-- since 20260711103500, plus `GRANT SELECT TO anon, authenticated`. The anon
-- key is published in the frontend bundle, so it is not a secret and was never
-- meant to be one. Together those three facts mean anyone could page the entire
-- corpus straight off PostgREST:
--
--   GET /rest/v1/job_board_postings?select=*&limit=1000&offset=...
--
-- Verified live on 2026-08-27 with the published anon key: full row access,
-- exact counts via Prefer: count=exact, arbitrary column projection, and no
-- limit but the statement timeout. 565,161 postings, free.
--
-- THAT IS THE PRODUCT. /v1 exists to meter exactly this: api_keys, api_usage,
-- api_rate, a free tier and a quota, all shipped over 2026-08-26. Every one of
-- those controls sits on the edge function, and none of them sit on the table
-- the edge function reads. A key wall that can be walked around is decoration.
--
-- IT ALSO BYPASSES BOTH FENCES. Every read path in the board carries
-- `missing_since IS NULL AND effective_posted >= now() - 30 days` so a visitor
-- can never be shown a posting the employer has withdrawn. A direct table read
-- carries whatever the caller asks for, including rows the board itself will
-- not serve.
--
-- WHY THE POLICY ALONE WAS NOT ENOUGH TO DROP. Six functions read this table as
-- SECURITY INVOKER, so they read it AS THE CALLER and would have started
-- returning empty the moment the policy went. They are the public stats
-- surfaces, and they fail SILENTLY under RLS — a dropped policy does not raise,
-- it filters to zero rows, which would have shown up as pages full of honest
-- zeroes rather than as an error anyone would notice:
--
--   get_entry_level_companies(integer)   get_salary_benchmarks()
--   get_entry_level_stats()              get_stale_board_count()
--   get_hiring_trends()                  get_trending_categories()
--
-- ALTER, NOT CREATE OR REPLACE. Re-issuing six bodies to change one keyword is
-- six chances to typo a query nobody will read again; ALTER FUNCTION changes
-- the security context and touches nothing else. Every one already carries
-- `SET search_path = public`, which is the part that makes DEFINER safe, and
-- ALTER leaves it in place.
--
-- This grants anon NO new visibility. These functions are already executable by
-- anon and already return these aggregates; the policy they were reading
-- through was USING (true), so definer and invoker saw exactly the same rows.
-- The only thing that changes is that they no longer depend on a policy this
-- migration is about to remove.
ALTER FUNCTION public.get_entry_level_companies(integer) SECURITY DEFINER;
ALTER FUNCTION public.get_entry_level_stats()            SECURITY DEFINER;
ALTER FUNCTION public.get_hiring_trends()                SECURITY DEFINER;
ALTER FUNCTION public.get_salary_benchmarks()            SECURITY DEFINER;
ALTER FUNCTION public.get_stale_board_count()            SECURITY DEFINER;
ALTER FUNCTION public.get_trending_categories()          SECURITY DEFINER;

-- REVOKE AS WELL AS DROP POLICY, because they fail differently and only one of
-- them fails loudly. With RLS on and no policy, a read returns ZERO ROWS and
-- HTTP 200 — indistinguishable from "the board is empty", which is the silent
-- failure this codebase has been bitten by repeatedly. Without the GRANT it is
-- 42501 permission denied, which says what happened. Belt and braces: the
-- policy is gone so a future GRANT cannot quietly re-open the table, and the
-- grant is gone so the current state is legible.
DROP POLICY IF EXISTS "job_board_postings_public_read" ON public.job_board_postings;
REVOKE SELECT ON public.job_board_postings FROM anon, authenticated;

-- service_role is untouched and keeps ALL: every edge function that reads this
-- table (job-board, public-api, scan-heartbeat, company-claim) authenticates
-- with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS and holds its own grant.
-- The three search RPCs (search_jobs, count_jobs_capped, fuzzy_title_search)
-- are SECURITY DEFINER and were already independent of this policy.

-- SELF-VERIFYING, because a security migration that silently does nothing is
-- worse than one that fails. Both halves are asserted and either one rolls the
-- whole thing back.
DO $$
DECLARE
  still_invoker text;
  denied        boolean := false;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ' ORDER BY p.proname) INTO still_invoker
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('get_entry_level_companies', 'get_entry_level_stats',
                       'get_hiring_trends', 'get_salary_benchmarks',
                       'get_stale_board_count', 'get_trending_categories')
     AND NOT p.prosecdef;
  IF still_invoker IS NOT NULL THEN
    RAISE EXCEPTION
      'still SECURITY INVOKER after ALTER, and they read a table anon can no longer see: %',
      still_invoker;
  END IF;

  -- And prove the door is actually shut, as anon, rather than trusting that
  -- DROP POLICY plus REVOKE added up to what they were supposed to add up to.
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.job_board_postings LIMIT 1;
  EXCEPTION
    WHEN insufficient_privilege THEN denied := true;
  END;
  RESET ROLE;

  IF NOT denied THEN
    RAISE EXCEPTION
      'anon can still read job_board_postings directly — the /v1 key wall is still walkable';
  END IF;
END $$;

COMMENT ON TABLE public.job_board_postings IS
  'The corpus. NOT anon-readable: SELECT is revoked from anon/authenticated and '
  'there is no SELECT policy, because the published anon key would otherwise let '
  'anyone page all 565k postings straight off PostgREST and walk around the /v1 '
  'metering entirely (verified live 2026-08-27). Read it through the job-board '
  'or public-api edge functions, which hold service_role, or through a SECURITY '
  'DEFINER RPC. A function added here that reads this table as INVOKER will '
  'return ZERO ROWS to anon, not an error.';
