-- THE EMBED SWEEP HAS BEEN FAILING EVERY CYCLE, AND THE QUEUE CANNOT SAY SO.
--
-- Status has shown the same line for days:
--
--     embedSweep: { note: "batch error: canceling statement due to statement
--                   timeout", ageMin: <fresh> }
--
-- so the semantic-search vector fill — the tier that makes niche searches work
-- — is silently not being built. The failing statement is get_embed_batch's
-- phase 2:
--
--     SELECT e.id FROM job_board_embeddings e
--     JOIN job_board_postings p ON p.id = e.id
--     WHERE e.embedded_desc = false AND e.embedding IS NOT NULL
--       AND p.description IS NOT NULL
--     ORDER BY e.updated_at ASC LIMIT :lim
--
-- The partial index (needs_reembed_idx) covers the embeddings-side predicate,
-- but the deciding filter lives on the OTHER TABLE: each candidate must be
-- probed against postings for `description IS NOT NULL`. The walk is oldest-
-- first, and rows that fail the probe stay exactly where they are — so the
-- oldest prefix of the queue fills up with permanent misses, every call
-- re-probes the same prefix, and once the prefix outgrows what 8 seconds can
-- probe, every call times out forever. The queue has no way to get healthier,
-- because nothing that happens in this function moves a miss out of the way.
--
-- Same failure class as the structured-sweep cursor bug fixed this morning:
-- a walk whose predicate cannot clear itself, parked on the one stretch it can
-- never get past.
--
-- THE FIX IS ROTATION. Phase 2 now probes a BOUNDED slice (1,000 oldest
-- candidates — a fixed cost that always fits the budget), returns the hits,
-- and REQUEUES the misses by bumping their updated_at to now(). Misses move to
-- the back of the ASC walk, so the next call sees a fresh prefix, and every
-- description-bearing row is reached within (queue size / 1,000) calls. When a
-- miss's description later arrives via desc-sweep, it is already back in the
-- rotation.
--
-- Consequences of the requeue, considered:
--   - The function becomes VOLATILE (it was STABLE). Its only caller is the
--     embed-sweep maintenance action via .rpc(), which is a POST; nothing
--     depends on it being side-effect-free.
--   - embeddings.updated_at loses "time the row was written" semantics and
--     becomes queue position. Nothing else reads it: phase 1 orders a disjoint
--     subset (embedding IS NULL, untouched here), and no other function or
--     index uses the column.
--   - Orphaned embeddings rows (posting pruned, embedding left behind) would
--     never be visited by an inner join and would clog the prefix exactly like
--     description-less rows. The probe uses a LEFT JOIN and treats a missing
--     posting as a miss, so orphans rotate harmlessly instead of wedging the
--     queue. Deleting them is a separate decision this function does not take.
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
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
DECLARE
  lim integer := LEAST(GREATEST(p_limit, 1), 50);
  ids text[];
  hits text[] := '{}';
  misses text[] := '{}';
  probe record;
BEGIN
  -- Phase 1, unchanged: rows never embedded at all, newest first.
  SELECT COALESCE(array_agg(x.id), '{}') INTO ids FROM (
    SELECT e.id FROM public.job_board_embeddings e
    WHERE e.embedding IS NULL
    ORDER BY e.updated_at DESC
    LIMIT lim
  ) x;

  IF cardinality(ids) = 0 THEN
    -- Phase 2: title-only rows whose description may have arrived since.
    -- Bounded probe over the 1,000 oldest candidates; hits are returned,
    -- misses are rotated to the back so the prefix cannot wedge.
    FOR probe IN
      SELECT e.id AS eid, (p.description IS NOT NULL) AS ok
      FROM (
        SELECT eq.id, eq.updated_at
        FROM public.job_board_embeddings eq
        WHERE eq.embedded_desc = false AND eq.embedding IS NOT NULL
        ORDER BY eq.updated_at ASC
        LIMIT 1000
      ) e
      LEFT JOIN public.job_board_postings p ON p.id = e.id
      ORDER BY e.updated_at ASC
    LOOP
      IF probe.ok AND cardinality(hits) < lim THEN
        hits := hits || probe.eid;
      ELSIF NOT COALESCE(probe.ok, false) THEN
        misses := misses || probe.eid;
      END IF;
    END LOOP;
    IF cardinality(misses) > 0 THEN
      UPDATE public.job_board_embeddings
      SET updated_at = now()
      WHERE public.job_board_embeddings.id = ANY(misses);
    END IF;
    ids := hits;
  END IF;

  RETURN QUERY
    SELECT p.id, p.title, p.company, p.location,
           left(coalesce(p.description, ''), 1200) AS descr,
           (p.description IS NOT NULL) AS has_desc
    FROM public.job_board_postings p
    WHERE p.id = ANY(ids);
END;
$$;

COMMENT ON FUNCTION public.get_embed_batch(integer) IS
  'Embedding work queue. Phase 1: never-embedded rows, newest first. Phase 2: '
  'title-only rows probed against postings for an arrived description over a '
  'BOUNDED 1,000-row slice — hits returned, misses ROTATED to the back of the '
  'queue by bumping updated_at, because an ordered walk whose oldest prefix '
  'fills with permanent misses re-probes that prefix on every call and times '
  'out forever (measured: the sweep settled on "batch error: statement '
  'timeout" for days). VOLATILE because the rotation writes; its only caller '
  'is the embed-sweep maintenance action.';

NOTIFY pgrst, 'reload schema';
