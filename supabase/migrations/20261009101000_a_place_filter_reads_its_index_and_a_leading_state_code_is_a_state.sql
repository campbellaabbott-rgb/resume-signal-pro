-- A PLACE FILTER READS ITS INDEX, AND A LEADING STATE CODE IS A STATE.
--
-- Three defects in the location clause of search_jobs, count_jobs_capped and
-- fuzzy_title_search (S11 register, 2026-10-11), plus one bound on the
-- description tier. Measured live on .91, 2026-10-11, read-only probes.
--
-- 1. THE CLAUSE COULD NOT USE THE TRIGRAM INDEX (S11-002). Every alias was
--    matched inside a correlated EXISTS over the split alias list: a
--    semi-join the planner runs once per candidate row, never an index
--    condition. {q:"manager", location:"Boise"} leaves under 200 title hits, so
--    search_jobs drops to search_tsv and tests every "manager" description row
--    through the semi-join: 57014 after 8.36 s and the unranked fallback at
--    10.7 s (Knoxville 9.9 s, the same). manager/Denver (title tier) stays at
--    1.1 s. The clause is now built HERE, in plpgsql, as one constant arm per
--    alias, OR'ed: a name is `p.location ILIKE '<%alias%>'` and a code is an
--    ILIKE plus a case-sensitive regex, or a regex alone, every one answered by
--    job_board_postings_location_trgm_idx (pg_trgm extracts trigrams from a
--    regex as it does from a LIKE), so the planner can BitmapAnd the place with
--    the text. pglite, 300k seeded rows: manager/Boise 379 ms -> 49 ms (the
--    description-tier count went from a Nested Loop Semi Join over 114k
--    search_tsv rows to a BitmapAnd); count_jobs_capped 292 -> 13 ms; the
--    rescue tier 204 -> 10 ms.
--    src/test/a-place-filter-reads-its-index-and-a-leading-state-code-is-a-state.test.ts
--    holds the plan on 40k rows.
--
-- 2. A STATE CODE THAT LEADS THE PLACE WAS NOT A STATE (S11-003). "Texas"
--    expands to "Texas|, TX", and ", TX" matched only "<city>, TX". CVS writes
--    "TX - Houston" (1,054 rows against 15 for "Texas"), RTX "US-TX-Houston",
--    Sanford "SD, Sioux Falls", others "Tyler,TX - 100 Rice Road" and
--    "USA TX Austin": about 15k live postings out of every state search. A code
--    alias ", XX" is now three arms:
--      * trailing, 20261008100200's arm as it stood (", XX" then the end or a
--        non-letter, on a US, Canadian or unplaced row);
--      * the same with no space (",XX"), on the same rows;
--      * leading or dashed: "XX" at the start then an optional space and a dash
--        or comma (or the end), or after "-"/"- ", or after "US "/"USA ", then
--        the end or a non-letter. These rows never matched before, so they get
--        no unplaced chance: the row's country must be the code's own (CA for
--        the ten province codes, US for the rest). "CA - BROSSARD BUILDING"
--        stored as Canada is not California, and "IN - Jaipur" with no country
--        is not Indiana.
--    job-board and /v1 browse bind the same rule (location-match.ts, both
--    copies).
--
-- 3. THE DESCRIPTION TIER HAD NO BOUND (S11-009). {q:"manager", country:"GB",
--    payBasis:"hourly"} takes the description tier and timed out at 8.12 s.
--    search_jobs gains p_title_only (DEFAULT false): true skips the tier and
--    answers the title tier with related_rows NULL. job-board races the full
--    call at 2.5 s and asks for the title tier when it misses. The escalation
--    rule itself is untouched.
--
-- WHAT IS UNCHANGED. In search_jobs and count_jobs_capped every other
-- predicate, the select lists, ordering, limits, settings and return shapes
-- are 20261008100200's, byte for byte. fuzzy_title_search moves from LANGUAGE
-- sql to plpgsql so its place clause can be built the same way; its other
-- predicates are appended only when they bind, as search_jobs appends them,
-- with the same truth table (a NULL agency opt-out still hides agencies, an
-- unknown pay basis still matches nothing), and its select, order, limit,
-- search_path and 8 s setting are unchanged. A single-name location splits
-- into a one-element array and behaves EXACTLY as before for a name; an empty
-- p_location ('') still matches nothing, and an empty element still matches
-- every placed row, as the EXISTS did.
--
-- THE THREE MOVE IN ONE FILE (20260927034117's reason): the ranked search,
-- its count and the rescue tier answer the same question. Every overload of
-- the three names is dropped first, then the named drops, and the grants DROP
-- discards come back as they stood: service_role only.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('search_jobs', 'count_jobs_capped', 'fuzzy_title_search')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean);
CREATE FUNCTION public.search_jobs(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_location text DEFAULT NULL,
  p_remote boolean DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_experience text[] DEFAULT NULL,
  p_salary_floor numeric DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL,
  p_max_age_days integer DEFAULT NULL,
  p_work_mode text DEFAULT NULL,
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0,
  p_sources text[] DEFAULT NULL
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false,
  p_salary_ceiling numeric DEFAULT NULL,
  p_pay_basis text DEFAULT NULL,
  p_max_years integer DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_exclude_agencies boolean DEFAULT false,
  p_title_only boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text, employment_type text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text,
  min_years integer, last_seen timestamptz, agency boolean, total_rows bigint,
  related_rows bigint, title_match boolean, snippet text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modes text[];
  v_etypes text[];
  v_loc text[] := '{}';
  v_alias text;
  v_code text;
  v_home text;
  q tsquery := websearch_to_tsquery('english', p_q);
  q_or tsquery;
  filters text := ' AND p.effective_posted >= $2 AND p.missing_since IS NULL';
  title_total bigint;
  total bigint;
  related bigint;
  tsv_col text := 'p.title_tsv';
  snippet_sql text := 'NULL::text';
  cols text :=
    'p.id, p.source, p.company_token, p.company, p.title, p.location, p.country, p.remote, '
    || 'p.work_mode, p.employment_type, p.department, p.category, p.posted_at, p.apply_url, p.salary, '
    || 'p.salary_min_annual, p.salary_max_annual, p.salary_period, p.salary_currency, '
    || 'p.experience_band, p.min_years::integer, p.last_seen, p.agency, ';
BEGIN
  -- THE SAME TERMS, OR'ED, USED ONLY TO ORDER THE RELATED SEGMENT.
  --
  -- websearch_to_tsquery joins bare words with AND, so `q` never matches the
  -- title of a description-only row and ts_rank_cd against title_tsv returns 0
  -- for every one of them. That is the whole related segment tied at zero and
  -- falling through to effective_posted — no relevance ordering at all. This is
  -- the OR form of the same query, so a title carrying SOME of the words
  -- outranks one carrying none.
  --
  -- Built from querytree() rather than by rewriting p_q: replacing spaces with
  -- " or " would break a quoted phrase into disjuncts, while querytree returns
  -- the parsed query with `&` between stemmed lexemes and `<->` inside phrases,
  -- so swapping `&` for `|` loosens the conjunction and leaves phrases whole.
  --
  -- querytree returns 'T' for a query with no indexable lexemes (all stopwords),
  -- and 'T' does not cast back to tsquery. Both that and any future parse
  -- surprise fall back to `q`, where the new key equals the old one and the
  -- ordering is exactly today's.
  IF numnode(q) > 1 THEN
    BEGIN
      q_or := replace(querytree(q), '&', '|')::tsquery;
    EXCEPTION WHEN OTHERS THEN
      q_or := q;
    END;
  ELSE
    q_or := q;
  END IF;

  -- THE PLACE, ONE CONSTANT ARM PER ALIAS (header, 1 and 2).
  IF p_location IS NOT NULL THEN
    FOR v_alias IN SELECT alias.x FROM unnest(string_to_array(p_location, '|')) AS alias(x) LOOP
      IF v_alias ~ '^, [A-Z]{2}$' THEN
        v_code := substr(v_alias, 3, 2);
        v_home := CASE WHEN v_code IN ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK') THEN 'CA' ELSE 'US' END;
        v_loc := v_loc || ('(p.location ILIKE ' || quote_literal('%, ' || v_code || '%') || ' AND p.location ~ ' || quote_literal(', ' || v_code || '($|[^A-Za-z])')
                           || ' AND (p.country IS NULL OR p.country IN (''US'', ''CA'')))');
        v_loc := v_loc || ('(p.location ILIKE ' || quote_literal('%,' || v_code || '%') || ' AND p.location ~ ' || quote_literal(',' || v_code || '($|[^A-Za-z])')
                           || ' AND (p.country IS NULL OR p.country IN (''US'', ''CA'')))');
        v_loc := v_loc || ('(p.location ~ ' || quote_literal('^' || v_code || ' ?([-,]|$)|- ?' || v_code || '($|[^A-Za-z])|^USA? ' || v_code || '($|[^A-Za-z])')
                           || ' AND p.country = ' || quote_literal(v_home) || ')');
      ELSE
        v_loc := v_loc || ('p.location ILIKE ' || quote_literal('%' || v_alias || '%'));
      END IF;
    END LOOP;
    filters := filters || ' AND ' || CASE WHEN cardinality(v_loc) = 0 THEN 'FALSE' ELSE '(' || array_to_string(v_loc, ' OR ') || ')' END;
  END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($4, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($5, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($6)'; END IF;
  IF p_salary_floor IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd >= $7 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd >= $7' END;
  END IF;
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary IS NOT NULL'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($8)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $9'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $10)'; END IF;
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  -- WORK MODE IS A LIST NOW, not a single literal. Elements are validated
  -- against the closed domain and anything else is dropped, so the value that
  -- reaches SQL can only ever be a subset of {remote,hybrid,onsite} — the same
  -- contract p_category already has in this function. A caller sending one mode
  -- gets a one-element list and byte-identical behaviour.
  -- THE FOUR PREVIOUSLY-BLIND FILTERS, inlined the way v_modes already is —
  -- numerics via ::text (no injection surface), the department via
  -- quote_literal — so every positional USING clause stays byte-identical.
  IF p_salary_ceiling IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd <= ' || p_salary_ceiling::text || ' OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd <= ' || p_salary_ceiling::text END;
  END IF;
  -- Closed domain, tested in plpgsql: no caller text ever reaches the SQL.
  IF p_pay_basis = 'hourly' THEN
    filters := filters || ' AND p.salary_period = ''hour''';
  ELSIF p_pay_basis = 'salaried' THEN
    filters := filters || ' AND p.salary_period IN (''year'', ''month'')';
  END IF;
  IF p_max_years IS NOT NULL THEN
    filters := filters || ' AND p.min_years <= ' || p_max_years::integer::text;
  END IF;
  IF p_department IS NOT NULL THEN
    filters := filters || ' AND p.department ILIKE ' || quote_literal('%' || p_department || '%');
  END IF;
  v_modes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_work_mode, ''), ',')) AS m
    WHERE btrim(m) IN ('remote', 'hybrid', 'onsite')
  );
  IF array_length(v_modes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.work_mode = ANY(string_to_array('
                       || quote_literal(array_to_string(v_modes, ',')) || ', '',''))';
  END IF;
  -- EMPLOYMENT TYPE, same closed-domain comma-list contract as work mode:
  -- validated elements only, inlined via quote_literal so no positional
  -- binding shifts and q_or's $16 stays $16.
  v_etypes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_employment_type, ''), ',')) AS m
    WHERE btrim(m) IN ('full_time', 'part_time', 'contract', 'temporary', 'internship')
  );
  IF array_length(v_etypes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.employment_type = ANY(string_to_array('
                       || quote_literal(array_to_string(v_etypes, ',')) || ', '',''))';
  END IF;

  -- AGENCY: a fixed predicate gated on a boolean, so there is no user text to
  -- inline and no positional binding to shift. Binding it here is what lets a
  -- request carrying the opt-out keep the ranked path instead of standing the
  -- RPC down (see the blind-set gate) — the trade the flag shipped with, now
  -- deleted.
  IF p_exclude_agencies THEN
    filters := filters || ' AND p.agency = false';
  END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters || ' LIMIT 10000) c'
    INTO title_total
    USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources;

  total := title_total;

  -- p_title_only: the caller's deadline passed on the full call (header, 3).
  IF title_total < 200 AND p_title_only IS NOT TRUE THEN
    tsv_col := 'p.search_tsv';
    snippet_sql := 'ts_headline(''english'', left(coalesce(p.description, ''''), 4000), $1, ''StartSel=[[, StopSel=]], MaxWords=18, MinWords=8, MaxFragments=1'')';
    EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters || ' LIMIT 3000) c'
      INTO related
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources;
    related := GREATEST(coalesce(related, 0) - title_total, 0);
  END IF;

  IF tsv_col = 'p.search_tsv' THEN
    RETURN QUERY EXECUTE
      'WITH title_hits AS ('
      || '  SELECT p.id AS sid FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
      || '  LIMIT 500'
      || '), desc_hits AS ('
      || '  SELECT p.id AS sid FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters
      || '  ORDER BY p.effective_posted DESC'
      || '  LIMIT 3000'
      || '), sample AS ('
      || '  SELECT sid FROM title_hits UNION SELECT sid FROM desc_hits'
      || '), page AS MATERIALIZED ('
      || '  SELECT p.id AS pid FROM sample JOIN public.job_board_postings p ON p.id = sample.sid'
      || '  ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, CASE WHEN p.title_tsv @@ $1 THEN 0::float4 ELSE ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $16) END DESC, p.effective_posted DESC, p.id ASC'
      || '  LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      || ') SELECT ' || cols || '$12::bigint AS total_rows, $15::bigint AS related_rows, (p.title_tsv @@ $1) AS title_match, ' || snippet_sql || ' AS snippet '
      || 'FROM page JOIN public.job_board_postings p ON p.id = page.pid '
      || 'ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, CASE WHEN p.title_tsv @@ $1 THEN 0::float4 ELSE ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $16) END DESC, p.effective_posted DESC, p.id ASC'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset, related, q_or;
  ELSE
    RETURN QUERY EXECUTE
      'SELECT ' || cols || '$12::bigint AS total_rows, $15::bigint AS related_rows, TRUE AS title_match, NULL::text AS snippet '
      || 'FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
      || ' ORDER BY ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || ' LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset, related;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text, text);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean);
CREATE FUNCTION public.count_jobs_capped(
  p_fresh_cutoff timestamptz,
  p_q text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_remote boolean DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_experience text[] DEFAULT NULL,
  p_salary_floor numeric DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL,
  p_max_age_days integer DEFAULT NULL,
  p_work_mode text DEFAULT NULL,
  p_cap integer DEFAULT 10000,
  p_sources text[] DEFAULT NULL
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false,
  p_salary_ceiling numeric DEFAULT NULL,
  p_pay_basis text DEFAULT NULL,
  p_max_years integer DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_exclude_agencies boolean DEFAULT false
)
RETURNS TABLE (n bigint, capped boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modes text[];
  v_etypes text[];
  v_loc text[] := '{}';
  v_alias text;
  v_code text;
  v_home text;
  filters text := ' WHERE p.effective_posted >= $1 AND p.missing_since IS NULL';
  cap integer := GREATEST(LEAST(p_cap, 100000), 100);
  hits bigint;
BEGIN
  -- THE PLACE, ONE CONSTANT ARM PER ALIAS (header, 1 and 2).
  IF p_location IS NOT NULL THEN
    FOR v_alias IN SELECT alias.x FROM unnest(string_to_array(p_location, '|')) AS alias(x) LOOP
      IF v_alias ~ '^, [A-Z]{2}$' THEN
        v_code := substr(v_alias, 3, 2);
        v_home := CASE WHEN v_code IN ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK') THEN 'CA' ELSE 'US' END;
        v_loc := v_loc || ('(p.location ILIKE ' || quote_literal('%, ' || v_code || '%') || ' AND p.location ~ ' || quote_literal(', ' || v_code || '($|[^A-Za-z])')
                           || ' AND (p.country IS NULL OR p.country IN (''US'', ''CA'')))');
        v_loc := v_loc || ('(p.location ILIKE ' || quote_literal('%,' || v_code || '%') || ' AND p.location ~ ' || quote_literal(',' || v_code || '($|[^A-Za-z])')
                           || ' AND (p.country IS NULL OR p.country IN (''US'', ''CA'')))');
        v_loc := v_loc || ('(p.location ~ ' || quote_literal('^' || v_code || ' ?([-,]|$)|- ?' || v_code || '($|[^A-Za-z])|^USA? ' || v_code || '($|[^A-Za-z])')
                           || ' AND p.country = ' || quote_literal(v_home) || ')');
      ELSE
        v_loc := v_loc || ('p.location ILIKE ' || quote_literal('%' || v_alias || '%'));
      END IF;
    END LOOP;
    filters := filters || ' AND ' || CASE WHEN cardinality(v_loc) = 0 THEN 'FALSE' ELSE '(' || array_to_string(v_loc, ' OR ') || ')' END;
  END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($3, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($4, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($5)'; END IF;
  IF p_salary_floor IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd >= $6 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd >= $6' END;
  END IF;
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary IS NOT NULL'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($7)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $8'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $9)'; END IF;
  IF p_sources IS NOT NULL THEN filters := filters || ' AND p.source = ANY($11)'; END IF;
  -- WORK MODE IS A LIST NOW, not a single literal. Elements are validated
  -- against the closed domain and anything else is dropped, so the value that
  -- reaches SQL can only ever be a subset of {remote,hybrid,onsite} — the same
  -- contract p_category already has in this function. A caller sending one mode
  -- gets a one-element list and byte-identical behaviour.
  -- THE FOUR PREVIOUSLY-BLIND FILTERS, inlined the way v_modes already is —
  -- numerics via ::text (no injection surface), the department via
  -- quote_literal — so every positional USING clause stays byte-identical.
  IF p_salary_ceiling IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd <= ' || p_salary_ceiling::text || ' OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd <= ' || p_salary_ceiling::text END;
  END IF;
  -- Closed domain, tested in plpgsql: no caller text ever reaches the SQL.
  IF p_pay_basis = 'hourly' THEN
    filters := filters || ' AND p.salary_period = ''hour''';
  ELSIF p_pay_basis = 'salaried' THEN
    filters := filters || ' AND p.salary_period IN (''year'', ''month'')';
  END IF;
  IF p_max_years IS NOT NULL THEN
    filters := filters || ' AND p.min_years <= ' || p_max_years::integer::text;
  END IF;
  IF p_department IS NOT NULL THEN
    filters := filters || ' AND p.department ILIKE ' || quote_literal('%' || p_department || '%');
  END IF;
  v_modes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_work_mode, ''), ',')) AS m
    WHERE btrim(m) IN ('remote', 'hybrid', 'onsite')
  );
  IF array_length(v_modes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.work_mode = ANY(string_to_array('
                       || quote_literal(array_to_string(v_modes, ',')) || ', '',''))';
  END IF;
  -- EMPLOYMENT TYPE, same closed-domain comma-list contract as work mode:
  -- validated elements only, inlined via quote_literal so no positional
  -- binding shifts and q_or's $16 stays $16.
  v_etypes := ARRAY(
    SELECT DISTINCT btrim(m)
    FROM unnest(string_to_array(coalesce(p_employment_type, ''), ',')) AS m
    WHERE btrim(m) IN ('full_time', 'part_time', 'contract', 'temporary', 'internship')
  );
  IF array_length(v_etypes, 1) IS NOT NULL THEN
    filters := filters || ' AND p.employment_type = ANY(string_to_array('
                       || quote_literal(array_to_string(v_etypes, ',')) || ', '',''))';
  END IF;
  IF p_q IS NOT NULL AND length(btrim(p_q)) > 0 THEN
    filters := filters || ' AND (p.title ILIKE ''%'' || $10 || ''%'' OR p.company ILIKE ''%'' || $10 || ''%'' OR p.department ILIKE ''%'' || $10 || ''%'')';
  END IF;

  -- AGENCY: a fixed predicate gated on a boolean, so there is no user text to
  -- inline and no positional binding to shift. Binding it here is what lets a
  -- request carrying the opt-out keep the ranked path instead of standing the
  -- RPC down (see the blind-set gate) — the trade the flag shipped with, now
  -- deleted.
  IF p_exclude_agencies THEN
    filters := filters || ' AND p.agency = false';
  END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p' || filters
          || ' LIMIT ' || (cap + 1)::text || ') c'
    INTO hits
    USING p_fresh_cutoff, p_location, p_country, p_category, p_experience,
          p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_q, p_sources;

  IF hits > cap THEN
    RETURN QUERY SELECT cap::bigint, true;
  ELSE
    RETURN QUERY SELECT hits, false;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text, text);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer);
CREATE FUNCTION public.fuzzy_title_search(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_limit integer DEFAULT 40,
  p_location text DEFAULT NULL,
  p_remote boolean DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_experience text[] DEFAULT NULL,
  p_salary_floor numeric DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL,
  p_max_age_days integer DEFAULT NULL,
  p_work_mode text DEFAULT NULL,
  p_vendors text[] DEFAULT NULL
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false,
  p_salary_ceiling numeric DEFAULT NULL,
  p_pay_basis text DEFAULT NULL,
  p_max_years integer DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_exclude_agencies boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text,
  employment_type text, department text, category text, posted_at timestamptz, apply_url text,
  salary text, salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text, experience_band text,
  min_years integer, last_seen timestamptz, missing_since timestamptz,
  agency boolean,
  total_rows bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
DECLARE
  v_loc text[] := '{}';
  v_alias text;
  v_code text;
  v_home text;
  filters text := ' AND p.effective_posted >= $2 AND p.missing_since IS NULL';
BEGIN
  -- 20261008100200's predicates, appended only when they bind (the way
  -- search_jobs builds them), each value read by its position in USING. The
  -- opt-out reaches the RESCUE tier too: binding it only in search_jobs meant a
  -- searcher who asked to hide staffing agencies got a page of them the moment
  -- the exact tier came back empty. A NULL opt-out excluded agencies before
  -- (NOT NULL OR agency = false), and still does.
  IF p_exclude_agencies IS DISTINCT FROM false THEN filters := filters || ' AND p.agency = false'; END IF;
  -- THE PLACE, ONE CONSTANT ARM PER ALIAS (header, 1 and 2).
  IF p_location IS NOT NULL THEN
    FOR v_alias IN SELECT alias.x FROM unnest(string_to_array(p_location, '|')) AS alias(x) LOOP
      IF v_alias ~ '^, [A-Z]{2}$' THEN
        v_code := substr(v_alias, 3, 2);
        v_home := CASE WHEN v_code IN ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK') THEN 'CA' ELSE 'US' END;
        v_loc := v_loc || ('(p.location ILIKE ' || quote_literal('%, ' || v_code || '%') || ' AND p.location ~ ' || quote_literal(', ' || v_code || '($|[^A-Za-z])')
                           || ' AND (p.country IS NULL OR p.country IN (''US'', ''CA'')))');
        v_loc := v_loc || ('(p.location ILIKE ' || quote_literal('%,' || v_code || '%') || ' AND p.location ~ ' || quote_literal(',' || v_code || '($|[^A-Za-z])')
                           || ' AND (p.country IS NULL OR p.country IN (''US'', ''CA'')))');
        v_loc := v_loc || ('(p.location ~ ' || quote_literal('^' || v_code || ' ?([-,]|$)|- ?' || v_code || '($|[^A-Za-z])|^USA? ' || v_code || '($|[^A-Za-z])')
                           || ' AND p.country = ' || quote_literal(v_home) || ')');
      ELSE
        v_loc := v_loc || ('p.location ILIKE ' || quote_literal('%' || v_alias || '%'));
      END IF;
    END LOOP;
    filters := filters || ' AND ' || CASE WHEN cardinality(v_loc) = 0 THEN 'FALSE' ELSE '(' || array_to_string(v_loc, ' OR ') || ')' END;
  END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($6, '',''))'; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($7, '',''))'; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($8)'; END IF;
  IF p_salary_floor IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd >= $9 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd >= $9' END;
  END IF;
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary IS NOT NULL'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($10)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.posted_at > $11'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $12)'; END IF;
  IF p_vendors IS NOT NULL THEN filters := filters || ' AND p.source = ANY($14)'; END IF;
  IF p_salary_ceiling IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd <= $17 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd <= $17' END;
  END IF;
  -- A closed domain, as before: any other basis matched no row, and still does.
  IF p_pay_basis IS NOT NULL THEN
    filters := filters || CASE p_pay_basis
      WHEN 'hourly' THEN ' AND p.salary_period = ''hour'''
      WHEN 'salaried' THEN ' AND p.salary_period IN (''year'', ''month'')'
      ELSE ' AND FALSE' END;
  END IF;
  IF p_max_years IS NOT NULL THEN filters := filters || ' AND p.min_years <= $19'; END IF;
  IF p_department IS NOT NULL THEN filters := filters || ' AND p.department ILIKE ''%'' || $20 || ''%'''; END IF;
  -- Multi-select, as before: string_to_array on one value is a one-element array.
  IF p_work_mode IS NOT NULL THEN filters := filters || ' AND p.work_mode = ANY(string_to_array($13, '',''))'; END IF;
  IF p_employment_type IS NOT NULL THEN filters := filters || ' AND p.employment_type = ANY(string_to_array($21, '',''))'; END IF;

  RETURN QUERY EXECUTE
    'WITH m AS ('
    || '  SELECT p.*, similarity(p.title, $1) AS sim'
    || '  FROM public.job_board_postings p'
    || '  WHERE p.title % $1' || filters
    || '  ORDER BY similarity(p.title, $1) DESC, p.effective_posted DESC'
    || '  LIMIT GREATEST(LEAST($3, 60), 1)'
    || ')'
    || ' SELECT m.id, m.source, m.company_token, m.company, m.title, m.location,'
    || '        m.country, m.remote, m.work_mode, m.employment_type, m.department, m.category,'
    || '        m.posted_at, m.apply_url, m.salary, m.salary_min_annual,'
    || '        m.salary_max_annual, m.salary_period, m.salary_currency,'
    || '        m.experience_band, m.min_years::integer, m.last_seen, m.missing_since,'
    || '        m.agency,'
    || '        (SELECT count(*) FROM m)::bigint AS total_rows'
    || ' FROM m'
    || ' ORDER BY m.sim DESC, m.effective_posted DESC'
    USING p_q, p_fresh_cutoff, p_limit, p_location, p_remote, p_country, p_category,
          p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days,
          p_work_mode, p_vendors, p_pay_stated, p_include_unstated, p_salary_ceiling,
          p_pay_basis, p_max_years, p_department, p_employment_type, p_exclude_agencies;
END;
$$;

-- DROP discards grants, so they are re-issued: service_role only, as they stand.
REVOKE ALL ON FUNCTION public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text, text, boolean) TO service_role;

-- Self-verifying, from the catalog: one signature each, the per-alias builder
-- in each body and no semi-join left, no client role can execute any of them,
-- and each one runs with a state and a name (a malformed arm is a syntax error
-- only at run time, so it is run here, with a term no posting holds).
DO $$
DECLARE
  f text;
  v_n integer;
  v_src text;
  v_rows bigint;
BEGIN
  FOREACH f IN ARRAY ARRAY['search_jobs', 'count_jobs_capped', 'fuzzy_title_search'] LOOP
    SELECT count(*), max(pr.prosrc) INTO v_n, v_src
    FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
    WHERE ns.nspname = 'public' AND pr.proname = f;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% has % signatures in pg_proc; a named-argument call would be ambiguous', f, v_n;
    END IF;
    IF strpos(v_src, 'quote_literal(''^'' || v_code') = 0 OR strpos(v_src, 'quote_literal('','' || v_code') = 0
       OR strpos(v_src, 'quote_literal('', '' || v_code') = 0 THEN
      RAISE EXCEPTION '% does not build the trailing, no-space and leading code arms', f;
    END IF;
    IF strpos(v_src, 'EXISTS (SELECT 1 FROM unnest') > 0 OR strpos(v_src, 'alias.x || ''($|') > 0 THEN
      RAISE EXCEPTION '% still matches the place through a per-row semi-join', f;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
      WHERE ns.nspname = 'public' AND pr.proname = f
        AND (has_function_privilege('anon', pr.oid, 'EXECUTE') OR has_function_privilege('authenticated', pr.oid, 'EXECUTE'))
    ) THEN
      RAISE EXCEPTION '% is executable by a client role', f;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_rows FROM public.search_jobs('zqxjvkw', now(), p_location => 'Ontario|, ON|Boise', p_limit => 1);
  SELECT count(*) INTO v_rows FROM public.search_jobs('zqxjvkw', now(), p_location => 'Texas|, TX', p_limit => 1, p_title_only => true);
  SELECT count(*) INTO v_rows FROM public.count_jobs_capped(now(), 'zqxjvkw', p_location => 'Texas|, TX');
  SELECT count(*) INTO v_rows FROM public.fuzzy_title_search('zqxjvkw', now(), 1, p_location => 'Texas|, TX');
END $$;

NOTIFY pgrst, 'reload schema';
