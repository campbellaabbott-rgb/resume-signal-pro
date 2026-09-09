-- A DISCLOSURE THAT CANNOT LOAD DISCLOSES NOTHING.
--
-- get_closure_population() exists for one job: to name which boards our
-- lifecycle statistics can and cannot speak for, so that a published closure
-- number stops implying a population it does not cover. Measured live on
-- 2026-09-09 it answers 57014 -- canceling statement due to statement timeout.
-- The one artefact that states the caveat is the one artefact nobody can read,
-- and /status has been rendering `closurePopulation: null` beside the numbers
-- it was written to qualify.
--
-- WHY IT TIMES OUT. Two costs, both structural rather than unlucky.
--
--   1. FOUR FULL SCANS OF THE CLOSURE LOG. The four closures_* columns were
--      four independent scalar subqueries over job_board_closures, one per
--      absence_basis value, so a table of several hundred thousand rows was
--      read four times to produce four numbers that one pass can produce
--      together. This is the dominant term and it grows with the log.
--
--   2. A DISTINCT ON OVER A LEDGER WITH NO INDEX FOR IT. `latest` takes the
--      most recent daily row per board -- DISTINCT ON (company_token) ORDER BY
--      company_token, observed_on DESC -- and job_board_board_state carries
--      only its primary key (company_token, observed_on ASC) and an
--      (observed_on DESC) day index. Neither can serve that ordering, so every
--      call sorted the whole seven-day slice. That table gains one row per
--      board per day and nothing prunes it, so this term grows without bound:
--      it was ~3 days of ~28k boards when the function was written and will be
--      ninety times that by December.
--
-- THE FIX IS BOTH HALVES OF WHAT THAT LIST IMPLIES: a cheaper shape, and a
-- move off the request path.
--
--   * The four scans become one grouped pass with FILTERs.
--   * An index matching the DISTINCT ON exactly, INCLUDEing the two payload
--     columns, so `latest` is an index-only scan with no sort.
--   * The computation moves into refresh_closure_population(), a service-role
--     writer with a ten-minute budget, cached in job_board_stats_rollup under
--     k = 'closure_population' -- the same shape refresh_ghost_stats and
--     get_ghost_job_index_stats have used since 20260808190000, for the same
--     reason: an aggregate over the whole board does not belong on a request.
--   * get_closure_population() keeps its EXACT return shape and its grants and
--     becomes a read of that one row, under a stated 5s timeout.
--
-- as_of CHANGES MEANING, DELIBERATELY, AND IT IS THE HONEST DIRECTION. It used
-- to be now() -- the time the caller asked, which said nothing about the data
-- and would have been a lie the moment the answer was cached. It is now the
-- computed_at of the row being served: when these counts were actually
-- measured. Any renderer must print it as the age of the disclosure. There is
-- no renderer today (the edge function passes the row through into /status), so
-- nothing is being changed underneath a caption; a future one must read as_of.
--
-- AN ABSENT CACHE RETURNS NO ROWS, and that is on purpose. A row of NULLs would
-- be a disclosure claiming to have measured nothing, which is worse than the
-- absence the caller already handles (`closurePop.error ? null : data ?? null`).
-- The migration seeds the row itself so the window between apply and the first
-- cron tick is not that case, and the seed is wrapped so that a slow seed
-- degrades the freshness of one disclosure instead of failing the migration.

-- ── the index `latest` could never use ──────────────────────────────────────
--
-- DROP-first rather than CREATE INDEX IF NOT EXISTS, for the reason
-- 20260827145000 recorded: an interrupted build elsewhere leaves an INVALID
-- index that IF NOT EXISTS skips forever, so the "safe" form is the one that
-- can never heal.
--
-- CREATE INDEX takes a SHARE lock, which blocks the ingest's writes for its
-- duration. This table is small (one row per board per day, upserted) and the
-- build is short, but the 2026-07-19 wedge started with an index build queued
-- behind the 24/7 write loop until the pool was exhausted, so the lock is taken
-- with a timeout and retried rather than queued.
-- THE DROP IS THE STATEMENT THAT CAN BLOCK, so it is the statement inside the
-- handler. The first draft of this block put it ABOVE the LOOP and made the
-- retry unreachable twice over: DROP INDEX takes ACCESS EXCLUSIVE on the table
-- and, once it succeeds, the transaction holds that lock to commit -- so the
-- CREATE inside the handler can no longer raise lock_not_available and the
-- EXCEPTION arm was dead code. Worse, a DROP that hit the 5s lock_timeout
-- raised outside any handler and failed the whole migration, which is the
-- opposite of what the timeout was added for.
--
-- Both statements are inside one handler now: the pair either takes the lock
-- and completes, or is retried. After the DROP lands the CREATE cannot block --
-- it is covered here because it must be retried WITH the drop, not because it
-- is expected to fail on its own.
DO $$
DECLARE attempt int := 0;
BEGIN
  SET LOCAL lock_timeout = '5s';
  LOOP
    attempt := attempt + 1;
    BEGIN
      DROP INDEX IF EXISTS public.job_board_board_state_latest_idx;
      EXECUTE 'CREATE INDEX job_board_board_state_latest_idx '
              'ON public.job_board_board_state (company_token, observed_on DESC) '
              'INCLUDE (state, stored_count)';
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt >= 10 THEN
        RAISE EXCEPTION 'could not take the lock to build job_board_board_state_latest_idx after % attempts; re-run when the ingest is quieter', attempt;
      END IF;
      RAISE NOTICE 'lock busy, retrying index build (attempt %)', attempt;
      PERFORM pg_sleep(2);
    END;
  END LOOP;
END $$;

RESET lock_timeout;

ANALYZE public.job_board_board_state;

-- ── the computation, off the request path ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_closure_population()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10min'
AS $$
DECLARE
  payload jsonb;
BEGIN
  WITH laps AS (
    SELECT COALESCE((SELECT v -> '__laps' FROM public.job_board_meta WHERE k = 'deep_cursor'), '{}'::jsonb) AS m
  ),
  -- The lap map is keyed source:token (a token is carried by more than one
  -- vendor for 139 catalog entries), while job_board_board_state is keyed by
  -- the bare token. Strip the vendor prefix to join. Tokens themselves cannot
  -- contain ':' -- posting ids are source:token:id -- so the first colon is the
  -- separator, and a legacy bare-token key (dropped by the ingest on its next
  -- hop) still matches itself.
  lapinfo AS (
    SELECT
      CASE WHEN position(':' in e.k) > 0
           THEN substr(e.k, position(':' in e.k) + 1)
           ELSE e.k END              AS tok,
      max(e.v ->> 'w')               AS w,
      min(e.v ->> 'w0')              AS w0
    FROM laps, jsonb_each(laps.m) AS e(k, v)
    GROUP BY 1
  ),
  -- One row per board: its most recent daily observation, WITHIN A STATED
  -- WINDOW. Without the bound a board that left the catalogue months ago keeps
  -- contributing its last-known stored_count forever, so the postings figure
  -- would describe rows we no longer hold. Served index-only by
  -- job_board_board_state_latest_idx, which is the whole reason this function
  -- can finish.
  latest AS (
    SELECT DISTINCT ON (company_token)
           company_token, state, stored_count
    FROM public.job_board_board_state
    WHERE observed_on >= current_date - 7
    ORDER BY company_token, observed_on DESC
  ),
  classed AS (
    SELECT
      l.company_token,
      COALESCE(l.stored_count, 0)::bigint AS held,
      CASE
        -- Windowed. It can only prove absence across a completed lap, and the
        -- lap map is the ingest's own record of which boards ever have.
        WHEN l.state = 'truncated' THEN
          CASE
            WHEN li.w IS NOT NULL   THEN 'lap_proven'
            WHEN li.tok IS NOT NULL THEN 'lap_pending'
            ELSE 'unprovable'
          END
        -- BUCKET ON THE VALUES THE WRITER ACTUALLY EMITS, never on
        -- `state <> 'truncated'`. The ingest also writes 'error' for a board
        -- whose fetch died, and `state` can be NULL -- and `NULL <> 'truncated'`
        -- is NULL, not true. Either would have fallen into full_read: the one
        -- bucket this function's own comment tells a reader they may publish as
        -- their population, inflated by exactly the boards that produced no
        -- observation at all, while COALESCE(stored_count, 0) swallowed their
        -- postings so the board count and the posting count disagreed about the
        -- same set.
        WHEN l.state IN ('ok', 'dark', 'empty') THEN 'full_read'
        ELSE 'unobserved'
      END AS bucket
    FROM latest l
    LEFT JOIN lapinfo li ON li.tok = l.company_token
  ),
  boards AS (
    SELECT
      COUNT(*) FILTER (WHERE bucket = 'full_read')::integer            AS boards_full_read,
      COALESCE(SUM(held) FILTER (WHERE bucket = 'full_read'), 0)       AS postings_full_read,
      COUNT(*) FILTER (WHERE bucket = 'lap_proven')::integer           AS boards_lap_proven,
      COALESCE(SUM(held) FILTER (WHERE bucket = 'lap_proven'), 0)      AS postings_lap_proven,
      COUNT(*) FILTER (WHERE bucket = 'lap_pending')::integer          AS boards_lap_pending,
      COALESCE(SUM(held) FILTER (WHERE bucket = 'lap_pending'), 0)     AS postings_lap_pending,
      COUNT(*) FILTER (WHERE bucket = 'unprovable')::integer           AS boards_unprovable,
      COALESCE(SUM(held) FILTER (WHERE bucket = 'unprovable'), 0)      AS postings_unprovable,
      COUNT(*) FILTER (WHERE bucket = 'unobserved')::integer           AS boards_unobserved,
      COALESCE(SUM(held) FILTER (WHERE bucket = 'unobserved'), 0)      AS postings_unobserved
    FROM classed
  ),
  firstlap AS (
    SELECT COUNT(*) FILTER (WHERE w0 IS NOT NULL)::integer AS boards_first_lap,
           min(w0) AS first_lap_earliest
    FROM lapinfo
  ),
  -- ONE PASS, NOT FOUR. These four counts were four separate scalar subqueries
  -- over the same table, each one a full scan, and together they were the term
  -- that spent the budget. Splitting a single scan with FILTER is exactly the
  -- same arithmetic.
  logsplit AS (
    SELECT
      count(*) FILTER (WHERE c.absence_basis = 'full_read')::bigint    AS closures_full_read,
      count(*) FILTER (WHERE c.absence_basis = 'lap')::bigint          AS closures_lap,
      count(*) FILTER (WHERE c.absence_basis = 'lap_backfill')::bigint AS closures_lap_backfill,
      count(*) FILTER (WHERE c.absence_basis IS NULL)::bigint          AS closures_pre_basis
    FROM public.job_board_closures c
  )
  SELECT jsonb_build_object(
    'boards_full_read',      b.boards_full_read,
    'postings_full_read',    b.postings_full_read,
    'boards_lap_proven',     b.boards_lap_proven,
    'postings_lap_proven',   b.postings_lap_proven,
    'boards_lap_pending',    b.boards_lap_pending,
    'postings_lap_pending',  b.postings_lap_pending,
    'boards_unprovable',     b.boards_unprovable,
    'postings_unprovable',   b.postings_unprovable,
    'boards_unobserved',     b.boards_unobserved,
    'postings_unobserved',   b.postings_unobserved,
    'boards_first_lap',      f.boards_first_lap,
    'first_lap_earliest',    f.first_lap_earliest,
    'closures_full_read',    g.closures_full_read,
    'closures_lap',          g.closures_lap,
    'closures_lap_backfill', g.closures_lap_backfill,
    'closures_pre_basis',    g.closures_pre_basis)
  INTO payload
  FROM boards b, firstlap f, logsplit g;

  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  VALUES ('closure_population', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;

COMMENT ON FUNCTION public.refresh_closure_population() IS
  'Measures the population every closure statistic on this board is drawn from '
  'and caches it in job_board_stats_rollup k = ''closure_population''. All of '
  'the meaning lives in the COMMENT on get_closure_population(), which serves '
  'what this writes; this function is the same query with the two costs that '
  'timed it out removed -- one grouped pass over the closure log instead of '
  'four full scans, and a DISTINCT ON that the new '
  'job_board_board_state_latest_idx serves index-only instead of sorting the '
  'whole seven-day slice. Service-role only, ten-minute budget, scheduled at '
  ':09 and :39 past the hour, clear of the explore cache (:07), the facet '
  'sweep (:07/:22/:37/:52) and ghost stats (:05/:35). IT WRITES UNCONDITIONALLY '
  'AND HAS NO PARTIAL-FAILURE MODE: unlike refresh_ghost_stats there is nothing '
  'here worth serving half of -- a population figure whose board buckets are '
  'fresh and whose closure counts are an hour old would size a mixture, which '
  'is the exact error this disclosure exists to prevent. If it raises, the '
  'previous row stands with its own computed_at and the staleness is visible '
  'in as_of.';

REVOKE ALL ON FUNCTION public.refresh_closure_population() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_closure_population() TO service_role;

-- ── the disclosure itself, now a single-row read ────────────────────────────
--
-- CREATE OR REPLACE, not DROP-then-CREATE: the return shape is IDENTICAL to
-- 20260909010000's, column for column and type for type, which is what the
-- edge function reads by name and what src/integrations/supabase/types.ts
-- already declares. Dropping would open a window in which /status's one
-- disclosure call 404s for no reason.
CREATE OR REPLACE FUNCTION public.get_closure_population()
RETURNS TABLE (
  as_of                   timestamptz,
  boards_full_read        integer,
  postings_full_read      bigint,
  boards_lap_proven       integer,
  postings_lap_proven     bigint,
  boards_lap_pending      integer,
  postings_lap_pending    bigint,
  boards_unprovable       integer,
  postings_unprovable     bigint,
  boards_unobserved       integer,
  postings_unobserved     bigint,
  boards_first_lap        integer,
  first_lap_earliest      text,
  closures_full_read      bigint,
  closures_lap            bigint,
  closures_lap_backfill   bigint,
  closures_pre_basis      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '5s'
AS $$
  SELECT
    r.computed_at,
    (r.v ->> 'boards_full_read')::integer,
    (r.v ->> 'postings_full_read')::bigint,
    (r.v ->> 'boards_lap_proven')::integer,
    (r.v ->> 'postings_lap_proven')::bigint,
    (r.v ->> 'boards_lap_pending')::integer,
    (r.v ->> 'postings_lap_pending')::bigint,
    (r.v ->> 'boards_unprovable')::integer,
    (r.v ->> 'postings_unprovable')::bigint,
    (r.v ->> 'boards_unobserved')::integer,
    (r.v ->> 'postings_unobserved')::bigint,
    (r.v ->> 'boards_first_lap')::integer,
    (r.v ->> 'first_lap_earliest'),
    (r.v ->> 'closures_full_read')::bigint,
    (r.v ->> 'closures_lap')::bigint,
    (r.v ->> 'closures_lap_backfill')::bigint,
    (r.v ->> 'closures_pre_basis')::bigint
  FROM public.job_board_stats_rollup r
  WHERE r.k = 'closure_population'
    AND (r.v ->> 'boards_full_read') IS NOT NULL;
$$;

COMMENT ON FUNCTION public.get_closure_population() IS
  'THE POPULATION A CLOSURE NUMBER IS ENTITLED TO CLAIM. Every statistic drawn '
  'from job_board_closures -- fill counts, R(14), the fill curve, the hiring '
  'section -- describes the boards that can PRODUCE a closure, which is not '
  'the same set as "employers" and was silently a small minority of inventory '
  'until 2026-09-08. Five buckets, counted from the latest daily row per board '
  'INSIDE THE LAST SEVEN DAYS plus the ingest''s lap map: (1) boards_full_read '
  '-- state ok/dark/empty, small enough to read in one fetch, absence provable '
  'within a visit, the historical population; (2) boards_lap_proven -- over the '
  'per-visit cap, but a COMPLETE pass over the feed has been assembled across '
  'visits at least once, so closures are now possible here; (3) '
  'boards_lap_pending -- over the cap, being walked, no complete pass yet, so '
  'they report nothing and their silence is not evidence about the employer; '
  '(4) boards_unprovable -- over the cap and unable to complete a lap at all: '
  'vendors whose feed gives us no offset to resume from (ukg, adp, jazzhr, '
  'usajobs), rippling (whose advertised total is our own arithmetic, so a wrap '
  'on it proves nothing), and any tenant that stops serving before its own '
  'stated total. (5) boards_unobserved -- the last observation in the window was '
  'an error or is unreadable, so this function knows NOTHING about them and '
  'says so rather than counting them as read. The postings_* columns are how '
  'many rows we HOLD for each bucket (from job_board_board_state.stored_count, '
  'our count, never the employer''s). boards_first_lap / first_lap_earliest '
  'date the discontinuity: a board''s closures were structurally unobservable '
  'before its first proven lap and observable after, so any cohort whose window '
  'spans that date measures a population that changed mid-window. The '
  'closures_* columns split the log itself by absence_basis; closures_pre_basis '
  'are rows written before the column existed and are all full_read, and '
  'closures_lap_backfill are the first laps'' thirty-day backlog, whose '
  'closed_at is knowingly late and which NO DURATION, RATE OR TENURE STATISTIC '
  'MAY INCLUDE -- as of 20260909200000 every function that reads closed_at '
  'excludes them, and this column is how big the excluded mass is. A published '
  'closure statistic must name at least buckets (1)+(2) as its population, and '
  'must not describe itself as covering employers while (3), (4) and (5) are '
  'non-empty. '
  'IT IS A CACHE READ, NOT A MEASUREMENT. The live form answered 57014 -- '
  'statement timeout -- on 2026-09-09, which made the one artefact that names '
  'the caveat the one artefact nobody could load: four full scans of the '
  'closure log for four counts, and a DISTINCT ON over a board ledger with no '
  'index able to serve it and no prune bounding it. refresh_closure_population() '
  'now measures it every half hour with a ten-minute budget and this reads the '
  'single row. THEREFORE as_of IS THE MEASUREMENT TIME, NOT THE CALL TIME: it '
  'was now() and it is now the row''s computed_at, and any surface that renders '
  'these counts must render as_of beside them as their age. NO ROWS means the '
  'cache has never been written (the seed in 20260909210000 failed and no cron '
  'tick has landed since); the caller already treats that as "no disclosure '
  'available", which is true, where a row of NULLs would be a disclosure '
  'claiming to have measured nothing. SECURITY DEFINER because '
  'job_board_stats_rollup, job_board_board_state and job_board_closures are all '
  'service_role-only; it returns AGGREGATE COUNTS ONLY -- no employer, no '
  'token, no posting -- which is the whole reason it is safe to expose, and the '
  'grants below are deliberate rather than inherited.';

-- NO "REVOKE ... FROM PUBLIC" HERE, DELIBERATELY. PUBLIC and anon are
-- different roles, so revoking one and not the other is the half-measure that
-- left get_top_search_misses reachable, and
-- src/test/revoking-from-public-does-not-revoke-from-anon.test.ts fails it on
-- sight -- correctly. This function is MEANT to be anon-callable: it returns
-- nothing but aggregate counts of which boards our closure statistics can and
-- cannot speak for, which is the disclosure that stops those statistics
-- implying a population they do not cover. If a per-employer or row-level
-- column is ever added to this shape, that is the moment this decision has to
-- be revisited.
GRANT EXECUTE ON FUNCTION public.get_closure_population() TO anon, authenticated, service_role;

-- ── the schedule, and the seed that keeps the gap between them empty ────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- refresh_closure_population() must be called by the refresh job instead';
  ELSE
    -- cron.schedule upserts by jobname, so a re-run updates rather than
    -- duplicates. :09 and :39 are clear of the explore cache (:07), the facet
    -- sweep (:07/:22/:37/:52) and ghost stats (:05/:35).
    PERFORM cron.schedule(
      'refresh-closure-population', '9,39 * * * *',
      $job$ SELECT public.refresh_closure_population(); $job$);
  END IF;
END $$;

-- THE SEED IS NOT IN THIS FILE, and that is the whole point of the split.
--
-- It used to sit here, and it ran inside THIS migration's transaction -- the
-- same transaction whose DO block above takes ACCESS EXCLUSIVE on
-- job_board_board_state and holds it to commit. refresh_closure_population()
-- carries `SET statement_timeout = '10min'`, so seeding here meant holding that
-- lock across the entire first measurement, blocking every write from a 24/7
-- ingest that upserts one row per board per day. The 2026-07-19 wedge this
-- file's index comment cites started exactly that way: a build queued behind
-- the write loop until the pool was exhausted.
--
-- It now lives in 20260909211000, which is a separate file and therefore a
-- separate transaction: this one commits the index and releases the lock
-- first, and the measurement runs against a table nothing is waiting on.
NOTIFY pgrst, 'reload schema';
