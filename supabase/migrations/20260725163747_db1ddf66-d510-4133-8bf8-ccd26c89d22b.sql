CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.job_board_embeddings (
  id text PRIMARY KEY REFERENCES public.job_board_postings(id) ON DELETE CASCADE,
  embedding extensions.vector(384) NOT NULL,
  embedded_desc boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_board_embeddings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS job_board_embeddings_hnsw_idx
  ON public.job_board_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS job_board_embeddings_needs_reembed_idx
  ON public.job_board_embeddings (updated_at)
  WHERE embedded_desc = false;

CREATE OR REPLACE FUNCTION public.get_embed_batch(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id text,
  title text,
  company text,
  location text,
  descr text,
  has_desc boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '20s'
AS $$
DECLARE
  lim integer := LEAST(GREATEST(p_limit, 1), 50);
  ids text[];
BEGIN
  SELECT array_agg(x.id) INTO ids FROM (
    SELECT e.id FROM public.job_board_embeddings e
    JOIN public.job_board_postings p ON p.id = e.id
    WHERE e.embedded_desc = false AND p.description IS NOT NULL
    ORDER BY e.updated_at ASC
    LIMIT lim
  ) x;
  ids := COALESCE(ids, '{}');

  IF cardinality(ids) < lim THEN
    SELECT ids || COALESCE(array_agg(x.id), '{}') INTO ids FROM (
      SELECT p.id FROM public.job_board_postings p
      WHERE p.description IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.job_board_embeddings e WHERE e.id = p.id)
      ORDER BY p.effective_posted DESC
      LIMIT lim - cardinality(ids)
    ) x;
  END IF;

  IF cardinality(ids) < lim THEN
    SELECT ids || COALESCE(array_agg(x.id), '{}') INTO ids FROM (
      SELECT p.id FROM public.job_board_postings p
      WHERE p.description IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.job_board_embeddings e WHERE e.id = p.id)
      ORDER BY p.effective_posted DESC
      LIMIT lim - cardinality(ids)
    ) x;
  END IF;

  RETURN QUERY
    SELECT p.id, p.title, p.company, p.location,
           left(coalesce(p.description, ''), 1200) AS descr,
           (p.description IS NOT NULL) AS has_desc
    FROM public.job_board_postings p
    WHERE p.id = ANY(ids);
END;
$$;
REVOKE ALL ON FUNCTION public.get_embed_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_embed_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.search_jobs_semantic(
  p_embedding text,
  p_limit integer DEFAULT 30,
  p_max_distance numeric DEFAULT 0.25
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
  ORDER BY e.embedding <=> p_embedding::extensions.vector(384)
  LIMIT LEAST(GREATEST(p_limit, 1), 60);
$$;
GRANT EXECUTE ON FUNCTION public.search_jobs_semantic(text, integer, numeric) TO anon, authenticated, service_role;