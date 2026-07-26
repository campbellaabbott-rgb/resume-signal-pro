-- EMBED FILL QUEUE — incident fix (2026-07-26, board saturation).
--
-- WHAT HAPPENED: the embed sweep self-chains hop after hop, and every hop
-- called get_embed_batch, whose fallback branches anti-join the ~570k-row
-- postings table ORDER BY effective_posted DESC. That walk re-scans the
-- already-embedded prefix on EVERY call, so each hop costs more than the
-- last — O(embedded-prefix) per hop, run continuously, forever. Measured
-- live: filtered board lists and search timing out at 25s+, the heartbeat
-- climbing 64s -> 103s across the evening, plain limit-1 lists dying. The
-- board looked crashed to users while status still answered.
--
-- THE FIX: stop deriving "what needs embedding" by scanning the corpus.
-- Seed one row per posting into job_board_embeddings with a NULL embedding
-- — the queue IS the table — and read the queue off a partial index. Each
-- batch pick becomes O(limit). A trigger seeds future postings at insert
-- time, so the anti-join below runs exactly once, here, and never again on
-- a request path.
--
-- NULL embeddings are invisible to search by construction: HNSW does not
-- index NULLs, and search_jobs_semantic's distance predicate (NULL <=> vec
-- yields NULL) filters them out. Verified against both live callers.

-- 1) The queue needs NULL to mean "not yet embedded".
ALTER TABLE public.job_board_embeddings ALTER COLUMN embedding DROP NOT NULL;

-- 2) Queue index: the fill reads newest-first off this, O(limit) per call.
--    (Embeddings table, not job_board_postings — the no-plain-CREATE-INDEX
--    rule protects the postings serving path.)
CREATE INDEX IF NOT EXISTS job_board_embeddings_unembedded_idx
  ON public.job_board_embeddings (updated_at DESC)
  WHERE embedding IS NULL;

-- 3) Seed the backlog: one row per posting not yet known to the embeddings
--    table. updated_at carries the posting's own effective_posted so the
--    fill works newest-first. This is the ONE remaining full anti-join —
--    it runs once, in migration context, not per hop.
SET statement_timeout = '300s';
INSERT INTO public.job_board_embeddings (id, embedding, embedded_desc, updated_at)
SELECT p.id, NULL, false, p.effective_posted
FROM public.job_board_postings p
WHERE NOT EXISTS (SELECT 1 FROM public.job_board_embeddings e WHERE e.id = p.id)
ON CONFLICT (id) DO NOTHING;
SET statement_timeout = '20s';

-- 4) Future postings enter the queue at insert time. AFTER INSERT only:
--    the ingest upsert's update path never needs a seed (the row exists).
CREATE OR REPLACE FUNCTION public.seed_embedding_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.job_board_embeddings (id, embedding, embedded_desc, updated_at)
  VALUES (NEW.id, NULL, false, now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_board_postings_seed_embedding ON public.job_board_postings;
CREATE TRIGGER job_board_postings_seed_embedding
  AFTER INSERT ON public.job_board_postings
  FOR EACH ROW EXECUTE FUNCTION public.seed_embedding_row();

-- 5) get_embed_batch v3: queue reads only, no corpus scans.
--    Phase 1 (the fill): NULL-embedding rows, newest first, straight off the
--    partial index. Phase 2 (desc upgrades — title-only rows whose
--    description has since arrived) runs ONLY when the fill queue is empty,
--    so its heavier walk of the embedded_desc=false index is paid at most
--    once per settle cycle, never during the fill. If phase 2 ever exceeds
--    its timeout the sweep stamps a settle and retries in an hour — a
--    self-limiting failure, not a saturating one.
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
SET statement_timeout = '8s'
AS $$
DECLARE
  lim integer := LEAST(GREATEST(p_limit, 1), 50);
  ids text[];
BEGIN
  SELECT COALESCE(array_agg(x.id), '{}') INTO ids FROM (
    SELECT e.id FROM public.job_board_embeddings e
    WHERE e.embedding IS NULL
    ORDER BY e.updated_at DESC
    LIMIT lim
  ) x;

  IF cardinality(ids) = 0 THEN
    SELECT COALESCE(array_agg(x.id), '{}') INTO ids FROM (
      SELECT e.id FROM public.job_board_embeddings e
      JOIN public.job_board_postings p ON p.id = e.id
      WHERE e.embedded_desc = false AND e.embedding IS NOT NULL AND p.description IS NOT NULL
      ORDER BY e.updated_at ASC
      LIMIT lim
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
