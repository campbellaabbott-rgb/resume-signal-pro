-- The semantic tier is dead because its query never gets a bounded ANN scan.
--
-- search_jobs_semantic answers 57014 (statement timeout) on every call, so the
-- meaning-match rescue tier returns nothing on every search. Measured live
-- 2026-08-27, calling the RPC directly:
--
--   p_limit=30, p_max_distance=0.18 (default)  ->  36.4s  57014
--   p_limit=1,  p_max_distance=0.05            ->  18.2s  57014
--   p_limit=1,  p_max_distance=0.05 (repeat)   ->  23.3s  57014
--   p_limit=60, p_max_distance=0.5             ->  23.5s  57014
--   a REAL query embedding, via the board's own semantic-search action:
--   q="software engineer"                      ->  22.8s  503
--
-- THE COST IS INVARIANT UNDER EVERY KNOB THE QUERY EXPOSES, and that is what
-- identifies the cause. p_limit 1 costs the same as p_limit 60. p_max_distance
-- 0.05 costs the same as 0.5. "software engineer" over a 708k-job corpus has
-- thousands of neighbours far inside 0.18, so a bounded HNSW scan would fill
-- its LIMIT off the first candidate list and return in milliseconds — it took
-- 22.8s. No bounded ANN, at any ef_search, iterative or not, behaves that way.
-- The work being done is proportional to the whole corpus (~708k x 384 float4
-- is ~1.1GB of vector data, the right order of magnitude for 18-36s).
--
-- Interleaved baseline reads before and after each probe returned in 0.22-0.30s,
-- so this is execution time, not a busy pool.
--
-- RULED OUT, rather than assumed away:
--   * sparse/missing embeddings — job_board_embeddings is one row per posting
--     and status.embedSweep reports the fill queue drained, so the index is
--     fully populated;
--   * ef_search — 40 -> 100 is 2.5x candidate work; it cannot turn 0.4s into
--     23s, and the cost does not move with p_limit at all;
--   * the freshness fence being expensive in itself — it is two cheap predicates
--     on an indexed table.
--
-- WHAT THE OLD BODY ASKED FOR. It ordered by `e.embedding <=> $1` *through* a
-- join to job_board_postings, past two post-filters on that other table, past a
-- WHERE on the same distance expression it ordered by, under a non-constant
-- LIMIT (LEAST(GREATEST(p_limit,1),60)). Every one of those is a documented way
-- to lose the pgvector index path, and together they lose it.
--
-- THE FIX IS THE CANONICAL TWO-STAGE SHAPE. The inner query is ORDER BY <=>
-- plus a CONSTANT LIMIT and nothing else — the only form pgvector's index path
-- is guaranteed to match. The fence and the distance ceiling are applied after,
-- to at most a few hundred rows.
--
-- AS MATERIALIZED IS LOAD-BEARING, not decoration. Without it the planner is
-- free to inline the CTE, pull the outer quals down into it, and reconstruct
-- exactly today's query — the fix would apply cleanly and change nothing. Any
-- future edit here must keep it.
--
-- RESULTS ARE UNCHANGED. The distance ceiling is monotone in the same distance
-- the candidates are ordered by, so filtering after top-N returns the same rows
-- in the same order as filtering during. Both fences are still bound, so no tier
-- can serve a posting the employer has withdrawn.
--
-- ef_search = 200, NOT 100. The candidate pool is capped by ef_search, not by
-- LIMIT — this repo's own note says so (20260725210000:136-137) — so asking for
-- 200 candidates under ef_search=100 would silently return 100.
--
-- ONE GENEROUS POOL RATHER THAN A WIDENING RETRY, and the reason is a hard
-- constraint rather than a preference. A retry needs to know how many rows
-- survived the fence before deciding, and there are only two ways to do that:
-- stage the candidates in a temp table (INSERT and CREATE are writes, which a
-- STABLE function may not perform — Postgres refuses them outright), or run the
-- ANN a second time just to count, which doubles the cost of the common case to
-- protect the rare one. hnsw.iterative_scan would sidestep both, but that GUC
-- is not settable by this role here (a recorded 42501).
--
-- So the pool is simply large enough that the retry is unnecessary. With ~563k
-- servable of ~708k embedded (79.5%), 300 candidates yield ~238 survivors
-- against a 60-row ceiling; even at half that servable rate it is ~150. The
-- fence removes a slice, not a majority, because withdrawal is not correlated
-- with embedding distance.
--
-- SIGNATURE UNCHANGED — (text, integer, numeric). Adding or reordering a
-- parameter here creates an OVERLOAD, and one stray overload makes PostgREST
-- answer PGRST203 to every call, which is how affiliate conversion was dead for
-- eight months.
--
-- ef_search = 300, MATCHING THE POOL. The candidate list is capped by ef_search,
-- not by LIMIT — this repo's own note says so (20260725210000:136-137) — so
-- asking for 300 candidates under ef_search=100 would silently return 100.
--
-- LANGUAGE sql and STABLE are kept exactly as they were.
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
SET hnsw.ef_search = '300'
AS $$
  WITH cand AS MATERIALIZED (
    -- STAGE 1: the bounded ANN. ORDER BY <=> and a CONSTANT LIMIT, and nothing
    -- else — no join, no fence, no distance ceiling. This is the only shape
    -- pgvector's index path is guaranteed to match.
    SELECT e.id, (e.embedding <=> p_embedding::extensions.vector(384)) AS dist
    FROM public.job_board_embeddings e
    ORDER BY e.embedding <=> p_embedding::extensions.vector(384)
    LIMIT 300
  )
  -- STAGE 2: ceiling and both fences, over at most 300 rows.
  SELECT p.id, p.source, p.company_token, p.company, p.title,
         p.location, p.remote, p.work_mode, p.department, p.category,
         p.posted_at, p.apply_url, p.salary,
         p.salary_min_annual, p.salary_max_annual,
         p.salary_period, p.salary_currency,
         p.experience_band, p.min_years::integer, p.last_seen,
         round((1 - c.dist)::numeric, 3) AS similarity
  FROM cand c
  JOIN public.job_board_postings p ON p.id = c.id
  WHERE c.dist <= LEAST(GREATEST(p_max_distance, 0.05), 0.5)
    AND p.effective_posted >= now() - interval '30 days'
    AND p.missing_since IS NULL
  ORDER BY c.dist
  LIMIT LEAST(GREATEST(p_limit, 1), 60);
$$;
GRANT EXECUTE ON FUNCTION public.search_jobs_semantic(text, integer, numeric) TO anon, authenticated;

COMMENT ON FUNCTION public.search_jobs_semantic(text, integer, numeric) IS
  'Meaning-match rescue tier. TWO-STAGE BY NECESSITY: the inner scan must be '
  'ORDER BY <=> with a CONSTANT LIMIT and nothing else, or pgvector loses the '
  'index path and the query becomes corpus-scale (measured 18-36s, timing out '
  'on every call, before 20260827160000). Do not push the fence or the distance '
  'ceiling into the candidate CTE, and do not remove AS MATERIALIZED — without '
  'it the planner may inline the CTE and rebuild the slow query exactly.';
