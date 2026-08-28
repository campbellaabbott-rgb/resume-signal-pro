-- EMPLOYMENT TYPE RIDES EVERY PATH FROM DAY ONE.
--
-- The five-filters incident (20260827210000) happened because filters reached
-- the browse path and not the RPCs, silently downgrading every search that
-- used them. This filter ships bound everywhere in one deploy: all three
-- functions re-issued together (DROP + CREATE, bodies extracted
-- programmatically from 20260827210000 — which carries the q_or related-
-- segment ordering — and patched only beside the work-mode pattern), plus the
-- browse path, coverage, UI, saved searches and the digest in the same commit.
--
-- CONTRACTS CARRIED FORWARD UNCHANGED (this file is now the live definition):
--   * p_location is a '|'-joined alias list matched with EXISTS over
--     string_to_array; a location with no pipe is a
--     one-element array and behaves EXACTLY as before.
--     Both functions carry it — search_jobs at $3, count_jobs_capped at $2.
--   * p_work_mode is a validated comma list; title ranking stays weights-only
--     with the q_or related-segment tiebreak.
--
-- Binding follows each function's own style: the two dynamic functions clone
-- the v_modes validated-comma-list + quote_literal inline (no positional
-- USING shifts — q_or's $16 stays $16), and fuzzy adds a static NULL-guarded
-- predicate beside its work-mode clause. p_employment_type is appended LAST
-- with DEFAULT NULL in each signature, so an edge bundle older than this
-- migration calls with the old arity and gets identical behaviour.

DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer);
-- THE LIVE OVERLOADS ARE 20260827210000's OWN — dropping only the pre-210000
-- signatures (as a verbatim body copy does) leaves the old five-filter
-- overloads standing beside the new employment-type ones, and every named-
-- parameter call gets PGRST203. The one-function-one-signature guard computed
-- these exact signatures and refused the build until they appeared here.
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text);
-- And the pre-210000 signatures, kept for any environment that missed that
-- migration — IF EXISTS makes each a no-op where already gone.
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean);


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
  p_employment_type text DEFAULT NULL
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text, employment_type text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text,
  min_years integer, last_seen timestamptz, total_rows bigint,
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
    || 'p.experience_band, p.min_years::integer, p.last_seen, ';
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
  p_employment_type text DEFAULT NULL
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

-- AND THE DOOR THE LOCKDOWN LEFT OPEN, six hours after it was written.
--
-- 20260827130000 revoked SELECT on job_board_postings from anon and dropped its
-- public policy — then waved these three functions off in a comment: "the three
-- search RPCs are SECURITY DEFINER and were already independent of this policy".
-- Being independent of the policy is exactly what makes them the remaining hole.
-- They run as their owner, they were still granted to anon, search_jobs returns
-- WHOLE posting rows including apply_url, and p_offset is bounded only by
-- GREATEST($14, 0) — no ceiling at all.
--
-- Proven live with nothing but the published anon key:
--   POST /rest/v1/rpc/search_jobs
--        {"p_q":"engineer","p_fresh_cutoff":"2026-07-28T00:00:00Z",
--         "p_limit":2,"p_offset":40000}
--   -> HTTP 200, full rows, e.g. Palo Alto Networks "Manager, Site Reliability
--      Engineering" with its apply_url.
--
-- Walking p_offset in steps of 200 over a term dictionary reconstitutes the
-- servable corpus — the same asset the lockdown was written to protect, and the
-- one /v1 exists to meter — with no key, no quota and no per-caller limit,
-- because PostgREST is not the job-board edge function.
--
-- Nothing legitimate loses access: grepping the repo for callers of all three
-- names returns exactly one file, supabase/functions/job-board/index.ts, which
-- authenticates with SUPABASE_SERVICE_ROLE_KEY.
--
-- REVOKED FROM THE CATALOG, NOT BY LISTING SIGNATURES. These functions have been
-- widened several times and this database is known to carry functions the
-- migrations do not describe; a hand-listed REVOKE would miss an overload and
-- silently leave the door open, which is the failure mode this whole change is
-- about.
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

-- And the coverage scan learns the new figure in the same deploy — a filter
-- that hides rows without a disclosure saying how many is the exact defect the
-- coverage machinery exists to prevent.
CREATE OR REPLACE FUNCTION public.get_filter_coverage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '45s'
AS $$
  SELECT jsonb_build_object(
    'open',           count(*),
    'salaryFloor',    count(*) FILTER (WHERE salary_rank_usd IS NOT NULL),
    'workMode',       count(*) FILTER (WHERE work_mode IS NOT NULL),
    'experience',     count(*) FILTER (WHERE experience_band IS NOT NULL AND experience_band <> 'unspecified'),
    'country',        count(*) FILTER (WHERE country IS NOT NULL),
    'payBasis',       count(*) FILTER (WHERE salary_period IS NOT NULL),
    'hasStatedPay',   count(*) FILTER (WHERE salary_min_annual IS NOT NULL),
    'maxYears',       count(*) FILTER (WHERE min_years IS NOT NULL),
    'department',     count(*) FILTER (WHERE department IS NOT NULL),
    'employmentType', count(*) FILTER (WHERE employment_type IS NOT NULL)
  )
  FROM public.job_board_postings
  WHERE missing_since IS NULL
    AND effective_posted >= now() - interval '30 days';
$$;

REVOKE ALL ON FUNCTION public.get_filter_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_filter_coverage() TO service_role;


-- Self-verifying, as anon, because a REVOKE that missed an overload looks
-- exactly like one that worked.
DO $$
DECLARE denied boolean := false;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.search_jobs('x', now() - interval '30 days');
  EXCEPTION
    WHEN insufficient_privilege THEN denied := true;
    WHEN OTHERS THEN denied := false;
  END;
  RESET ROLE;
  IF NOT denied THEN
    RAISE EXCEPTION 'anon can still execute search_jobs — the corpus is still pageable around the edge function';
  END IF;
END $$;

