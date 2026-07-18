-- Freshness + search at the 400k+ scale.
--
-- 1) get_quiet_boards: boards with NO new postings inside the window — the
--    rotation gives them a slower lane (every 2nd rotation) so the fetch
--    budget concentrates on boards where postings actually appear and close.
--    Service-role only: refresh machinery, not a public stat.
CREATE OR REPLACE FUNCTION public.get_quiet_boards(days integer DEFAULT 14)
RETURNS TABLE (company_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.company_token
  FROM public.job_board_postings p
  GROUP BY p.company_token
  HAVING max(p.first_seen) < now() - make_interval(days => GREATEST(LEAST(days, 60), 1));
$$;
REVOKE ALL ON FUNCTION public.get_quiet_boards(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiet_boards(integer) TO service_role;

-- 2) Relevance search vector over the fields users actually search.
--    Generated column keeps it maintenance-free; GIN makes it fast.
ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(department, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS job_board_postings_search_tsv_idx
  ON public.job_board_postings USING gin (search_tsv);

-- 3) search_jobs: relevance-ranked search carrying EVERY board filter, so the
--    ranked path composes with country/category/experience/salary/freshness
--    exactly like the recency path. Title matches (weight A) outrank company
--    and department mentions; recency breaks ties. total_rows rides along via
--    a window count so the caller gets page + total in one round trip.
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.source, p.company_token, p.company, p.title,
         p.location, p.remote, p.department, p.category,
         p.posted_at, p.apply_url, p.salary, p.experience_band,
         p.min_years, p.last_seen,
         count(*) OVER () AS total_rows
  FROM public.job_board_postings p
  WHERE p.search_tsv @@ websearch_to_tsquery('english', p_q)
    AND p.effective_posted >= p_fresh_cutoff
    AND (p_location IS NULL OR p.location ILIKE '%' || p_location || '%')
    AND (p_remote IS NULL OR p.remote = p_remote)
    AND (p_country IS NULL OR p.country = p_country)
    AND (p_category IS NULL OR p.category = p_category)
    AND (p_experience IS NULL OR p.experience_band = ANY (p_experience))
    AND (p_salary_floor IS NULL OR p.salary_min_annual >= p_salary_floor)
    AND (p_companies IS NULL OR p.company_token = ANY (p_companies))
    AND (p_posted_after IS NULL OR p.effective_posted > p_posted_after)
    AND (p_max_age_days IS NULL OR p.posted_at >= now() - make_interval(days => p_max_age_days))
  ORDER BY ts_rank_cd(p.search_tsv, websearch_to_tsquery('english', p_q)) DESC,
           p.effective_posted DESC, p.id ASC
  LIMIT GREATEST(LEAST(p_limit, 200), 1)
  OFFSET GREATEST(p_offset, 0);
$$;
GRANT EXECUTE ON FUNCTION public.search_jobs(text, timestamptz, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, integer, integer) TO anon, authenticated, service_role;
