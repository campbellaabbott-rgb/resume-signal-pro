CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS job_board_postings_title_trgm_idx ON public.job_board_postings USING gin (title gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.fuzzy_title_search(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_limit integer DEFAULT 40
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
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
  WITH m AS (
    SELECT p.*, similarity(p.title, p_q) AS sim
    FROM public.job_board_postings p
    WHERE p.title % p_q
      AND p.effective_posted >= p_fresh_cutoff
    ORDER BY similarity(p.title, p_q) DESC, p.effective_posted DESC
    LIMIT GREATEST(LEAST(p_limit, 60), 1)
  )
  SELECT id, source, company_token, company, title, location, remote,
         department, category, posted_at, apply_url, salary, experience_band,
         min_years::integer, last_seen,
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY sim DESC, effective_posted DESC;
$$;
GRANT EXECUTE ON FUNCTION public.fuzzy_title_search(text, timestamptz, integer) TO anon, authenticated, service_role;