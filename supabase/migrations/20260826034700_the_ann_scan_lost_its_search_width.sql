-- search_jobs_semantic: restore SET hnsw.ef_search — it was lost in a rewrite.
--
-- 20260725210000 shipped this function WITH `SET hnsw.ef_search = '100'` and
-- said why in its own header: "raised past the 60-row LIMIT ceiling: the
-- default of 40 would silently cap an index scan below a full page."
-- 20260725234519 kept it. Somewhere after that the setting was dropped while
-- the function was re-issued for other reasons, and the version live today
-- (20260823010000) carries every other GUC — statement_timeout, search_path —
-- but not this one.
--
-- It matters on the path that actually calls this RPC. The semantic rescue
-- tier passes `p_limit: fetchLimit`, which is min(limit*3, 200); the function
-- then clamps to LEAST(GREATEST(p_limit,1),60). So a real rescue can ask for
-- up to 60 neighbours while ef_search caps the scan's candidate list at 40 —
-- the tier returns a short page and nothing reports that it was truncated.
--
-- NOT presented as a measured win. The read-only `semantic-search` probe
-- action clamps p_limit to 30, which is below the threshold where this bites,
-- so no externally reachable path could demonstrate the truncation. What is
-- verifiable is that the setting was deliberate, documented, and is now absent.
--
-- CREATE OR REPLACE with the IDENTICAL signature (text, integer, numeric) —
-- no new overload. This schema has taken a PGRST203 outage from an accidental
-- second overload of a search function; changing nothing but the body and its
-- GUCs is what keeps that from recurring here.
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
