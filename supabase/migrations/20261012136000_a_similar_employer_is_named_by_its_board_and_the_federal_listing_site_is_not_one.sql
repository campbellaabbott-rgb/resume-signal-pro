-- A SIMILAR EMPLOYER IS NAMED BY ITS BOARD, AND THE FEDERAL LISTING SITE IS
-- NOT ONE (design and profiles fix round, 2026-10-18 review).
--
-- get_similar_companies (20261012101000, then 20261012135000) feeds the
-- "Also hiring in ..." rail and the page-bottom list, under a blurb that says
-- these are companies with live openings in the same field, from their own
-- career systems. It named each board by max(company), the alphabetically
-- last name on it, and it admitted every board. So on 2026-10-18 the live
-- reply for cvshealth~wd1~CVS_Health_Careers and for Eurofins led with
-- {company: 'Veterans Health Administration', company_token: 'usajobs'}: the
-- federal listing site, named after one of its agencies, linked to the hub
-- that says it is not an employer. The same max() picked an arbitrary brand
-- on a tenant that lists several, and a board name two hiring systems share
-- pooled both employers' roles under one of their names.
--
-- THE RULE NOW, in that list only:
--   * no USAJOBS row (source 'usajobs' or token 'usajobs'): a listing site,
--     not an employer hiring from its own system;
--   * no staffing-agency board (job_board_postings.agency, 20260831120000):
--     its roles belong to its clients;
--   * no board name more than one hiring system carries among the counted
--     rows (count(DISTINCT source) = 1): the collision rule the company page
--     already applies;
--   * each board named by its full-token row in company_name_overrides when
--     it has one, else by the name most of its rows carry (mode), never the
--     alphabetically last.
--
-- Rewritten FROM THE CATALOGUE, like 20261012135000: the live body must carry
-- each of the three fragments 20261012101000 wrote exactly once, or the file
-- refuses rather than overwrite a body it does not know. Signature, SECURITY
-- DEFINER, search_path, the 15s timeout and the grants are untouched (CREATE
-- OR REPLACE from pg_get_functiondef keeps them). The reader stays anon-
-- executable because the company page calls it as anon.
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

DO $mig$
DECLARE
  v_name  text := $f$max(p.company) AS company,$f$;
  v_where text := $f$AND p.company <> ''$f$;
  v_have  text := $f$HAVING count(*) >= 3$f$;
  v_mark  text := $f$p.company_token <> 'usajobs'$f$;
  v_def   text;
  v_new   text;
  n1 int; n2 int; n3 int;
BEGIN
  IF to_regprocedure('public.get_similar_companies(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'get_similar_companies(text, integer) is missing: apply 20261012101000 and 20261012135000 first';
  END IF;
  v_def := pg_get_functiondef('public.get_similar_companies(text, integer)'::regprocedure);
  IF position(v_mark IN v_def) > 0 THEN
    RAISE NOTICE 'get_similar_companies already names each board by its board and leaves USAJOBS out';
    RETURN;
  END IF;
  IF position('workday_site_is_own_employer(p_token)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_similar_companies: 20261012135000 is not applied (no workday_site_is_own_employer predicate); apply it first';
  END IF;
  n1 := (length(v_def) - length(replace(v_def, v_name, ''))) / length(v_name);
  n2 := (length(v_def) - length(replace(v_def, v_where, ''))) / length(v_where);
  n3 := (length(v_def) - length(replace(v_def, v_have, ''))) / length(v_have);
  IF n1 <> 1 OR n2 <> 1 OR n3 <> 1 THEN
    RAISE EXCEPTION 'get_similar_companies: expected the 20261012101000 body (each of max(company), the empty-name filter and the HAVING once), found %, % and %; it drifted -- read pg_get_functiondef and fold this rule in rather than overwrite it',
      n1, n2, n3;
  END IF;
  v_new := replace(v_def, v_name,
    $r$COALESCE((SELECT o.display_name FROM public.company_name_overrides o WHERE o.slug = p.company_token),
                    mode() WITHIN GROUP (ORDER BY p.company)) AS company,$r$);
  v_new := replace(v_new, v_where,
    v_where || E'\n      AND p.source <> ''usajobs'' AND p.company_token <> ''usajobs''\n      AND NOT COALESCE(p.agency, false)');
  v_new := replace(v_new, v_have, v_have || ' AND count(DISTINCT p.source) = 1');
  EXECUTE v_new;
END
$mig$;

DO $verify$
DECLARE
  v_def text := pg_get_functiondef('public.get_similar_companies(text, integer)'::regprocedure);
  v_cat text;
  v_tok text;
BEGIN
  IF position($f$p.company_token <> 'usajobs'$f$ IN v_def) = 0 OR position($f$p.source <> 'usajobs'$f$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-check 20261012136000: get_similar_companies still admits the USAJOBS board';
  END IF;
  IF position('max(p.company)' IN v_def) > 0 OR position('mode() WITHIN GROUP (ORDER BY p.company)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-check 20261012136000: get_similar_companies still names a board by max(company)';
  END IF;
  IF position('count(DISTINCT p.source) = 1' IN v_def) = 0 OR position('COALESCE(p.agency, false)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-check 20261012136000: get_similar_companies still admits a shared board name or an agency board';
  END IF;
  IF position('workday_site_is_own_employer(p_token)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-check 20261012136000: the rewrite lost 20261012135000''s hosting-tenant rule';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_similar_companies(text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check 20261012136000: get_similar_companies lost its anon grant: every company page would lose its list';
  END IF;
  -- Behaviour on this database: a board in a field USAJOBS lists in never
  -- gets USAJOBS back, under any name.
  SELECT p.category INTO v_cat FROM public.job_board_postings p
   WHERE p.company_token = 'usajobs' AND p.missing_since IS NULL
     AND p.category IS NOT NULL AND p.category NOT IN ('', 'other')
   LIMIT 1;
  IF v_cat IS NOT NULL THEN
    SELECT p.company_token INTO v_tok FROM public.job_board_postings p
     WHERE p.category = v_cat AND p.source <> 'usajobs' AND p.missing_since IS NULL
     LIMIT 1;
    IF v_tok IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(public.get_similar_companies(v_tok, 50)) e
       WHERE e->>'company_token' = 'usajobs') THEN
      RAISE EXCEPTION 'self-check 20261012136000: get_similar_companies(%) still lists the USAJOBS board', v_tok;
    END IF;
  END IF;
  PERFORM public.get_similar_companies('20261012136000-self-check', 1);
END
$verify$;

NOTIFY pgrst, 'reload schema';
