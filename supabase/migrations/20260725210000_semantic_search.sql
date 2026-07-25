-- Semantic search foundation (task #168 — the "careful, last" one).
--
-- Embeddings live in their OWN table, not a column on job_board_postings:
-- the postings table is insert/delete-heavy (30-day rolling churn), and a
-- 1.5KB vector on every row would inflate every write and TOAST round-trip.
-- ON DELETE CASCADE means the churn cleans embeddings up for free.
--
-- Model: gte-small, run INSIDE the edge runtime (Supabase.ai) — 384 dims,
-- no external API, no keys, no per-call cost. English-only and truncated at
-- 512 tokens, which is why the embed input is title + company + the opening
-- slice of the description, not the whole JD.
--
-- embedded_desc records what the vector was computed FROM. A posting embedded
-- from its title alone (description hadn't been fetched yet) is re-embedded
-- when its description lands — the same ingest-only-computation trap that
-- left experience/work_mode/salary stale is designed out from day one.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.job_board_embeddings (
  id text PRIMARY KEY REFERENCES public.job_board_postings(id) ON DELETE CASCADE,
  embedding extensions.vector(384) NOT NULL,
  embedded_desc boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Service-role writes only; reads go through the SECURITY DEFINER RPCs below.
ALTER TABLE public.job_board_embeddings ENABLE ROW LEVEL SECURITY;

-- HNSW created NOW, on the empty table (instant): rows arriving over the
-- multi-day backfill maintain it incrementally, instead of a giant index
-- build over 570k vectors later. Cosine ops; vectors are normalized at
-- generation so cosine and inner-product agree.
CREATE INDEX IF NOT EXISTS job_board_embeddings_hnsw_idx
  ON public.job_board_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- The re-embed queue (title-only rows whose description arrived later) is
-- tiny relative to the table; a partial index makes finding it free forever.
CREATE INDEX IF NOT EXISTS job_board_embeddings_needs_reembed_idx
  ON public.job_board_embeddings (updated_at)
  WHERE embedded_desc = false;

-- The worker's batch feed. Review-hardened (2026-07-25): the first version
-- was a single full-scan LEFT JOIN with an expression ORDER BY that detoasted
-- every description below the sort — the same shape that already produced
-- measured 57014 statement timeouts on this table at a THIRD of its current
-- size (see 20260715130000_ghost_stats_perf.sql). Now: three bounded,
-- ids-first branches; descriptions are detoasted for AT MOST the returned
-- rows; function-local statement_timeout per the house pattern.
--
--   A. re-embeds  — driven from the embeddings side via the partial index
--   B. new rows with a description — newest-first walk of the
--      effective_posted index, NOT EXISTS probes against the embeddings PK
--      (btree hits, microseconds each; a full "nothing left" walk measures
--      seconds, which the hourly settle cadence tolerates)
--   C. title-only rows — same walk, description IS NULL
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
  -- A: description arrived after a title-only embedding
  SELECT array_agg(x.id) INTO ids FROM (
    SELECT e.id FROM public.job_board_embeddings e
    JOIN public.job_board_postings p ON p.id = e.id
    WHERE e.embedded_desc = false AND p.description IS NOT NULL
    ORDER BY e.updated_at ASC
    LIMIT lim
  ) x;
  ids := COALESCE(ids, '{}');

  -- B: unembedded rows that already have a description, newest first
  IF cardinality(ids) < lim THEN
    SELECT ids || COALESCE(array_agg(x.id), '{}') INTO ids FROM (
      SELECT p.id FROM public.job_board_postings p
      WHERE p.description IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.job_board_embeddings e WHERE e.id = p.id)
      ORDER BY p.effective_posted DESC
      LIMIT lim - cardinality(ids)
    ) x;
  END IF;

  -- C: unembedded title-only rows, newest first
  IF cardinality(ids) < lim THEN
    SELECT ids || COALESCE(array_agg(x.id), '{}') INTO ids FROM (
      SELECT p.id FROM public.job_board_postings p
      WHERE p.description IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.job_board_embeddings e WHERE e.id = p.id)
      ORDER BY p.effective_posted DESC
      LIMIT lim - cardinality(ids)
    ) x;
  END IF;

  -- Projection (and the ONLY detoast) over at most `lim` rows.
  RETURN QUERY
    SELECT p.id, p.title, p.company, p.location,
           left(coalesce(p.description, ''), 1200) AS descr,
           (p.description IS NOT NULL) AS has_desc
    FROM public.job_board_postings p
    WHERE p.id = ANY(ids);
END;
$$;
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; this is the schema's
-- most expensive query and maintenance-only — same lockdown as
-- get_quiet_boards / bootstrap-lane (house pattern).
REVOKE ALL ON FUNCTION public.get_embed_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_embed_batch(integer) TO service_role;

-- Nearest-neighbors for a query vector. The vector arrives as TEXT and is
-- cast inside — PostgREST then never has to serialize the pgvector type.
-- No freshness predicate: every postings row is inside the 30-day window by
-- construction (the cap sweep deletes the rest), and the join drops any
-- embedding whose posting vanished mid-flight.
--
-- The distance ceiling defaults to 0.25 (cosine similarity >= 0.75).
-- Review-corrected: the first draft used 0.5, which for gte-small's
-- anisotropic space filters nothing — UNRELATED English text pairs routinely
-- score 0.65-0.8 similarity, which is why Supabase's own gte-small example
-- uses a 0.78 match threshold. Parameterized so probe-driven calibration
-- (the semantic-search action returns similarities) needs no new migration.
-- hnsw.ef_search raised past the 60-row LIMIT ceiling: the default of 40
-- would silently cap an index scan below a full page.
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
