-- FOUR COMPANY TABLES ARE READ THROUGH THEIR READERS, NEVER BY A CLIENT.
--
-- Lovable's security scan flags public.showcase_excluded,
-- public.company_profiles, public.company_financials and
-- public.company_name_overrides as client-readable, and it is right: each was
-- created with a SELECT policy USING (true) and a GRANT SELECT to anon and
-- authenticated (20260721034113, 20260721330000/20260722161307,
-- 20260721340000/20260722154604, 20260722234500/20260723021844), so the
-- published anon key reads every row straight off PostgREST:
--
--   GET /rest/v1/company_financials?select=slug,ticker,series
--   GET /rest/v1/showcase_excluded?select=company_token,reason
--
-- That hands out the editorial exclusion list with its reasons, every SEC
-- match we made (including the ones 20261012101000 stopped attaching to the
-- wrong board), the undated headcounts and the name overrides, and it lets a
-- client read past the rules the readers apply (the hiring-system key, the
-- collision rule, the headcount date).
--
-- EVERY READER, PROVED BEFORE THE DOOR CLOSES (accuracy builder, 2026-10-12):
--
--   * The browser reads none of the four tables directly. src/ holds no
--     .from() on any of them; the company page reads them only through
--     get_company_intel, get_company_financials and get_similar_companies,
--     all SECURITY DEFINER with SET search_path (20261012101000), executable
--     by anon because the page calls them as anon.
--   * Edge functions: job-board reads showcase_excluded with the service-role
--     client (the hot-tier exclusion); nothing else reads them.
--   * SQL: the latest definition of every function that names one of the
--     four is SECURITY DEFINER -- get_actively_hiring_companies,
--     get_board_velocity, get_company_financials, get_company_growth,
--     get_company_intel, get_entry_level_companies, get_explore_denominators,
--     get_hiring_trends, get_newest_companies, get_pay_transparency,
--     get_relisting_employers, get_similar_companies,
--     get_size_segment_companies, get_size_segments,
--     get_transparent_employers, get_trending_categories,
--     get_trending_companies -- except apply_company_name_override, the
--     BEFORE INSERT OR UPDATE trigger on job_board_postings, which runs with
--     the writer's rights. Its writers are the service role (job-board) and
--     definer functions owned by the table owner; no client can write
--     job_board_postings (20260827130000), so the trigger never runs as one.
--   * No view reads any of the four.
--
-- So nothing a client does today needs a table grant, and the lock below
-- takes none away from a reader. The self-check at the foot proves it on the
-- database it runs on, not on this list: it finds every function whose body
-- names one of the four tables, requires each to be a definer whose owner can
-- read the table (or a trigger function, or one no client can execute), and
-- calls the three company-page readers AS ANON.
--
-- WHAT CHANGES: row level security on (it already is, but a table that lost
-- it is re-locked), every policy that admits PUBLIC, anon or authenticated
-- dropped (found in the catalogue, not by a hand-listed name, because the live
-- database has held objects no migration describes), every table and column
-- privilege revoked from PUBLIC, anon and authenticated, and ALL kept for the
-- service role, which job-board reads with and the owner's tooling writes
-- with. Safe to run twice.
--
-- LOCKS. DROP POLICY takes ACCESS EXCLUSIVE on its table, and the name
-- override trigger reads company_name_overrides inside every ingest write, so
-- a migration queued behind a long read would queue ingest behind itself.
-- lock_timeout makes it give up instead; re-running it is safe.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

DO $$
DECLARE
  t text;
  pol record;
  col record;
BEGIN
  FOREACH t IN ARRAY ARRAY['showcase_excluded', 'company_profiles', 'company_financials', 'company_name_overrides'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'public.% does not exist here: nothing to lock', t;
      CONTINUE;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
    -- Every policy a client role could pass, by catalogue, not by name.
    FOR pol IN
      SELECT p.policyname
        FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t
         AND (p.roles && ARRAY['public', 'anon', 'authenticated']::name[])
    LOOP
      RAISE NOTICE 'dropping policy % on public.% (it admitted a client role)', pol.policyname, t;
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    -- A table-level REVOKE (below, by name) leaves column-level grants
    -- standing; revoke those the catalogue still holds, column by column.
    FOR col IN
      SELECT DISTINCT cp.column_name, cp.grantee
        FROM information_schema.column_privileges cp
       WHERE cp.table_schema = 'public' AND cp.table_name = t
         AND cp.grantee IN ('PUBLIC', 'anon', 'authenticated')
    LOOP
      EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM %s', col.column_name, t,
                     CASE WHEN col.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(col.grantee) END);
    END LOOP;
  END LOOP;
END $$;

-- Supabase's default grants give a new public table ALL for anon and
-- authenticated, and a GRANT never takes any of that away: all of it is
-- revoked, from all three grantees, by name, and the service role keeps ALL.
REVOKE ALL ON TABLE public.showcase_excluded FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.company_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.company_financials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.company_name_overrides FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.showcase_excluded TO service_role;
GRANT ALL ON TABLE public.company_profiles TO service_role;
GRANT ALL ON TABLE public.company_financials TO service_role;
GRANT ALL ON TABLE public.company_name_overrides TO service_role;

COMMENT ON TABLE public.company_financials IS
  'SEC figures matched to a board. NOT client-readable (20261012130000): no '
  'client policy and no anon or authenticated grant. Read it through '
  'get_company_financials (SECURITY DEFINER, anon-callable), which attaches a '
  'row only to the hiring system it was matched for.';
COMMENT ON TABLE public.showcase_excluded IS
  'Boards left out of the showcase lists, with the reason. NOT client-readable '
  '(20261012130000): the definer leaderboards and job-board (service role) '
  'read it; no client does.';
COMMENT ON TABLE public.company_name_overrides IS
  'Token or Workday tenant slug to display name, applied by the '
  'apply_company_name_override trigger on job_board_postings. NOT '
  'client-readable (20261012130000): the trigger runs with the writer''s '
  'rights, and only the service role and definer functions write that table.';

-- SELF-CHECK. Raises, and so rolls every statement above back, unless:
--   1. no client role holds any table or column privilege on the four tables,
--      no policy admits one, and row level security is on;
--   2. the service role can still read and write them;
--   3. every function whose body names one of them can still read it: a
--      SECURITY DEFINER whose owner holds SELECT, a trigger function, or a
--      function no client role can execute (an INVOKER reader a client can
--      call would start failing the moment this file commits);
--   4. the three readers the company page calls as anon still answer as anon,
--      and a direct read as anon is refused.
DO $$
DECLARE
  t text;
  r text;
  priv text;
  n int;
  bad text;
  denied boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['showcase_excluded', 'company_profiles', 'company_financials', 'company_name_overrides'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'self-check 20261012130000: row level security is off on public.%', t;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(r, 'public.' || t, priv) THEN
          RAISE EXCEPTION 'self-check 20261012130000: % still holds % on public.%', r, priv, t;
        END IF;
      END LOOP;
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
        IF has_any_column_privilege(r, 'public.' || t, priv) THEN
          RAISE EXCEPTION 'self-check 20261012130000: % still holds % on a column of public.%', r, priv, t;
        END IF;
      END LOOP;
    END LOOP;
    SELECT count(*) INTO n FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = t
       AND (p.roles && ARRAY['public', 'anon', 'authenticated']::name[]);
    IF n > 0 THEN
      RAISE EXCEPTION 'self-check 20261012130000: % polic(ies) on public.% still admit a client role', n, t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION 'self-check 20261012130000: the service role lost its grant on public.%', t;
    END IF;
  END LOOP;

  -- 20261012102000 added company_profiles.as_of; once a client cannot read
  -- the table, verify section 91 can no longer see the column, so it is
  -- checked here instead (the section reads this file's lock as the proof).
  IF to_regclass('public.company_profiles') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'company_profiles' AND column_name = 'as_of') THEN
    RAISE EXCEPTION 'self-check 20261012130000: company_profiles.as_of is missing (20261012102000 not applied)';
  END IF;

  -- 3. Every function that names one of the four tables can still read it.
  SELECT string_agg(format('%s (%s)', p.oid::regprocedure, CASE WHEN p.prosecdef THEN 'definer whose owner cannot read the table' ELSE 'invoker a client can execute' END), '; ')
    INTO bad
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prokind = 'f'
     AND p.prosrc ~ '\m(showcase_excluded|company_profiles|company_financials|company_name_overrides)\M'
     AND p.prorettype <> 'trigger'::regtype
     AND (
       (p.prosecdef AND EXISTS (
          SELECT 1 FROM unnest(ARRAY['showcase_excluded', 'company_profiles', 'company_financials', 'company_name_overrides']) tb(name)
           WHERE to_regclass('public.' || tb.name) IS NOT NULL
             AND p.prosrc ~ ('\m' || tb.name || '\M')
             AND NOT COALESCE(has_table_privilege(p.proowner, to_regclass('public.' || tb.name), 'SELECT'), true)))
       OR (NOT p.prosecdef AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                                OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261012130000: these readers would stop working once a client cannot read the tables: %', bad;
  END IF;

  -- 4. The company page's three readers, as anon, and a direct read refused.
  IF to_regprocedure('public.get_company_intel(text)') IS NOT NULL THEN
    IF NOT has_function_privilege('anon', 'public.get_company_intel(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check 20261012130000: anon cannot execute get_company_intel, which the company page calls as anon';
    END IF;
    SET LOCAL ROLE anon;
    PERFORM public.get_company_intel('20261012130000-self-check');
    RESET ROLE;
  END IF;
  IF to_regprocedure('public.get_company_financials(text)') IS NOT NULL THEN
    IF NOT has_function_privilege('anon', 'public.get_company_financials(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check 20261012130000: anon cannot execute get_company_financials, which the company page calls as anon';
    END IF;
    SET LOCAL ROLE anon;
    PERFORM public.get_company_financials('20261012130000-self-check');
    RESET ROLE;
  END IF;
  IF to_regprocedure('public.get_similar_companies(text,integer)') IS NOT NULL THEN
    IF NOT has_function_privilege('anon', 'public.get_similar_companies(text,integer)', 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check 20261012130000: anon cannot execute get_similar_companies, which the company page calls as anon';
    END IF;
    SET LOCAL ROLE anon;
    PERFORM * FROM public.get_similar_companies('20261012130000-self-check', 1);
    RESET ROLE;
  END IF;
  FOREACH t IN ARRAY ARRAY['showcase_excluded', 'company_profiles', 'company_financials', 'company_name_overrides'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    denied := false;
    SET LOCAL ROLE anon;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    RESET ROLE;
    IF NOT denied THEN
      RAISE EXCEPTION 'self-check 20261012130000: anon can still read public.% directly', t;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
