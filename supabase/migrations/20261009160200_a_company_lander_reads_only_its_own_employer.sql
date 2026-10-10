-- A COMPANY LANDER READS ONLY ITS OWN EMPLOYER (sweep S8-021).
--
-- get_company_intel and get_similar_companies grouped a lander's postings by
-- split_part(company_token, '~', 1), the rule that folds one Workday tenant's
-- several career sites (meijer~wd5~Meijer_Stores_Hourly -> meijer). For every
-- other vendor that uses '~' the first segment is a HOST, not an employer:
-- Greenhouse/Lever EU boards are eu~<board> (222 in the catalogue), UKG boards
-- recruiting~<tenant> and recruiting2~<tenant> (728 and 563). So
-- /jobs/company/eu~lookers printed "+258 net-new roles, median floor $92,500
-- (270 USD postings), hires in Engineering/Operations/Healthcare" two lines
-- above its own "Oct 1 (85) -> Oct 8 (76)": live anon calls returned
-- byte-identical JSON for eu~lookers and eu~rubyhotels, and for two UKG
-- tokens (usd_n 4,600, net_7d 2,635), with identical similar-company lists.
-- About 1,400 landers printed figures belonging to other companies.
--
-- THE RULE NOW: a Workday token (tenant~wdN~site) groups with the other
-- Workday sites of its tenant; every other token is its own employer. Spelled
-- as two index-served arms (the slug expression index for Workday, the plain
-- company_token btree otherwise), never as a CASE, which no index can serve
-- (20260827140000 explains the 15-second seq-scan that shape costs here).
--
-- Rewritten FROM THE CATALOGUE: each function's live body has its grouping
-- predicates replaced, and the count of replacements is checked, so a live
-- definition that drifted from the files is refused rather than overwritten.
-- Signatures, SECURITY DEFINER, search_path, timeouts and grants are
-- untouched (CREATE OR REPLACE from pg_get_functiondef keeps all of them).
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

DO $mig$
DECLARE
  v_wd   text := '''^[^~]+~wd[0-9]+~''';
  v_def  text;
  v_new  text;
  v_same text;
  fn     text;
  need   int;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.get_company_intel(text)', 'public.get_similar_companies(text, integer)'] LOOP
    v_def := pg_get_functiondef(fn::regprocedure);
    IF position('~wd[0-9]+~' IN v_def) > 0 THEN
      RAISE NOTICE '% already groups only Workday tenants', fn;
      CONTINUE;
    END IF;
    v_new := v_def;
    need := 0;
    FOREACH v_same IN ARRAY ARRAY['p', 's'] LOOP
      -- "same employer as p_token", for rows aliased v_same
      IF position(format('split_part(%s.company_token, ''~'', 1) = split_part(p_token, ''~'', 1)', v_same) IN v_new) > 0 THEN
        need := need + 1;
        v_new := replace(v_new,
          format('split_part(%s.company_token, ''~'', 1) = split_part(p_token, ''~'', 1)', v_same),
          format('((p_token ~ %2$s AND split_part(%1$s.company_token, ''~'', 1) = split_part(p_token, ''~'', 1) AND %1$s.company_token ~ %2$s) OR (p_token !~ %2$s AND %1$s.company_token = p_token))', v_same, v_wd));
      END IF;
    END LOOP;
    -- "a different employer from p_token" (the similar list's exclusion)
    IF position('split_part(p.company_token, ''~'', 1) <> split_part(p_token, ''~'', 1)' IN v_new) > 0 THEN
      need := need + 1;
      v_new := replace(v_new,
        'split_part(p.company_token, ''~'', 1) <> split_part(p_token, ''~'', 1)',
        format('NOT ((p_token ~ %1$s AND split_part(p.company_token, ''~'', 1) = split_part(p_token, ''~'', 1) AND p.company_token ~ %1$s) OR (p_token !~ %1$s AND p.company_token = p_token))', v_wd));
    END IF;
    IF (fn LIKE '%get_company_intel%' AND need <> 2) OR (fn LIKE '%get_similar_companies%' AND need <> 2) THEN
      RAISE EXCEPTION '%: expected 2 grouping predicates in the live body, found %; it drifted from 20260827140000 -- refusing to rewrite it', fn, need;
    END IF;
    EXECUTE v_new;
  END LOOP;
END
$mig$;

DO $verify$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.get_company_intel(text)', 'public.get_similar_companies(text, integer)'] LOOP
    IF position('~wd[0-9]+~' IN pg_get_functiondef(fn::regprocedure)) = 0 THEN
      RAISE EXCEPTION '% still pools every token that shares a first segment', fn;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('anon', 'public.get_company_intel(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_company_intel lost its anon grant: every company lander would lose its panel';
  END IF;
END
$verify$;
