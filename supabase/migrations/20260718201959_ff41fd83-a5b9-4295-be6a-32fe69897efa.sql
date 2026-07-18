CREATE OR REPLACE FUNCTION public.search_jobs(
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
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, remote boolean, department text, category text,
  posted_at timestamptz, apply_url text, salary text, experience_band text,
  min_years integer, last_seen timestamptz, total_rows bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q tsquery := websearch_to_tsquery('english', p_q);
  filters text := ' AND p.effective_posted >= $2';
  title_total bigint;
  total bigint;
BEGIN
  IF p_location IS NOT NULL THEN filters := filters || ' AND p.location ILIKE ''%'' || $3 || ''%'''; END IF;
  IF p_remote IS TRUE THEN filters := filters || ' AND p.remote'; END IF;
  IF p_country IS NOT NULL THEN filters := filters || ' AND p.country = $4'; END IF;
  IF p_category IS NOT NULL THEN filters := filters || ' AND p.category = $5'; END IF;
  IF p_experience IS NOT NULL THEN filters := filters || ' AND p.experience_band = ANY($6)'; END IF;
  IF p_salary_floor IS NOT NULL THEN filters := filters || ' AND p.salary_min_annual >= $7'; END IF;
  IF p_companies IS NOT NULL THEN filters := filters || ' AND p.company_token = ANY($8)'; END IF;
  IF p_posted_after IS NOT NULL THEN filters := filters || ' AND p.effective_posted > $9'; END IF;
  IF p_max_age_days IS NOT NULL THEN filters := filters || ' AND p.posted_at >= now() - make_interval(days => $10)'; END IF;

  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters || ' LIMIT 10000) c'
    INTO title_total
    USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days;

  IF title_total < 200 THEN
    EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters || ' LIMIT 3000) c'
      INTO total
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days;
    RETURN QUERY EXECUTE
      'WITH cand AS ('
      || '  SELECT p.id AS cid FROM public.job_board_postings p WHERE p.search_tsv @@ $1' || filters || ' LIMIT 3000'
      || ') SELECT p.id, p.source, p.company_token, p.company, p.title, p.location, p.remote, '
      || 'p.department, p.category, p.posted_at, p.apply_url, p.salary, p.experience_band, '
      || 'p.min_years::integer, p.last_seen, $11::bigint AS total_rows '
      || 'FROM cand JOIN public.job_board_postings p ON p.id = cand.cid'
      || ' ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
      || ' LIMIT GREATEST(LEAST($12, 200), 1) OFFSET GREATEST($13, 0)'
      USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, total, p_limit, p_offset;
    RETURN;
  END IF;
  total := title_total;

  RETURN QUERY EXECUTE
    'SELECT p.id, p.source, p.company_token, p.company, p.title, p.location, p.remote, '
    || 'p.department, p.category, p.posted_at, p.apply_url, p.salary, p.experience_band, '
    || 'p.min_years::integer, p.last_seen, $11::bigint AS total_rows '
    || 'FROM public.job_board_postings p WHERE p.title_tsv @@ $1' || filters
    || ' ORDER BY ts_rank_cd(p.title_tsv, $1) DESC, p.effective_posted DESC, p.id ASC'
    || ' LIMIT GREATEST(LEAST($12, 200), 1) OFFSET GREATEST($13, 0)'
    USING q, p_fresh_cutoff, p_location, p_country, p_category, p_experience, p_salary_floor, p_companies, p_posted_after, p_max_age_days, total, p_limit, p_offset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, integer, integer) TO anon, authenticated, service_role;