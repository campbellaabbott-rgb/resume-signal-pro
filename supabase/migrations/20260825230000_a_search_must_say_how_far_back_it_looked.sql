-- A SEARCH MUST SAY HOW FAR BACK IT LOOKED.
--
-- THE MEASUREMENT (live, 2026-08-25, anon REST, isolated, p50 of 3):
--
--   q=camarero  limit=5  ->  460 ms
--   q=camarero  limit=10 ->  827 ms
--   q=camarero  limit=20 -> 1516 ms
--   q=camarero  limit=60 -> 2954 ms   (45 rows = every match in the window)
--   q=enfermera limit=5  -> 3246 ms   -> HTTP 500, statement timeout
--
-- Cost is LINEAR IN THE LIMIT and independent of how many rows come back. That
-- is not a sequential scan (a seq scan costs the same at every limit). It is
-- the ORDER BY effective_posted DESC ... LIMIT n walk: Postgres reads the date
-- index backwards and applies `title/company/department ILIKE '%term%'` row by
-- row until it has accumulated n matches. The walk length is
-- (rows-per-match x n), and NOTHING BOUNDS IT. For q=camarero at the board's
-- real fetch size (limit 20 x GROUP_OVERFETCH 3 = 60 rows) the walk is the
-- entire 560,000-row freshness window.
--
-- So the walk cannot be made fast for a rare word. It can only be STOPPED, and
-- the stop can be told to the reader.
--
-- This migration publishes the one number the edge function needs in order to
-- stop at a place it can name: a ladder of (rank, effective_posted) points
-- down the serving order. "Row 50,000 of the freshness window is at
-- 2026-08-24T20:28Z." With that, a page query can bind
-- `effective_posted > <that timestamp>` and the walk is bounded by a row count
-- known before any SQL is issued, instead of by the rarity of the word.
--
-- The predicate does not change. The ordering does not change. The window that
-- is SEARCHED changes, and the response says so, and the next page resumes
-- exactly at the horizon so nothing becomes unreachable.
--
-- Measured cost of the bounded walk, same probe, same terms (limit 60):
--
--                  ~50k rows    ~150k rows    unbounded (560k)
--   camarero          668 ms       1723 ms         2954 ms
--   enfermera         487 ms       1082 ms         3246 ms (500)
--   zzzqqq            664 ms        943 ms         3176 ms (500)
--   welder            390 ms        711 ms          675 ms (fills early)
--
-- NO INDEX IS BUILT HERE, DELIBERATELY.
--   * This table is rewritten continuously by ~31,600 employer feeds. A new
--     index on title/company/department is write amplification on every pass.
--   * Lovable's migration runner wraps every file in a transaction, so
--     CREATE INDEX CONCURRENTLY raises 25001 and never applies — recorded three
--     times in this directory (20260726060000:3-8, 20260728120000:188-190,
--     20260821050000:38-50), and a plain CREATE INDEX takes a write-blocking
--     lock on a live table.
--   * The whole change here is one small jsonb row and two catalog entries.
--
-- KILL SWITCH IS DATA, NOT CODE: delete the job_board_meta row (or let it age
-- past 30 minutes) and the edge function goes back to the unbounded walk. No
-- deploy needed, which matters because functions ship only through an active
-- Lovable session.

-- ---------------------------------------------------------------------------
-- 1. THE LADDER
-- ---------------------------------------------------------------------------
-- One pass down job_board_postings_effective_posted_idx
-- (effective_posted DESC NULLS LAST, id) — the same order the board serves in —
-- sampling every p_step-th row.
--
-- `missing_since IS NULL` is DELIBERATELY OMITTED. Serving binds it; this
-- ladder does not, so a rung's true row count runs ~1% high. That is
-- immaterial: the ladder only chooses WHERE TO STOP, and the stop point it
-- returns is a real timestamp either way. Binding it here would force a heap
-- visit for all 560k rows every tick, on the hottest table on the board, to
-- refine a number whose accuracy nothing depends on.
--
-- Returns points as [rank, effective_posted], rank ascending (so
-- effective_posted descending). The reader's contract is: "to scan at most N
-- rows, bind effective_posted > (the ep of the first point whose rank >= N);
-- if no point has rank >= N, the whole window is inside the budget — bind
-- nothing."
CREATE OR REPLACE FUNCTION public.board_recency_ladder(
  p_step       integer DEFAULT 5000,
  p_fresh_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT p.effective_posted AS ep,
           row_number() OVER (ORDER BY p.effective_posted DESC, p.id ASC) AS rn
    FROM public.job_board_postings p
    WHERE p.effective_posted >= now() - make_interval(days => GREATEST(p_fresh_days, 1))
  ),
  pts AS (
    SELECT rn, ep FROM win WHERE rn % GREATEST(p_step, 500) = 0
  )
  SELECT jsonb_build_object(
    'at',        now(),
    'freshDays', GREATEST(p_fresh_days, 1),
    'step',      GREATEST(p_step, 500),
    -- Rank of the deepest sampled point. Anything past it is "the rest of the
    -- window" and is served unbounded, exactly as today.
    'depth',     COALESCE((SELECT max(rn) FROM pts), 0),
    'points',    COALESCE((SELECT jsonb_agg(jsonb_build_array(rn, ep) ORDER BY rn) FROM pts), '[]'::jsonb)
  );
$$;

-- The edge function must never call this: it is a full index pass. It is
-- reachable only by the cron owner. (This repo has already been bitten once by
-- SECURITY DEFINER functions that a GRANT did not restrict — 107 of 121 were
-- anon-callable. Revoke explicitly, grant explicitly.)
REVOKE ALL ON FUNCTION public.board_recency_ladder(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.board_recency_ladder(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.board_recency_ladder(integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. PUBLISH IT WHERE THE LIST REQUEST ALREADY LOOKS
-- ---------------------------------------------------------------------------
-- job_board_meta is anon-readable and the list action already reads one row
-- from it per request; the edge change widens that read to two keys in the same
-- round trip, so this costs the serving path nothing.
CREATE OR REPLACE FUNCTION public.refresh_recency_ladder()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  -- Bounded like everything else here: if the pass cannot finish in 30s the
  -- tick is abandoned and the previous ladder stands. A stale ladder degrades
  -- to a wider bound, never to a wrong answer.
  PERFORM set_config('statement_timeout', '30000', true);
  v := public.board_recency_ladder(5000, 30);
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('recency_ladder', v, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_recency_ladder() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_recency_ladder() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_recency_ladder() TO service_role;

-- Seed it now so the first request after deploy is already bounded. Inline, not
-- via cron: shipping the schedule and waiting for a tick is how an index
-- silently never got built here before (20260821190000:1-27).
SELECT public.refresh_recency_ladder();

-- Every 5 minutes, offset from the :4 refresh cron so the two never collide.
-- RECURRING, so unlike this repo's index one-shots there is no second push to
-- unschedule and no window in which the schedule is shipped but never ticks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'board-recency-ladder') THEN
    PERFORM cron.schedule(
      'board-recency-ladder',
      '2-59/5 * * * *',
      $job$ SELECT public.refresh_recency_ladder(); $job$
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. STOP THE COUNT THAT NOBODY IS WAITING FOR ANY MORE
-- ---------------------------------------------------------------------------
-- count_jobs_capped runs the SAME unbounded ILIKE predicate as the page (its
-- own comment says so) with no ORDER BY and LIMIT cap+1. For a rare word that
-- is a full pass over the freshness window: measured 2,336 ms for q=camarero.
--
-- The edge function already gives up on it at 1,500 ms — but withDeadline is a
-- Promise.race and DOES NOT CANCEL (index.ts:10199-10208 says this in as many
-- words, and an earlier note counts 88,674 rolled-back transactions from the
-- same shape). So the database keeps the abandoned scan running, on the same
-- table, at the same moment as the page query, the head ring, the fuzzy tier
-- and the semantic tier. That is where a 1.4s isolated page query becomes a
-- 6.4s phaseMs.page_query.
--
-- A statement timeout on the function makes the database stop when the caller
-- stops. It is a catalog change only: no lock, no rewrite, instant, and
-- reversible with RESET.
--
-- RESULTS: unchanged. A count that misses 1,500 ms is already discarded and
-- already published as countUnavailable. The only thing that changes is
-- whether the server keeps paying for it afterwards. 1,400 ms sits just inside
-- the caller's 1,500 ms deadline so the cancel lands first and the edge sees a
-- clean error rather than a race it has already lost.
ALTER FUNCTION public.count_jobs_capped(
  timestamptz, text, text, boolean, text, text, text[], numeric,
  text[], timestamptz, integer, text, integer, text[]
) SET statement_timeout = '1400ms';
