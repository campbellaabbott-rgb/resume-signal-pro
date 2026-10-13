-- RÉSUMÉ MATCHING READS ITS CANDIDATES IN ONE STATEMENT (phase 0).
--
-- match_candidates is the one retrieval statement resume-match runs per
-- request: one dynamic UNION ALL of lane sub-selects, each title-only and each
-- with its own LIMIT, so there is one timeout and one cancellation unit
-- (src/test/one-retriever-per-search.test.ts records why fan-out was refused:
-- withDeadline cannot cancel SQL, and a lost arm silently rewrites a page).
--
--   ring     the reader's commute ring and the places they named: one constant
--            arm per place, as search_jobs builds them (20261009101000), so the
--            location trigram index answers every arm. Rows in the ring's own
--            countries, or with no country (resume-match keeps a null-country
--            row only when it names a ring place and that place's state).
--   remote   remote rows in the countries the reader said they can work in.
--            NOT work_mode alone: it is null on 65% of rows (n=1,648), so a row
--            counts as remote when work_mode says so, OR the board's remote
--            flag is set, OR its location says remote. resume-match then
--            refuses a "remote" row of an on-site occupation unless its title
--            or location literally says remote (on-site jobs carry the flag).
--   region   regions the reader said they would move to: each region's aliases
--            as search_jobs' place arms (a name, or ", TX" as the trailing,
--            no-space and leading arms).
--   country  only when the reader would move anywhere in the country.
--
-- THE BASE PREDICATE IS SEARCH_JOBS': effective_posted >= the fresh cutoff AND
-- missing_since IS NULL. A pglite test holds the two to the same rows by
-- behaviour (src/test/match-candidates.test.ts), not by spelling.
--
-- SERVING PARITY. p_exclude_sources withholds sources a surface may not
-- redistribute (resume-match passes usajobs and smartrecruiters for the mcp
-- and v1 surfaces; a test holds that list to NO_REDISTRIBUTION_SOURCES).
-- p_sources in search_jobs is an inclusion list, so this is a new parameter.
--
-- ORDERING. p_order 'rank': title rank (ts_rank_cd over the title weight
-- only), then effective_posted. 'recent': effective_posted alone, re-ranked by
-- title closeness in TypeScript; that is the measured SIMPLE-route shape
-- (server 432-503 ms) and the fallback if the timing gate (spec 6.5) fails on
-- rank ordering.
--
-- WHAT IT NEVER DOES. It takes no max-years or experience filter (in the
-- retrieval probes those dropped title matches from 83 to 32, 55 to 13 and 81
-- to 3), it is a new name so it cannot overload search_jobs (PGRST203), and it
-- sets no statement_timeout of its own (a function's SET never bounds the
-- statement already running: 20261003220000).
--
-- SECURITY INVOKER: it reads job_board_postings as its caller. Only the
-- service role may call it; the DO block raises if anon or authenticated can.
--
-- Safe to run twice: every earlier signature of the name is dropped first.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'match_candidates'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.match_candidates(
  p_q_en text,
  p_q_simple text,
  p_fresh_cutoff timestamptz,
  p_countries text[],
  p_ring text[],
  p_remote boolean,
  p_regions text[],
  p_country_lane boolean,
  p_exclude_sources text[] DEFAULT NULL,
  p_lane_limit integer DEFAULT 120,
  p_order text DEFAULT 'rank',
  p_ring_countries text[] DEFAULT NULL
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text, location text, country text,
  remote boolean, work_mode text, employment_type text, posted_at timestamptz, salary text,
  salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text,
  experience_band text, min_years integer, agency boolean, lane text, title_rank real, siblings integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  q_en tsquery;
  q_simple tsquery;
  v_title text;
  v_rank text;
  v_base text := ' AND p.effective_posted >= $3 AND p.missing_since IS NULL';
  v_order text;
  v_lim integer := least(greatest(coalesce(p_lane_limit, 120), 1), 200);
  v_lanes text[] := '{}';
  v_arms text[];
  v_alias text;
  v_code text;
  v_home text;
  v_ring_cc text[] := coalesce(p_ring_countries, p_countries);
  cols text :=
    'p.id, p.source, p.company_token, p.company, p.title, p.location, p.country, p.remote, p.work_mode, '
    || 'p.employment_type, p.posted_at, p.salary, p.salary_min_annual, p.salary_max_annual, p.salary_period, '
    || 'p.salary_currency, p.experience_band, p.min_years::integer AS min_years, p.agency';
BEGIN
  IF p_order IS NULL OR p_order NOT IN ('rank', 'recent') THEN
    RAISE EXCEPTION 'match_candidates: p_order must be rank or recent, got %', p_order;
  END IF;
  IF cardinality(coalesce(p_ring, '{}')) > 40 OR cardinality(coalesce(p_regions, '{}')) > 40 THEN
    RAISE EXCEPTION 'match_candidates: at most 40 ring places and 40 region aliases';
  END IF;
  IF coalesce(btrim(p_q_en), '') <> '' THEN q_en := websearch_to_tsquery('english', p_q_en); END IF;
  IF coalesce(btrim(p_q_simple), '') <> '' THEN q_simple := websearch_to_tsquery('simple', p_q_simple); END IF;
  IF (q_en IS NULL OR numnode(q_en) = 0) AND (q_simple IS NULL OR numnode(q_simple) = 0) THEN
    RETURN;
  END IF;
  IF q_en IS NOT NULL AND numnode(q_en) = 0 THEN q_en := NULL; END IF;
  IF q_simple IS NOT NULL AND numnode(q_simple) = 0 THEN q_simple := NULL; END IF;

  v_title := '(' || concat_ws(' OR ',
    CASE WHEN q_en IS NOT NULL THEN 'p.title_tsv @@ $1' END,
    CASE WHEN q_simple IS NOT NULL THEN 'to_tsvector(''simple'', p.title) @@ $2' END) || ')';
  v_rank := CASE
    WHEN q_en IS NOT NULL AND q_simple IS NOT NULL THEN 'greatest(ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1), ts_rank_cd(to_tsvector(''simple'', p.title), $2))'
    WHEN q_en IS NOT NULL THEN 'ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1)'
    ELSE 'ts_rank_cd(to_tsvector(''simple'', p.title), $2)' END;
  IF cardinality(coalesce(p_exclude_sources, '{}')) > 0 THEN
    v_base := v_base || ' AND NOT (p.source = ANY($4))';
  END IF;
  v_order := CASE p_order
    WHEN 'rank' THEN ' ORDER BY ' || v_rank || ' DESC, p.effective_posted DESC, p.id'
    ELSE ' ORDER BY p.effective_posted DESC, p.id' END;

  -- RING: one constant arm per place (search_jobs' rule, 20261009101000).
  IF cardinality(coalesce(p_ring, '{}')) > 0 THEN
    v_arms := '{}';
    FOREACH v_alias IN ARRAY p_ring LOOP
      v_alias := btrim(v_alias);
      CONTINUE WHEN v_alias = '';
      IF v_alias ~ '^, [A-Z]{2}$' THEN
        v_code := substr(v_alias, 3, 2);
        v_home := CASE WHEN v_code IN ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK') THEN 'CA' ELSE 'US' END;
        v_arms := v_arms || ('(p.location ILIKE ' || quote_literal('%, ' || v_code || '%') || ' AND p.location ~ ' || quote_literal(', ' || v_code || '($|[^A-Za-z])') || ')');
        v_arms := v_arms || ('(p.location ILIKE ' || quote_literal('%,' || v_code || '%') || ' AND p.location ~ ' || quote_literal(',' || v_code || '($|[^A-Za-z])') || ')');
        v_arms := v_arms || ('(p.location ~ ' || quote_literal('^' || v_code || ' ?([-,]|$)|- ?' || v_code || '($|[^A-Za-z])|^USA? ' || v_code || '($|[^A-Za-z])') || ' AND p.country = ' || quote_literal(v_home) || ')');
      ELSE
        v_arms := v_arms || ('p.location ILIKE ' || quote_literal('%' || replace(replace(v_alias, '%', ''), '_', '') || '%'));
      END IF;
    END LOOP;
    IF cardinality(v_arms) > 0 THEN
      v_lanes := v_lanes || ('(SELECT ' || cols || ', ''ring''::text AS lane, ' || v_rank || '::real AS title_rank'
        || ' FROM public.job_board_postings p WHERE ' || v_title || v_base
        || ' AND (p.country IS NULL OR p.country = ANY($5))'
        || ' AND (' || array_to_string(v_arms, ' OR ') || ')' || v_order || ' LIMIT ' || v_lim || ')');
    END IF;
  END IF;

  -- REMOTE: work_mode, the remote flag, or the location saying so.
  IF p_remote IS TRUE AND cardinality(coalesce(p_countries, '{}')) > 0 THEN
    v_lanes := v_lanes || ('(SELECT ' || cols || ', ''remote''::text AS lane, ' || v_rank || '::real AS title_rank'
      || ' FROM public.job_board_postings p WHERE ' || v_title || v_base
      || ' AND p.country = ANY($6)'
      || ' AND (p.work_mode = ''remote'' OR p.remote IS TRUE OR p.location ILIKE ''%remote%'')'
      || v_order || ' LIMIT ' || v_lim || ')');
  END IF;

  -- REGION: the regions the reader would move to, as place arms.
  IF cardinality(coalesce(p_regions, '{}')) > 0 AND cardinality(coalesce(p_countries, '{}')) > 0 THEN
    v_arms := '{}';
    FOREACH v_alias IN ARRAY p_regions LOOP
      v_alias := btrim(v_alias);
      CONTINUE WHEN v_alias = '';
      IF v_alias ~ '^, [A-Z]{2}$' THEN
        v_code := substr(v_alias, 3, 2);
        v_home := CASE WHEN v_code IN ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK') THEN 'CA' ELSE 'US' END;
        v_arms := v_arms || ('(p.location ILIKE ' || quote_literal('%, ' || v_code || '%') || ' AND p.location ~ ' || quote_literal(', ' || v_code || '($|[^A-Za-z])') || ')');
        v_arms := v_arms || ('(p.location ILIKE ' || quote_literal('%,' || v_code || '%') || ' AND p.location ~ ' || quote_literal(',' || v_code || '($|[^A-Za-z])') || ')');
        v_arms := v_arms || ('(p.location ~ ' || quote_literal('^' || v_code || ' ?([-,]|$)|- ?' || v_code || '($|[^A-Za-z])|^USA? ' || v_code || '($|[^A-Za-z])') || ' AND p.country = ' || quote_literal(v_home) || ')');
      ELSE
        v_arms := v_arms || ('p.location ILIKE ' || quote_literal('%' || replace(replace(v_alias, '%', ''), '_', '') || '%'));
      END IF;
    END LOOP;
    IF cardinality(v_arms) > 0 THEN
      v_lanes := v_lanes || ('(SELECT ' || cols || ', ''region''::text AS lane, ' || v_rank || '::real AS title_rank'
        || ' FROM public.job_board_postings p WHERE ' || v_title || v_base
        || ' AND p.country = ANY($6)'
        || ' AND (' || array_to_string(v_arms, ' OR ') || ')' || v_order || ' LIMIT ' || v_lim || ')');
    END IF;
  END IF;

  -- COUNTRY: anywhere in the countries, only when the reader would move anywhere.
  IF p_country_lane IS TRUE AND cardinality(coalesce(p_countries, '{}')) > 0 THEN
    v_lanes := v_lanes || ('(SELECT ' || cols || ', ''country''::text AS lane, ' || v_rank || '::real AS title_rank'
      || ' FROM public.job_board_postings p WHERE ' || v_title || v_base
      || ' AND p.country = ANY($6)' || v_order || ' LIMIT ' || v_lim || ')');
  END IF;

  IF cardinality(v_lanes) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT u.id, u.source, u.company_token, u.company, u.title, u.location, u.country, u.remote, u.work_mode, '
    || 'u.employment_type, u.posted_at, u.salary, u.salary_min_annual, u.salary_max_annual, u.salary_period, '
    || 'u.salary_currency, u.experience_band, u.min_years, u.agency, u.lane, u.title_rank, '
    || '(count(*) OVER (PARTITION BY u.lane, coalesce(u.company_token, u.company), lower(u.title), u.location))::integer AS siblings '
    || 'FROM (' || array_to_string(v_lanes, ' UNION ALL ') || ') u'
    USING q_en, q_simple, p_fresh_cutoff, p_exclude_sources, v_ring_cc, p_countries;
END;
$$;

REVOKE ALL ON FUNCTION public.match_candidates(text, text, timestamptz, text[], text[], boolean, text[], boolean, text[], integer, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_candidates(text, text, timestamptz, text[], text[], boolean, text[], boolean, text[], integer, text, text[]) TO service_role;

-- Self-verifying from the catalogue: one signature, no client role can execute
-- it, the base predicate and the per-place builder are in the body, and every
-- lane runs under both orders (a malformed arm is a syntax error only at run
-- time, so each is run here with a term no posting holds).
DO $$
DECLARE
  v_n integer;
  v_src text;
  v_rows bigint;
  v_order text;
BEGIN
  SELECT count(*), max(pr.prosrc) INTO v_n, v_src
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'match_candidates';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'match_candidates has % signatures; a named-argument call would be ambiguous', v_n;
  END IF;
  IF strpos(v_src, 'p.effective_posted >= $3 AND p.missing_since IS NULL') = 0 THEN
    RAISE EXCEPTION 'match_candidates does not carry search_jobs'' base predicate';
  END IF;
  IF strpos(v_src, 'quote_literal(''^'' || v_code') = 0 OR strpos(v_src, 'EXISTS (SELECT 1 FROM unnest') > 0 THEN
    RAISE EXCEPTION 'match_candidates does not build one constant arm per place';
  END IF;
  IF has_function_privilege('anon', 'public.match_candidates(text, text, timestamptz, text[], text[], boolean, text[], boolean, text[], integer, text, text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.match_candidates(text, text, timestamptz, text[], text[], boolean, text[], boolean, text[], integer, text, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'match_candidates is executable by a client role';
  END IF;
  FOREACH v_order IN ARRAY ARRAY['rank', 'recent'] LOOP
    SELECT count(*) INTO v_rows FROM public.match_candidates(
      '"zqxjvkw nurse" or zqxjvkw', 'zqxjvkw', now(), ARRAY['US'], ARRAY['Boise', ', ID'], true,
      ARRAY['Texas', ', TX'], true, ARRAY['usajobs', 'smartrecruiters'], 5, v_order, ARRAY['US', 'CA']);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
