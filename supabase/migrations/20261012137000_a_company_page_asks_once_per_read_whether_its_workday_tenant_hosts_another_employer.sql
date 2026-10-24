-- A COMPANY PAGE ASKS ONCE PER READ WHETHER ITS WORKDAY TENANT HOSTS ANOTHER
-- EMPLOYER (hotfix 2026-10-24, after the profiles + design verify).
--
-- WHAT WAS WRONG, measured live on 2026-10-24 at 21:57Z with the verifier's
-- anon GET: get_company_intel answered HTTP 500, code 57014 (statement
-- timeout), after 15.1 to 15.3 seconds on every Workday token tried --
-- cat~wd5~caterpillarcareers, nvidia~wd5~NVIDIAExternalCareerSite,
-- dollartree~wd5~dollartreeus, sysco~wd5~syscocareers,
-- meijer~wd5~Meijer_Stores_Hourly, and the made-up zzzz-none~wd1~Careers,
-- which has no postings at all -- while stripe and zzzz-none-plain answered
-- 200 in 0.3 seconds. 283 of the 485 company pages in the sitemap are Workday
-- pages. Each one lost its pay floor, fields, places, headcount and net-7d,
-- for readers (a 15-second shimmer, then nothing) and in the baked copy, and
-- each view cost the 4-core database a 15-second statement. The 2026-10-18
-- publish timed out on it.
--
-- WHY. 20261012135000 spliced its hosting-tenant test (the helper
-- public.workday_site_is_own_employer, called on the page's own token) into
-- get_company_intel and get_similar_companies as a plain call inside an OR:
-- the snapshot series' Workday arm, and the postings predicate. The helper is
-- a STABLE SQL function with its own search_path setting, so the planner
-- cannot inline it, and a call inside an OR arm is not a one-time filter: it
-- ran once for every snapshot row of the last eight days that reached the arm
-- (and once for every posting on a tenant's other sites), and every run was a
-- scan of company_name_overrides. That file expected one evaluation per call;
-- the planner gives that only to a test standing alone at the top of a WHERE.
--
-- THE FIX. Each reader asks once: a one-row MATERIALIZED CTE at the head of
-- its WITH (own_site) holds the helper's answer, and each place that tested it
-- reads that row through a scalar subquery, which the planner runs as an
-- InitPlan. One evaluation per call, however many rows the read touches. The
-- answer is the same boolean for every token, so every reply is unchanged,
-- and the index-served shapes of 20260827140000 and 20261012101000 are kept.
--
-- THE OTHER READERS, read for the same shape on 2026-10-24.
-- get_company_financials calls only employer_segment, which is IMMUTABLE with
-- no setting of its own and is inlined. get_company_fill_curve calls
-- board_multi_site_title_share once, in its FROM list, and its rows call
-- normalize_close_title on each title, which is per row by nature. No search
-- or list reader, and no other function in the migration lane, calls a
-- non-inlinable helper whose arguments are only its own parameters inside a
-- per-row predicate. So only these two readers change.
--
-- Rewritten FROM THE CATALOGUE, like 20261012135000 and 20261012136000. Each
-- reader's live body must carry the tests 20261012135000 wrote, exactly as
-- many times as it wrote them, and the one WITH 20261012101000 opened it
-- with, or the file refuses rather than overwrite a body it does not know. A
-- body that already asks once is left alone, so the file is safe to run
-- twice. Signature, return type, security, volatility, settings (search_path
-- and the 15-second timeout), owner and grants are compared before and after
-- the rewrite in the same block, and the grants are restated afterwards as
-- 20261012101000 wrote them.
--
-- Self-verifying: it refuses the per-row shape, an attribute that moved and a
-- grant that drifted. Safe to re-run.

SET LOCAL statement_timeout = '2min';

DO $mig$
DECLARE
  v_call  text := 'workday_site_is_own_employer(';
  v_bare  text := 'NOT public.workday_site_is_own_employer(p_token)';
  v_once  text := 'NOT (SELECT own_site.own FROM own_site)';
  v_with  text := 'WITH own_sources AS MATERIALIZED (';
  v_cte   text := E'WITH own_site AS MATERIALIZED (\n    SELECT public.workday_site_is_own_employer(p_token) AS own\n  ),\n  own_sources AS MATERIALIZED (';
  r       record;
  v_def   text;
  v_new   text;
  v_pre   text;
  v_post  text;
  n_call  int;
  n_bare  int;
  n_with  int;
BEGIN
  IF to_regprocedure('public.workday_site_is_own_employer(text)') IS NULL THEN
    RAISE EXCEPTION 'workday_site_is_own_employer(text) is missing: apply 20261012135000 first';
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('public.get_company_intel(text)', 2),
      ('public.get_similar_companies(text,integer)', 1)
    ) AS t(fn, uses)
  LOOP
    IF to_regprocedure(r.fn) IS NULL THEN
      RAISE EXCEPTION '% does not exist: this file rewrites a live reader and creates none', r.fn;
    END IF;
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position('own_site AS MATERIALIZED (' IN v_def) > 0 THEN
      RAISE NOTICE '% already asks once per call whether its tenant hosts another employer', r.fn;
      CONTINUE;
    END IF;
    n_call := (length(v_def) - length(replace(v_def, v_call, ''))) / length(v_call);
    n_bare := (length(v_def) - length(replace(v_def, v_bare, ''))) / length(v_bare);
    n_with := (length(v_def) - length(replace(v_def, v_with, ''))) / length(v_with);
    IF n_bare <> r.uses OR n_call <> r.uses OR n_with <> 1 THEN
      RAISE EXCEPTION '%: expected the 20261012135000 body (% hosting-tenant test(s) and one WITH own_sources), found % test(s), % helper call(s) and % such WITH; it drifted -- read pg_get_functiondef and fold this fix in rather than overwrite it',
        r.fn, r.uses, n_bare, n_call, n_with;
    END IF;

    SELECT concat_ws(' | ', p.prorettype::regtype::text, pg_get_function_identity_arguments(p.oid),
                     'definer=' || p.prosecdef::text, 'volatile=' || p.provolatile::text,
                     'parallel=' || p.proparallel::text, 'strict=' || p.proisstrict::text,
                     'config=' || COALESCE(array_to_string(p.proconfig, ','), ''),
                     'owner=' || p.proowner::regrole::text, 'acl=' || COALESCE(p.proacl::text, ''))
      INTO v_pre
      FROM pg_proc p WHERE p.oid = r.fn::regprocedure;

    v_new := replace(replace(v_def, v_bare, v_once), v_with, v_cte);
    EXECUTE v_new;

    SELECT concat_ws(' | ', p.prorettype::regtype::text, pg_get_function_identity_arguments(p.oid),
                     'definer=' || p.prosecdef::text, 'volatile=' || p.provolatile::text,
                     'parallel=' || p.proparallel::text, 'strict=' || p.proisstrict::text,
                     'config=' || COALESCE(array_to_string(p.proconfig, ','), ''),
                     'owner=' || p.proowner::regrole::text, 'acl=' || COALESCE(p.proacl::text, ''))
      INTO v_post
      FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    IF v_post IS DISTINCT FROM v_pre THEN
      RAISE EXCEPTION '%: the rewrite moved an attribute (before: %; after: %)', r.fn, v_pre, v_post;
    END IF;
  END LOOP;
END
$mig$;

REVOKE ALL ON FUNCTION public.get_company_intel(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_similar_companies(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_intel(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_similar_companies(text, integer) TO anon, authenticated, service_role;

DO $verify$
DECLARE
  v_call  text := 'workday_site_is_own_employer(';
  v_once  text := '(SELECT own_site.own FROM own_site)';
  v_head  text := E'own_site AS MATERIALIZED (\n    SELECT public.workday_site_is_own_employer(p_token) AS own\n  )';
  r       record;
  v_def   text;
  n_call  int;
  n_once  int;
  v_t0    timestamptz;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.get_company_intel(text)', 2),
      ('public.get_similar_companies(text,integer)', 1)
    ) AS t(fn, uses)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n_call := (length(v_def) - length(replace(v_def, v_call, ''))) / length(v_call);
    n_once := (length(v_def) - length(replace(v_def, v_once, ''))) / length(v_once);
    IF n_call <> 1 OR position(v_head IN v_def) = 0 THEN
      RAISE EXCEPTION 'self-check 20261012137000: % calls the hosting-tenant helper % time(s) and not once in an own_site CTE: it is evaluated per row again', r.fn, n_call;
    END IF;
    IF n_once <> r.uses THEN
      RAISE EXCEPTION 'self-check 20261012137000: % reads the once-per-call flag % time(s), expected %: a test was dropped or added', r.fn, n_once, r.uses;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = r.fn::regprocedure AND p.prosecdef AND p.provolatile = 's'
                      AND p.prorettype = 'jsonb'::regtype
                      AND 'search_path=public' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'self-check 20261012137000: % is no longer a STABLE definer returning jsonb with search_path public', r.fn;
    END IF;
    IF NOT has_function_privilege('anon', r.fn::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.fn::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check 20261012137000: % lost a grant (anon, authenticated and service_role execute it): the company page calls it as anon', r.fn;
    END IF;
    IF has_function_privilege('public', r.fn::regprocedure, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
                   WHERE p.oid = r.fn::regprocedure AND a.grantee = 0) THEN
      RAISE EXCEPTION 'self-check 20261012137000: PUBLIC holds a privilege on %: its grants drifted from 20261012101000', r.fn;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.workday_site_is_own_employer(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.workday_site_is_own_employer(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.workday_site_is_own_employer(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check 20261012137000: workday_site_is_own_employer is not service-role only';
  END IF;

  -- Behaviour on this database: a made-up Workday token, the shape that read
  -- every snapshot row through the helper, answers; the time is reported, not
  -- judged, so a busy apply cannot fail the file.
  v_t0 := clock_timestamp();
  PERFORM public.get_company_intel('20261012137000-self-check~wd1~Careers');
  PERFORM public.get_similar_companies('20261012137000-self-check~wd1~Careers', 1);
  RAISE NOTICE 'self-check 20261012137000: both readers answered a made-up Workday token in % ms',
    round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END
$verify$;
