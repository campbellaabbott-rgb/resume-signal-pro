-- search_jobs_semantic v2 — two audit fixes (2026-07-25):
--
-- 1. FRESHNESS: v1 had no date predicate, so nearest-neighbor results could
--    include postings aged past the 30-day window while they sat in the
--    bounded prune sweep's drain queue — the one read path that violated
--    the board's "never serve past the window" invariant. Same
--    effective_posted basis as every other tier.
--
-- 2. SIMILARITY FLOOR: the 0.25 default distance ceiling (similarity 0.75)
--    let nonsense queries return confident junk — measured live: a garbage
--    string returned camp-counselor and jewelry-sales roles at similarity
--    0.800-0.814, while real role queries score 0.833-0.857. The default
--    ceiling drops to 0.18 (similarity >= 0.82), inside the measured gap:
--    junk suppressed, genuine meaning-matches kept. Still parameterized for
--    probe-driven recalibration without a migration.
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
  ORDER BY e.embedding <=> p_embedding::extensions.vector(384)
  LIMIT LEAST(GREATEST(p_limit, 1), 60);
$$;
GRANT EXECUTE ON FUNCTION public.search_jobs_semantic(text, integer, numeric) TO anon, authenticated, service_role;
