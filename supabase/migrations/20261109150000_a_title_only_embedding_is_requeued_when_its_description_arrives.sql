-- SUB-HOURLY CRON REVIEW MARKER: not required. This file creates or changes no
-- cron schedule (reviewed 2026-11-16 by the project owner).
--
-- A TITLE-ONLY EMBEDDING IS REQUEUED WHEN ITS DESCRIPTION ARRIVES.
--
-- Cost audit 2026-11-08, "Embed re-queue". get_embed_batch's phase 2
-- (20260812200000) finds title-only embeddings whose description has since
-- arrived by PROBING: it reads the 1,000 oldest title-only rows of
-- job_board_embeddings, looks each one up in job_board_postings, hands out the
-- hits, and "rotates" every miss to the back by bumping its updated_at. That
-- bump is a non-HOT update of a row carrying a 384-dimension vector: a new heap
-- tuple, a new entry in the HNSW index and in both updated_at indexes, and a
-- dead tuple, for up to a thousand rows per call -- and the ~7,800 rows whose
-- posting never gets a description cycle through it forever.
--
-- THE FIX IS AN EXPLICIT QUEUE, FILLED AT THE MOMENT A DESCRIPTION ARRIVES:
--   job_board_embed_requeue (id, queued_at)       one row per posting to
--                                                 re-embed with its text.
--   job_board_postings_description_arrived        AFTER UPDATE OF description,
--                                                 fires only when the old value
--                                                 is NULL and the new one is
--                                                 not; it queues the id.
--   get_embed_batch phase 2                       reads the queue instead of
--                                                 probing: prunes entries that
--                                                 are done (embedded with text),
--                                                 gone (posting or embedding
--                                                 row deleted) or moot (no
--                                                 description), hands out the
--                                                 oldest entries that are
--                                                 title-only and now described,
--                                                 and moves those to the back
--                                                 of the queue -- a write to the
--                                                 small queue table only.
--
-- NOTHING ELSE CHANGES. Phase 1 (never-embedded rows, newest first) is
-- byte-for-byte as before and still runs first. The return shape, the
-- VOLATILE marking, the eight-second header and the service-role grant are
-- unchanged, and the caller -- the embed sweep in job-board, which upserts
-- {id, embedding, embedded_desc: has_desc, updated_at} -- needs no change: a
-- handed-out entry is pruned on the next phase-2 call once its row says
-- embedded_desc. job_board_embeddings is no longer written by this function.
--
-- WHAT THE QUEUE COVERS, AND WHY THAT IS EVERYTHING THE PROBE FOUND. A
-- title-only embedding exists only when a posting was embedded while its
-- description was NULL. Its description can later appear only by an UPDATE
-- (the description sweeps and the detail read fill `description IS NULL`
-- rows; the ingest never rewrites a stored description) -- which the trigger
-- sees -- or by the row being deleted and inserted again, which cascades the
-- embedding away and seeds a fresh never-embedded row for phase 1. The rows
-- the probe could find TODAY are seeded below.
--
-- THE LOCK. CREATE TRIGGER takes SHARE ROW EXCLUSIVE on job_board_postings,
-- which the 24/7 ingest writes. It is taken last in this file, under a
-- two-second lock_timeout retried five times (so it can never queue the
-- ingest behind it for longer than that), and held only for the seed -- a
-- primary-key join over the few thousand title-only rows -- and the
-- catalogue check. Holding it until the transaction ends is also what makes the seed
-- exact: no description can be written between the seed's read and the
-- trigger becoming visible.
--
-- Re-runnable: IF NOT EXISTS for the table and its index, CREATE OR REPLACE
-- for the functions, the trigger created only when absent, the seed ON
-- CONFLICT DO NOTHING. Self-verifying below.

CREATE TABLE IF NOT EXISTS public.job_board_embed_requeue (
  id        text PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_board_embed_requeue_queued_idx
  ON public.job_board_embed_requeue (queued_at);
ALTER TABLE public.job_board_embed_requeue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_board_embed_requeue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_board_embed_requeue TO service_role;

COMMENT ON TABLE public.job_board_embed_requeue IS
  'Postings embedded from their title alone whose description has since '
  'arrived, waiting to be embedded again with the text. Filled by the '
  'job_board_postings_description_arrived trigger (description NULL to not '
  'NULL) and drained by get_embed_batch phase 2, which prunes an entry once '
  'its embedding row says embedded_desc. queued_at is queue position: an entry '
  'handed out moves to the back. Private: service_role only.';

-- ── the trigger function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.queue_description_reembed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.job_board_embed_requeue AS q (id) VALUES (NEW.id)
  ON CONFLICT ON CONSTRAINT job_board_embed_requeue_pkey DO NOTHING;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.queue_description_reembed() IS
  'Trigger function for job_board_postings_description_arrived: queues the '
  'posting for a re-embed with its text. AFTER ROW, returns NULL, writes only '
  'job_board_embed_requeue. Not callable by clients.';

REVOKE ALL ON FUNCTION public.queue_description_reembed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_description_reembed() TO service_role;

-- ── the batch, reading the queue ────────────────────────────────────────────
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
BEGIN
  -- Phase 1, unchanged: rows never embedded at all, newest first.
  SELECT COALESCE(array_agg(x.id), '{}') INTO ids FROM (
    SELECT e.id FROM public.job_board_embeddings e
    WHERE e.embedding IS NULL
    ORDER BY e.updated_at DESC
    LIMIT lim
  ) x;

  IF cardinality(ids) = 0 THEN
    -- Phase 2: the queue. First drop what no longer needs a re-embed: the
    -- embedding was written with text, the posting or its embedding row is
    -- gone, or the posting has no description after all. Only the thousand
    -- oldest entries are looked at, so a call costs the same however long the
    -- queue grows; handed-out entries move to the back, so the head turns over.
    DELETE FROM public.job_board_embed_requeue dq
     WHERE dq.id IN (
       SELECT r.id
         FROM (SELECT h.id FROM public.job_board_embed_requeue h
                ORDER BY h.queued_at LIMIT 1000) r
         LEFT JOIN public.job_board_embeddings e ON e.id = r.id
         LEFT JOIN public.job_board_postings p ON p.id = r.id
        WHERE e.id IS NULL
           OR p.id IS NULL
           OR e.embedded_desc
           OR p.description IS NULL);

    -- Then hand out the oldest entries whose embedding is title-only and whose
    -- posting now has its text, and move them to the back so an entry whose
    -- embed keeps failing cannot hold the head of the queue.
    WITH picked AS (
      SELECT r.id AS rid
        FROM public.job_board_embed_requeue r
        JOIN public.job_board_embeddings e ON e.id = r.id
        JOIN public.job_board_postings p ON p.id = r.id
       WHERE e.embedding IS NOT NULL
         AND NOT e.embedded_desc
         AND p.description IS NOT NULL
       ORDER BY r.queued_at
       LIMIT lim
       FOR UPDATE OF r SKIP LOCKED
    ),
    moved AS (
      UPDATE public.job_board_embed_requeue q
         SET queued_at = now()
        FROM picked
       WHERE q.id = picked.rid
      RETURNING q.id AS qid
    )
    SELECT COALESCE(array_agg(m.qid), '{}') INTO ids FROM moved m;
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
  'Embedding work queue. Phase 1: never-embedded rows, newest first. Phase 2 '
  '(20261109150000): title-only rows whose description has since arrived, read '
  'from job_board_embed_requeue, which the job_board_postings_description_arrived '
  'trigger fills -- done, gone and undescribed entries are pruned, the oldest '
  'described ones are handed out and moved to the back of the queue. It no '
  'longer probes job_board_embeddings or bumps its updated_at (20260812200000 '
  'did, for up to 1,000 rows a call: non-HOT updates of vector rows). VOLATILE '
  'because the queue writes; its only caller is the embed-sweep maintenance action.';

REVOKE ALL ON FUNCTION public.get_embed_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_embed_batch(integer) TO service_role;

-- ── the trigger and the seed, last, under a bounded lock wait ───────────────
DO $$
DECLARE
  tries integer := 0;
  n     bigint;
BEGIN
  LOOP
    EXIT WHEN EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgname = 'job_board_postings_description_arrived'
         AND tgrelid = 'public.job_board_postings'::regclass);
    tries := tries + 1;
    BEGIN
      SET LOCAL lock_timeout = '2s';
      CREATE TRIGGER job_board_postings_description_arrived
        AFTER UPDATE OF description ON public.job_board_postings
        FOR EACH ROW
        WHEN (OLD.description IS NULL AND NEW.description IS NOT NULL)
        EXECUTE FUNCTION public.queue_description_reembed();
    EXCEPTION WHEN lock_not_available THEN
      IF tries >= 5 THEN
        RAISE EXCEPTION 'could not take the trigger lock on job_board_postings in five two-second tries; nothing was changed, apply again';
      END IF;
      RAISE NOTICE 'job_board_postings is busy (try %), waiting a second', tries;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  SET LOCAL lock_timeout TO DEFAULT;

  -- The rows phase 2's probe could find today: title-only embeddings whose
  -- posting already carries a description.
  INSERT INTO public.job_board_embed_requeue AS q (id, queued_at)
  SELECT e.id, e.updated_at
    FROM public.job_board_embeddings e
    JOIN public.job_board_postings p ON p.id = e.id
   WHERE e.embedded_desc = false
     AND e.embedding IS NOT NULL
     AND p.description IS NOT NULL
  ON CONFLICT ON CONSTRAINT job_board_embed_requeue_pkey DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'job_board_embed_requeue seeded with % title-only rows that already have a description', n;
END $$;

-- The end state, read back from the catalogue.
DO $verify$
DECLARE
  f   oid := to_regprocedure('public.get_embed_batch(integer)');
  src text;
  cfg text[];
  vol "char";
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'job_board_postings_description_arrived'
       AND t.tgrelid = 'public.job_board_postings'::regclass
       AND NOT t.tgisinternal
       AND t.tgfoid = 'public.queue_description_reembed()'::regprocedure
       AND pg_get_triggerdef(t.oid) ~ 'AFTER UPDATE OF description'
       AND pg_get_triggerdef(t.oid) ~ 'old\.description IS NULL\) AND \(new\.description IS NOT NULL'
  ) THEN
    RAISE EXCEPTION 'job_board_postings_description_arrived is missing or not the NULL-to-text trigger';
  END IF;
  SELECT p.prosrc, p.proconfig, p.provolatile INTO src, cfg, vol FROM pg_proc p WHERE p.oid = f;
  IF position('job_board_embed_requeue' IN src) = 0 THEN
    RAISE EXCEPTION 'get_embed_batch phase 2 does not read the queue';
  END IF;
  IF src ~ 'UPDATE public\.job_board_embeddings' THEN
    RAISE EXCEPTION 'get_embed_batch still writes job_board_embeddings';
  END IF;
  IF vol <> 'v' OR NOT ('statement_timeout=8s' = ANY (cfg)) THEN
    RAISE EXCEPTION 'get_embed_batch lost its VOLATILE marking or its eight-second header';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_embed_batch is callable by a client role';
  END IF;
  IF has_table_privilege('anon', 'public.job_board_embed_requeue', 'SELECT')
     OR has_table_privilege('authenticated', 'public.job_board_embed_requeue', 'SELECT')
     OR has_table_privilege('anon', 'public.job_board_embed_requeue', 'INSERT')
     OR has_table_privilege('authenticated', 'public.job_board_embed_requeue', 'INSERT') THEN
    RAISE EXCEPTION 'job_board_embed_requeue is readable or writable by a client role';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
