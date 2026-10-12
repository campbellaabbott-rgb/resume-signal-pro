-- A WORKDAY TENANT THAT HOSTS ANOTHER EMPLOYER IS READ ONE SITE AT A TIME
-- (sweep S12-130).
--
-- get_company_intel and get_similar_companies pool a Workday token with every
-- Workday site of its tenant (20261009160200, kept by 20261012101000 through
-- employer_segment), because one tenant's sites are usually one employer
-- (meijer~wd5~Meijer_Stores_Hourly and meijer~wd5~Meijer_Corporate). Some
-- tenants host another employer's career site too: jcrew hosts Madewell,
-- easyservice Mercy Health, myview Loblaw, db DWS, iko Roofmart, gfs JG
-- Rive-Sud. The name trigger already tells them apart (20261009100100 keys a
-- full-token override wherever a tenant hosts another employer), but the
-- readers did not: the Madewell page printed J.Crew's net-new roles, median
-- pay floor, fields and similar employers, byte-identical to J.Crew's own
-- page, on 17 such tenants (2026-10-12).
--
-- THE RULE NOW: a Workday tenant with any full-token row in
-- company_name_overrides (slug tenant~wdN~site) is read one site at a time;
-- every other Workday tenant still pools its sites, and every other vendor is
-- unchanged. The test is one helper, workday_site_is_own_employer(token),
-- which reads the override table, so a tenant named site by site later is
-- split the day its row lands. In each reader it depends only on p_token, so
-- the planner evaluates it once per call as a one-time filter and the
-- index-served shapes 20260827140000 and 20261012101000 chose are kept.
--
-- employer_segment (20261012100000) is unchanged: it is also the layoff and
-- LCA matchers' rule, and an IMMUTABLE function cannot read a table. The
-- readers apply the split beside it.
--
-- Rewritten FROM THE CATALOGUE, like 20261009160200: each reader's live body
-- must carry the predicates 20261012101000 wrote, exactly as many times as
-- that file wrote them, or the file refuses rather than overwrite a body it
-- does not know. Signatures, SECURITY DEFINER, search_path, timeouts and
-- grants are untouched (CREATE OR REPLACE from pg_get_functiondef keeps them).
--
-- The helper is an INVOKER function no client can execute: the two readers
-- are SECURITY DEFINER and reach it, and the locked override table
-- (20261012130000), with their owner's rights.
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.workday_site_is_own_employer(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $site$
  SELECT COALESCE(p_token, '') ~ '^[^~]+~wd[0-9]+~'
     AND EXISTS (SELECT 1 FROM public.company_name_overrides o
                  WHERE position('~' IN o.slug) > 0
                    AND split_part(o.slug, '~', 1) = split_part(p_token, '~', 1))
$site$;

COMMENT ON FUNCTION public.workday_site_is_own_employer(text) IS
  'True for a Workday token whose tenant carries a full-token row in company_name_overrides (the tenant hosts another '
  'employer''s career site): get_company_intel and get_similar_companies read such a token as its own employer, never pooled '
  'with the tenant''s other sites (20261012135000). Private: the readers reach it as their owner.';

REVOKE ALL ON FUNCTION public.workday_site_is_own_employer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workday_site_is_own_employer(text) TO service_role;

DO $mig$
DECLARE
  v_seg  text := 'public.employer_segment(p.company_token) = public.employer_segment(p_token)';
  v_arm  text := 'OR (p_token ~ ''^[^~]+~wd[0-9]+~'' AND s.company_token ~ ''^[^~]+~wd[0-9]+~''';
  v_def  text;
  v_new  text;
  fn     text;
  n_seg  int;
  n_arm  int;
BEGIN
  IF to_regprocedure('public.employer_segment(text)') IS NULL THEN
    RAISE EXCEPTION 'employer_segment(text) is missing: apply 20261012100000 and 20261012101000 first';
  END IF;
  FOREACH fn IN ARRAY ARRAY['public.get_company_intel(text)', 'public.get_similar_companies(text, integer)'] LOOP
    v_def := pg_get_functiondef(fn::regprocedure);
    IF position('workday_site_is_own_employer(p_token)' IN v_def) > 0 THEN
      RAISE NOTICE '% already reads a hosting tenant one site at a time', fn;
      CONTINUE;
    END IF;
    n_seg := (length(v_def) - length(replace(v_def, v_seg, ''))) / length(v_seg);
    n_arm := (length(v_def) - length(replace(v_def, v_arm, ''))) / length(v_arm);
    IF n_seg <> 1 OR (fn LIKE '%get_company_intel%' AND n_arm <> 1) OR (fn LIKE '%get_similar_companies%' AND n_arm <> 0) THEN
      RAISE EXCEPTION '%: expected the 20261012101000 body (1 employer_segment predicate, % Workday snapshot arm), found % and %; it drifted -- read pg_get_functiondef and fold this rule in rather than overwrite it',
        fn, CASE WHEN fn LIKE '%get_company_intel%' THEN 1 ELSE 0 END, n_seg, n_arm;
    END IF;
    v_new := replace(v_def, v_seg,
      v_seg || E'\n      AND (p.company_token = p_token OR NOT public.workday_site_is_own_employer(p_token))');
    v_new := replace(v_new, v_arm,
      'OR (p_token ~ ''^[^~]+~wd[0-9]+~'' AND NOT public.workday_site_is_own_employer(p_token) AND s.company_token ~ ''^[^~]+~wd[0-9]+~''');
    EXECUTE v_new;
  END LOOP;
END
$mig$;

DO $verify$
DECLARE
  fn  text;
  r   record;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.get_company_intel(text)', 'public.get_similar_companies(text, integer)'] LOOP
    IF position('workday_site_is_own_employer(p_token)' IN pg_get_functiondef(fn::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'self-check 20261012135000: % still pools every Workday site of a tenant that hosts another employer', fn;
    END IF;
    IF NOT has_function_privilege('anon', fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check 20261012135000: % lost its anon grant: every company page would lose its panel', fn;
    END IF;
  END LOOP;
  IF position('workday_site_is_own_employer(p_token) AND s.company_token' IN pg_get_functiondef('public.get_company_intel(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'self-check 20261012135000: get_company_intel''s snapshot series still pools a hosting tenant''s sites';
  END IF;
  IF has_function_privilege('anon', 'public.workday_site_is_own_employer(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.workday_site_is_own_employer(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.workday_site_is_own_employer(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check 20261012135000: workday_site_is_own_employer is not service-role only';
  END IF;
  -- Behaviour on this database: every full-token Workday override marks its
  -- token, and a tenant with none does not.
  FOR r IN SELECT o.slug FROM public.company_name_overrides o WHERE o.slug ~ '^[^~]+~wd[0-9]+~' LIMIT 50 LOOP
    IF NOT public.workday_site_is_own_employer(r.slug) THEN
      RAISE EXCEPTION 'self-check 20261012135000: % carries a full-token override but is still pooled with its tenant', r.slug;
    END IF;
  END LOOP;
  IF public.workday_site_is_own_employer('20261012135000-no-such-tenant~wd1~Careers')
     OR public.workday_site_is_own_employer('20261012135000-plain-slug') THEN
    RAISE EXCEPTION 'self-check 20261012135000: a tenant with no full-token override, or a plain slug, reads as a hosting tenant';
  END IF;
  PERFORM public.get_company_intel('20261012135000-self-check~wd1~Careers');
  PERFORM public.get_similar_companies('20261012135000-self-check~wd1~Careers', 1);
END
$verify$;
