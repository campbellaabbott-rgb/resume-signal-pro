-- Stop serving postings the employer's own feed has already dropped.
--
-- missing_since is stamped when a posting fails to appear in a SUCCESSFUL
-- fetch of its company's feed (two-pass confirmed, see 20260716200000). It is
-- the strongest "this is gone" signal on the board — and NOTHING in the
-- serving path filtered it. Not buildQuery in the edge function, not
-- search_jobs, not count_jobs_capped. So the postings the Ghost Job Index
-- exists to name were being served as live results.
--
-- Precision was measured before shipping: of 1,000 stamped ids, 117 were
-- confirmed deleted at the vendor within 21 minutes and only 2 flickered back
-- live (98.3%). Rows that DO come back have missing_since cleared by the
-- normal refresh, so this filter self-heals.
--
-- Both RPCs build one shared `filters` string, so adding the predicate to each
-- base declaration covers every query shape in both — title tier, description
-- tier, and the capped count.
--
-- Regenerated verbatim from 20260726144636 with that single line changed in
-- each function; nothing else in either body is touched.

-- Migration 20260726020000: salary floor USD + fresh sample
DROP FUNCTION IF EXISTS public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer);

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
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, remote boolean, work_mode text, department text, category text,
  posted_at timestamptz, apply_url text, salary text,
  salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text,
  experience_band text,
  min_years integer, last_seen timestamptz, total_rows bigint, snippet text
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
  tsv_col text := 'p.title_tsv';
  snippet_sql text := 'NULL::text';
  cols text :=
    'p.id, p.source, p.company_token, p.company, p.title, p.location, p.remote, '
    || 'p.work_mode, p.department, p.category, p.posted_at, p.apply_url, p.salary, '
    || 'p.salary_min_annual, p.salary_max_annual, p.salary_period, p.salary_currency, '
    || 'p.experience_band, p.min_years::integer, p.last_seen, ';
BEGIN
  IF p_location IS NOT NULL THEN filters := filters || ' AND p.location ILIKE ''%'' || $3 || ''%'''; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = $4'; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = $5'; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($6)'; END IF;
  IF p_salary_floor IS NOT NULL THEN filters := filters || ' AND p.salary_rank_usd >= $7'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($8)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.effective_posted > $9'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $10)'; END IF;
  IF p_work_mode IN ('remote', 'hybrid', 'onsite') THEN
    filters := filters || ' AND p.work_mode = ' || quote_literal(p_work_mode);
  END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters || ' LIMIT 10000) c'
    INTO title_total
    USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days;

  IF title_total < 200 THEN
    tsv_col := 'p.search_tsv';
    snippet_sql := 'ts_headline(''english'', left(coalesce(p.description, ''''), 4000), $1, ''StartSel=[[, StopSel=]], MaxWords=18, MinWords=8, MaxFragments=1'')';
    EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters || ' LIMIT 3000) c'
      INTO total
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days;
  ELSE
    total := title_total;
  END IF;

  IF tsv_col = 'p.search_tsv' THEN
    RETURN QUERY EXECUTE
      'WITH sample AS ('
      || '  SELECT p.id AS sid FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters
      || '  ORDER BY p.effective_posted DESC'
      || '  LIMIT 3000'
      || ') SELECT ' || cols || '$11::bigint AS total_rows, ' || snippet_sql || ' AS snippet '
      || 'FROM sample JOIN public.job_board_postings p ON p.id = sample.sid '
      || 'ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || ' LIMIT GREATEST(LEAST($12, 200), 1) OFFSET GREATEST($13, 0)'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, total, p_limit, p_offset;
  ELSE
    RETURN QUERY EXECUTE
      'SELECT ' || cols || '$11::bigint AS total_rows, NULL::text AS snippet '
      || 'FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
      || ' ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || ' LIMIT GREATEST(LEAST($12, 200), 1) OFFSET GREATEST($13, 0)'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, total, p_limit, p_offset;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer, integer) TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.count_jobs_capped(
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
  p_cap integer DEFAULT 10000
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
  IF p_location IS NOT NULL THEN filters := filters || ' AND p.location ILIKE ''%'' || $2 || ''%'''; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = $3'; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = $4'; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($5)'; END IF;
  IF p_salary_floor IS NOT NULL THEN filters := filters || ' AND p.salary_rank_usd >= $6'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($7)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.effective_posted > $8'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $9)'; END IF;
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
          p_salary_floor, p_companies, p_posted_after, p_max_age_days, p_q;

  IF hits > cap THEN
    RETURN QUERY SELECT cap::bigint, true;
  ELSE
    RETURN QUERY SELECT hits, false;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.count_jobs_capped(timestamptz, text, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, integer) TO anon, authenticated, service_role;

-- Migration 20260726030000: digest cadence
ALTER TABLE public.user_job_searches
  ADD COLUMN IF NOT EXISTS digest_cadence text NOT NULL DEFAULT 'weekly'
  CHECK (digest_cadence IN ('daily', 'weekly'));

-- The predicate above is cheap in the serving path (it filters rows already
-- fetched via the effective_posted index, and ~99% pass). This partial index
-- is for OBSERVABILITY: counting the hidden rows currently returns HTTP 500 on
-- statement timeout, even scoped to one vendor, so we cannot verify the fix's
-- effect without it.
--
-- Built through the one-shot cron pattern established in
-- 20260726060000_build_speed_indexes_oneshot.sql, because Lovable's migration
-- runner wraps migrations in a transaction (CONCURRENTLY refuses) and the SQL
-- editor's statement timeout cancels long builds. Unlike that file's GIN over
-- 573k rows, this index is PARTIAL over only the stamped rows (a few thousand),
-- so the write-blocking SHARE lock lasts seconds, not minutes.
CREATE OR REPLACE FUNCTION public.build_missing_since_index_oneshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $fn$
BEGIN
  -- Unschedule FIRST so a failure can never thrash-retry a write-blocking build.
  PERFORM cron.unschedule('build-missing-since-index-oneshot');
  CREATE INDEX IF NOT EXISTS job_board_postings_missing_since_idx
    ON public.job_board_postings (missing_since)
    WHERE missing_since IS NOT NULL;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.build_missing_since_index_oneshot() TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'build-missing-since-index-oneshot') THEN
    PERFORM cron.schedule(
      'build-missing-since-index-oneshot',
      '* * * * *',
      $job$ SELECT public.build_missing_since_index_oneshot(); $job$
    );
  END IF;
END $do$;
