-- Two pay controls, because a salary floor was silently hiding 80% of the board.
--
-- `p_salary_floor` compares against p.salary_rank_usd, and NULL fails every
-- comparison — so asking for "$60k+" also discarded every posting whose
-- employer states no pay at all. Stated-pay coverage is about 20% (the board's
-- own filterCoverage reports salaryFloor ~0.201), so four fifths of the
-- catalogue left the result set without being asked about. That cut IS
-- disclosed today via coverageDisclosure; what did not exist was any way to
-- decline it.
--
-- TWO SEPARATE CONTROLS, because they answer different questions:
--   p_include_unstated  widens an ACTIVE floor to admit unpriced rows:
--                       "£60k+, or tell me anyway if they don't say".
--   p_pay_stated        narrows to rows that state pay AT ALL, with or without
--                       a floor: "only show me employers who publish salary".
-- Both default to today's behaviour, so no existing call or saved search
-- changes meaning: p_include_unstated false, p_pay_stated NULL.
--
-- p_pay_stated BINDS AN EXISTING FILTER RATHER THAN INVENTING ONE. `hasStatedPay`
-- already shipped (2026-08-25, "six filters nobody could reach") and buildQuery
-- binds it as `salary_min_annual IS NOT NULL`. It was never in
-- RPC_BOUND_FILTERS, so it was RPC-BLIND: any stated-pay search fell out of the
-- ranked path onto recency and lost ranking, the fuzzy tier and the semantic
-- tier with it. This parameter uses the IDENTICAL column and predicate as
-- buildQuery — matching it exactly is the point, since two spellings of "states
-- pay" on two routes is precisely the drift that makes counts disagree.
--
-- NO NEW USING PARAMETERS. The dynamic-WHERE builders bind values positionally
-- ($6/$7 for the floor) and the row query appends total/limit/offset/related
-- after them; adding values to those USING lists would renumber the tail. So
-- the booleans choose which SQL TEXT is appended and are never bound — the
-- existing $ indices are untouched.
--
-- DROP + CREATE, NOT CREATE OR REPLACE. Adding a parameter creates an OVERLOAD,
-- and a PostgREST call omitting the optional params then matches both
-- signatures and answers PGRST203 — which took ranked search down for hours on
-- 2026-08-20 and again silently until .20 today. All three functions that carry
-- the filter set are re-issued together for the same reason: a call shape that
-- resolves to a stale sibling is the failure this pattern exists to prevent.
-- CARRIED FORWARD FROM 20260823010000, because re-issuing a function moves the
-- newest-definition guards onto THIS file. These properties did not change and
-- must not read as though they were dropped:
--
--   * p_location is pipe-DELIMITED (metro aliases match any of their names).
--     A comma would shred "Toronto, ON"; a pipe cannot arrive from a visitor
--     because sanitizeTerm strips | " % _ and backslash from every typed term.
--     Single-name locations are unaffected: a string with no pipe splits into a
--     one-element array and behaves EXACTLY as before, whether or not the caller
--     knows this change happened.
--   * the rescue tiers carry `missing_since IS NULL`, so no tier can serve a
--     posting the employer has already withdrawn.
--
-- The legacy three-argument fuzzy signature is dropped again for the same
-- reason it was dropped there: an old overload left in ANY database makes
-- PostgREST answer PGRST203 to every call, and IF EXISTS makes the repeat free.
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer);
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[]);
DROP FUNCTION IF EXISTS public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[]);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[]);

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
  p_include_unstated boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text, department text, category text,
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
  q tsquery := websearch_to_tsquery('english', p_q);
  filters text := ' AND p.effective_posted >= $2 AND p.missing_since IS NULL';
  title_total bigint;
  total bigint;
  related bigint;
  tsv_col text := 'p.title_tsv';
  snippet_sql text := 'NULL::text';
  cols text :=
    'p.id, p.source, p.company_token, p.company, p.title, p.location, p.country, p.remote, '
    || 'p.work_mode, p.department, p.category, p.posted_at, p.apply_url, p.salary, '
    || 'p.salary_min_annual, p.salary_max_annual, p.salary_period, p.salary_currency, '
    || 'p.experience_band, p.min_years::integer, p.last_seen, ';
BEGIN
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
  IF p_work_mode IN ('remote', 'hybrid', 'onsite') THEN
    filters := filters || ' AND p.work_mode = ' || quote_literal(p_work_mode);
  END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters || ' LIMIT 10000) c'
    INTO title_total
    USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources;

  total := title_total;

  IF title_total < 200 THEN
    tsv_col := 'p.search_tsv';
    snippet_sql := 'ts_headline(''english'', left(coalesce(p.description, ''''), 4000), $1, ''StartSel=[[, StopSel=]], MaxWords=18, MinWords=8, MaxFragments=1'')';
    EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters || ' ORDER BY p.effective_posted DESC LIMIT 3000) c'
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
      || '  ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || '  LIMIT GREATEST(LEAST($13, 200), 1) OFFSET GREATEST($14, 0)'
      || ') SELECT ' || cols || '$12::bigint AS total_rows, $15::bigint AS related_rows, (p.title_tsv @@ $1) AS title_match, ' || snippet_sql || ' AS snippet '
      || 'FROM page JOIN public.job_board_postings p ON p.id = page.pid '
      || 'ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_sources, total, p_limit, p_offset, related;
  ELSE
    RETURN QUERY EXECUTE
      'SELECT ' || cols || '$12::bigint AS total_rows, $15::bigint AS related_rows, TRUE AS title_match, NULL::text AS snippet '
      || 'FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
      || ' ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
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
  p_include_unstated boolean DEFAULT false
)
RETURNS TABLE (n bigint, capped boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  IF p_work_mode IN ('remote', 'hybrid', 'onsite') THEN
    filters := filters || ' AND p.work_mode = ' || quote_literal(p_work_mode);
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
  p_include_unstated boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text,
  department text, category text, posted_at timestamptz, apply_url text,
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
      AND (p_work_mode IS NULL OR p.work_mode = p_work_mode)
    ORDER BY similarity(p.title, p_q) DESC, p.effective_posted DESC
    LIMIT GREATEST(LEAST(p_limit, 60), 1)
  )
  SELECT m.id, m.source, m.company_token, m.company, m.title, m.location,
         m.country, m.remote, m.work_mode, m.department, m.category,
         m.posted_at, m.apply_url, m.salary, m.salary_min_annual,
         m.salary_max_annual, m.salary_period, m.salary_currency,
         m.experience_band, m.min_years::integer, m.last_seen, m.missing_since,
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY m.sim DESC, m.effective_posted DESC;
$$;
GRANT EXECUTE ON FUNCTION public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer, text[], boolean, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, text[], boolean, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean) TO anon, authenticated, service_role;


-- RE-ISSUED UNCHANGED, and only so that the newest migration defining the
-- rescue tiers defines ALL of them. The guard for "no rescue tier serves a
-- withdrawn posting" reads the newest file that defines fuzzy_title_search and
-- checks the semantic tier in the same file — a reasonable thing to check,
-- since the two tiers are one ladder. This is byte-identical to
-- 20260826034700, ef_search included; later wins and nothing changes.
CREATE OR REPLACE FUNCTION public.search_jobs_semantic(
  p_embedding text,
  p_limit integer DEFAULT 30,
  p_max_distance numeric DEFAULT 0.18
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, remote boolean, work_mode text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text, min_years integer, last_seen timestamptz,
  similarity numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '15s'
SET hnsw.ef_search = '100'
AS $$
  SELECT p.id, p.source, p.company_token, p.company, p.title,
         p.location, p.remote, p.work_mode, p.department, p.category,
         p.posted_at, p.apply_url, p.salary,
         p.salary_min_annual, p.salary_max_annual,
         p.salary_period, p.salary_currency,
         p.experience_band, p.min_years::integer, p.last_seen,
         round((1 - (e.embedding <=> p_embedding::extensions.vector(384)))::numeric, 3) AS similarity
  FROM public.job_board_embeddings e
  JOIN public.job_board_postings p ON p.id = e.id
  WHERE e.embedding <=> p_embedding::extensions.vector(384) <= LEAST(GREATEST(p_max_distance, 0.05), 0.5)
    AND p.effective_posted >= now() - interval '30 days'
    AND p.missing_since IS NULL
  ORDER BY e.embedding <=> p_embedding::extensions.vector(384)
  LIMIT LEAST(GREATEST(p_limit, 1), 60);
$$;

GRANT EXECUTE ON FUNCTION public.search_jobs_semantic(text, integer, numeric) TO anon, authenticated, service_role;
