-- THE OPT-OUT STOPS COSTING THE RANKING.
--
-- excludeAgencies shipped in 20260831120000 deliberately unbound: no search
-- RPC took a parameter for it, so the blind-set gate routed every request
-- carrying it through buildQuery, which binds the predicate honestly but
-- serves recency instead of relevance. The flag's own comment named this as a
-- trade to be deleted by binding it in SQL later. This is later.
--
-- Measured before the fix (2026-09-01, adjacent controls, repeated): q="nurse"
-- answered ranked with a disclosed 10,000 ceiling; the same query carrying the
-- opt-out answered UNRANKED with an exact 22,467. Both numbers were honest and
-- the ordering was not comparable — but the searcher who asked to hide
-- staffing agencies silently lost relevance ranking, which is the part worth
-- fixing.
--
-- SHAPE. Both bodies are the live definitions from 20260828122000, extracted
-- programmatically and patched in exactly three places: the new parameter
-- appended LAST with a default (an edge bundle older than this migration calls
-- the previous arity and behaves identically), a fixed predicate appended to
-- the dynamic `filters` string under a boolean gate (no user text, so nothing
-- to quote and no positional shift — q_or's $16 stays $16), and, for
-- search_jobs only, p.agency added to the projected columns so a ranked row
-- can carry the disclosure the card renders. That last change closes the
-- documented gap where the badge never appeared on ranked results.
--
-- CONTRACTS CARRIED FORWARD UNCHANGED (this file is the live definition now):
--   * p_location is a '|'-joined alias list matched with EXISTS over
--     string_to_array; a location with no pipe is a
--     one-element array and behaves EXACTLY as before.
--   * p_work_mode and p_employment_type stay validated comma lists inlined via
--     quote_literal, so no positional binding shifts and q_or's $16 stays $16.
--   * fuzzy_title_search is re-issued here UNCHANGED, because the three
--     functions ship together or they drift apart — the five-filters lesson.
--     It gains no agency parameter and needs none: the rescue tiers already
--     stand down whenever a restrictive filter is active, and this flag is one.
--
-- The DROP is catalog-driven. Hand-listing signatures is how this codebase
-- has previously left stale overloads standing beside new ones, and every
-- named-parameter call then fails with PGRST203.
-- The exact signatures this migration replaces, named so the arity guard can
-- see the replacement it is looking for (a catalog sweep alone is invisible to
-- a test that reads SQL text). The sweep below still runs, because the live
-- database has historically held overloads no migration file records.
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text, text);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text, text);

-- Legacy signatures, kept for any environment that missed an earlier
-- migration — IF EXISTS makes each a no-op where already gone.
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean);

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
  p_exclude_agencies boolean DEFAULT false
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

  IF p_location IS NOT NULL THEN filters := filters || ' AND EXISTS (SELECT 1 FROM unnest(string_to_array($3, ''|'')) AS alias(x) WHERE p.location ILIKE ''%'' || alias.x || ''%'')'; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($4, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($5, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($6)'; END IF;
  IF p_salary_floor IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd >= $7 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd >= $7' END;
  END IF;
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary_min_annual IS NOT NULL'; END IF;
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

  IF title_total < 200 THEN
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
  filters text := ' WHERE p.effective_posted >= $1 AND p.missing_since IS NULL';
  cap integer := GREATEST(LEAST(p_cap, 100000), 100);
  hits bigint;
BEGIN
  IF p_location IS NOT NULL THEN filters := filters || ' AND EXISTS (SELECT 1 FROM unnest(string_to_array($2, ''|'')) AS alias(x) WHERE p.location ILIKE ''%'' || alias.x || ''%'')'; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = ANY(string_to_array($3, '','')) '; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = ANY(string_to_array($4, '','')) '; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($5)'; END IF;
  IF p_salary_floor IS NOT NULL THEN
    filters := filters || CASE WHEN p_include_unstated
      THEN ' AND (p.salary_rank_usd >= $6 OR p.salary_rank_usd IS NULL)'
      ELSE ' AND p.salary_rank_usd >= $6' END;
  END IF;
  IF p_pay_stated IS TRUE THEN filters := filters || ' AND p.salary_min_annual IS NOT NULL'; END IF;
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
  p_employment_type text DEFAULT NULL
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text,
  employment_type text, department text, category text, posted_at timestamptz, apply_url text,
  salary text, salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text, experience_band text,
  min_years integer, last_seen timestamptz, missing_since timestamptz,
  total_rows bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
  WITH m AS (
    SELECT p.*, similarity(p.title, p_q) AS sim
    FROM public.job_board_postings p
    WHERE p.title % p_q
      AND p.effective_posted >= p_fresh_cutoff
      AND p.missing_since IS NULL
      AND (p_location IS NULL OR p.location ILIKE '%' || p_location || '%')
      AND (p_remote IS NOT TRUE OR p.remote)
      AND (p_country IS NULL OR p.country = ANY(string_to_array(p_country, ',')))
      AND (p_category IS NULL OR p.category = ANY(string_to_array(p_category, ',')))
      AND (p_experience IS NULL OR p.experience_band = ANY(p_experience))
      AND (p_salary_floor IS NULL
           OR p.salary_rank_usd >= p_salary_floor
           OR (p_include_unstated AND p.salary_rank_usd IS NULL))
      AND (p_pay_stated IS NOT TRUE OR p.salary_min_annual IS NOT NULL)
      AND (p_companies IS NULL OR p.company_token = ANY(p_companies))
      AND (p_posted_after IS NULL OR p.posted_at > p_posted_after)
      AND (p_max_age_days IS NULL OR p.posted_at >= now() - make_interval(days => p_max_age_days))
      AND (p_vendors IS NULL OR p.source = ANY(p_vendors))
      AND (p_salary_ceiling IS NULL
           OR p.salary_rank_usd <= p_salary_ceiling
           OR (p_include_unstated AND p.salary_rank_usd IS NULL))
      AND (p_pay_basis IS NULL
           OR (p_pay_basis = 'hourly' AND p.salary_period = 'hour')
           OR (p_pay_basis = 'salaried' AND p.salary_period IN ('year', 'month')))
      AND (p_max_years IS NULL OR p.min_years <= p_max_years)
      AND (p_department IS NULL OR p.department ILIKE '%' || p_department || '%')
      -- Multi-select, same as the two functions above. string_to_array on a
      -- single value yields a one-element array, so a caller that sends one
      -- mode is unaffected.
      AND (p_work_mode IS NULL OR p.work_mode = ANY(string_to_array(p_work_mode, ',')))
      AND (p_employment_type IS NULL OR p.employment_type = ANY(string_to_array(p_employment_type, ',')))
    ORDER BY similarity(p.title, p_q) DESC, p.effective_posted DESC
    LIMIT GREATEST(LEAST(p_limit, 60), 1)
  )
  SELECT m.id, m.source, m.company_token, m.company, m.title, m.location,
         m.country, m.remote, m.work_mode, m.employment_type, m.department, m.category,
         m.posted_at, m.apply_url, m.salary, m.salary_min_annual,
         m.salary_max_annual, m.salary_period, m.salary_currency,
         m.experience_band, m.min_years::integer, m.last_seen, m.missing_since,
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY m.sim DESC, m.effective_posted DESC;
$$;

-- GRANTS ARE DISCARDED BY DROP, SO THEY ARE RE-ISSUED HERE.
--
-- All three functions were dropped above; without this block they exist and
-- nobody may execute them, which is a total search outage rather than a
-- degraded one. Re-applied FROM THE CATALOG for the reason 20260828122000
-- recorded: this database is known to carry overloads the migration files do
-- not describe, and a hand-listed grant would miss one. The posture is
-- unchanged — definer functions revoked from anon and authenticated, executed
-- only by the service role the edge functions authenticate as.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('search_jobs', 'count_jobs_capped', 'fuzzy_title_search')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;