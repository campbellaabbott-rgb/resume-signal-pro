-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-17 in the bug round part B, lane layoff-filings-b).
--
-- A STATE NOTICE NAMES THE TOWN ITS STREET IS IN (S14X-185).
--
-- Illinois keeps the street and the town in two columns (Location Address,
-- Location City; warn-maps/il.ts), and layoff-filings stores them as site_raw
-- and site_city. Both readers printed COALESCE(NULLIF(site_raw, ''),
-- site_city): the town only when there was no street. So an Illinois notice
-- printed a bare street as its site. Production on 2026-11-08: Tyson Foods'
-- notice for 2,495 workers read "positions at 28424 38TH Ave. North", and the
-- state's file names the town, Hillsdale. 4,887 of the 4,888 rows of the
-- saved Illinois export state both; Iowa and Arizona state both too (Arizona's
-- street cell already carries its town), California and Texas only one.
--
-- 1. public.layoff_site_text(p_site, p_city) is the site a reader prints: the
--    street and the town joined by ', ' when both are stated and the street
--    does not already name the town; the town alone when there is no street;
--    the street alone when there is no town; NULL when neither is stated.
--    "Already names the town" is the town as a whole word (any case) that is
--    not the start of a street's name: "13801 E. Benson HWY; Vail, Arizona"
--    names Vail and "Rock Island Arsenal" names Rock Island, but "2411 WEST
--    SCHAUMBURG ROAD" and "7447 Skokie Blvd" name only a street (144 of the
--    4,887 Illinois rows hold their town's name somewhere in the street cell,
--    most of them as a road named after it). Regex characters in a town are
--    escaped. Owner and service_role only: revoked from PUBLIC, anon and
--    authenticated; both readers are definer functions and call it as their
--    owner.
-- 2. get_employer_layoff_filings and get_employer_layoff_filings_all print
--    it. Each is rewritten FROM THE CATALOGUE (pg_get_functiondef, its one
--    site expression replaced), never from a hand-copied body, so a live
--    definition that drifted from 20261009160000 is refused rather than
--    overwritten. CREATE OR REPLACE keeps the signature, the return shape,
--    the owner, the grants (anon, authenticated, service_role: both are
--    client-callable readers on the census list; neither gains a caller) and
--    the comment.
--
-- The site is part of layoff-filings' dedupe key (normalize.ts), which is why
-- the join happens in the readers and not in the state map: joining the town
-- in il.ts would mint a second filing_id for every Illinois notice already
-- stored. agent-mcp reads lf_site from the same reader, so an agent gets the
-- town too, with no function change.
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.layoff_site_text(p_site text, p_city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(p_site), '') IS NULL THEN NULLIF(btrim(p_city), '')
    WHEN NULLIF(btrim(p_city), '') IS NULL THEN p_site
    WHEN p_site ~* (
           '(^|[^[:alnum:]])'
        || regexp_replace(
             regexp_replace(btrim(p_city), '([^[:alnum:][:space:]])', '\\\1', 'g'),
             '[[:space:]]+', '[[:space:]]+', 'g')
        || '(?![[:alnum:]])'
        || '(?![[:space:]]+(road|rd|street|st|avenue|ave|av|boulevard|blvd|drive|dr|parkway|pkwy'
        || '|lane|ln|place|pl|court|ct|way|highway|hwy|plaza|square|sq|center|centre|ctr|mall'
        || '|trail|trl|circle|cir|terrace|pike|expressway|expy)([^[:alnum:]]|$))'
       ) THEN p_site
    ELSE p_site || ', ' || btrim(p_city)
  END
$$;

COMMENT ON FUNCTION public.layoff_site_text(text, text) IS
  'The site a layoff reader prints for a state notice: street and town joined by '', '' when both are '
  'stated and the street does not already name the town (the town as a whole word that does not start '
  'a street''s name, any case), else whichever is stated, else NULL. Called by get_employer_layoff_filings '
  'and get_employer_layoff_filings_all (definer) as their owner; service_role only.';

REVOKE ALL ON FUNCTION public.layoff_site_text(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layoff_site_text(text, text) TO service_role;

-- 2. Both readers, from the catalogue.
DO $mig$
DECLARE
  v_fn     text;
  v_def    text;
  v_anchor text := 'COALESCE(NULLIF(f.site_raw, ''''), f.site_city) AS site_text';
  v_call   text := 'public.layoff_site_text(f.site_raw, f.site_city) AS site_text';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.get_employer_layoff_filings(text[])', 'public.get_employer_layoff_filings_all(text)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position(v_call IN v_def) > 0 AND position(v_anchor IN v_def) = 0 THEN
      RAISE NOTICE '% already prints the street with its town', v_fn;
    ELSIF position(v_anchor IN v_def) = 0 THEN
      RAISE EXCEPTION '%: the site expression is not in the live definition; it drifted from 20261009160000 -- refusing to rewrite it', v_fn;
    ELSIF array_length(string_to_array(v_def, v_anchor), 1) <> 2 THEN
      RAISE EXCEPTION '%: the site expression appears more than once in the live definition -- refusing to rewrite it', v_fn;
    ELSE
      EXECUTE replace(v_def, v_anchor, v_call);
    END IF;
  END LOOP;
END
$mig$;

-- Self-verification.
DO $verify$
DECLARE
  v_fn  text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.get_employer_layoff_filings(text[])', 'public.get_employer_layoff_filings_all(text)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('public.layoff_site_text(f.site_raw, f.site_city) AS site_text' IN v_def) = 0
       OR position('COALESCE(NULLIF(f.site_raw' IN v_def) > 0 THEN
      RAISE EXCEPTION '% still prints a bare street as the site', v_fn;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION '% is no longer a definer function', v_fn;
    END IF;
    IF NOT has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% lost its anon grant: every card would stop reading filings', v_fn;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_employer_layoff_filings'
       AND 'lf_site' = ANY (p.proargnames) AND 'lf_workforce' = ANY (p.proargnames)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_employer_layoff_filings_all'
       AND 'la_site' = ANY (p.proargnames) AND 'la_workforce' = ANY (p.proargnames)
  ) THEN
    RAISE EXCEPTION 'a layoff reader lost its return shape';
  END IF;
  IF has_function_privilege('anon', 'public.layoff_site_text(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.layoff_site_text(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'layoff_site_text is callable by anon or authenticated';
  END IF;
  IF public.layoff_site_text('28424 38TH Ave. North', 'Hillsdale') IS DISTINCT FROM '28424 38TH Ave. North, Hillsdale'
     OR public.layoff_site_text('2411 WEST SCHAUMBURG ROAD', 'SCHAUMBURG') IS DISTINCT FROM '2411 WEST SCHAUMBURG ROAD, SCHAUMBURG'
     OR public.layoff_site_text('13801 E. Benson HWY; Vail, Arizona 85641', 'Vail') IS DISTINCT FROM '13801 E. Benson HWY; Vail, Arizona 85641'
     OR public.layoff_site_text('Seattle, Spokane, Renton', NULL) IS DISTINCT FROM 'Seattle, Spokane, Renton'
     OR public.layoff_site_text(NULL, 'Burlington') IS DISTINCT FROM 'Burlington'
     OR public.layoff_site_text('  ', '  ') IS NOT NULL THEN
    RAISE EXCEPTION 'layoff_site_text does not join a street and its town as written';
  END IF;
END
$verify$;
