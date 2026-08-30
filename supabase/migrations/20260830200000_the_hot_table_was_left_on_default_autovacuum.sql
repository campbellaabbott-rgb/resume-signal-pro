-- THE BOARD'S HOTTEST TABLE WAS LEFT ON DEFAULT AUTOVACUUM, AND THEN GIVEN
-- THE BIGGEST UPDATE WAVES IT HAS EVER SEEN.
--
-- MEASURED on production 2026-08-30, minutes before this was written:
--   {action:"list", limit:1, includeFacets:false}  ->  30.2s
--   phaseMs.page_query = 29,455ms
-- That is the cheapest query the board has: an indexed read of ONE row, ordered
-- by effective_posted DESC behind the two serving fences. It is normally
-- 0.2-0.4s. The ingest rotation degraded in step — sliceStats.lastMs 184,951
-- against a healthy ~20-25s — and the facets cache fell 111 minutes stale.
--
-- IT IS NOT A MISSING INDEX. job_board_postings_effective_posted_idx
-- (20260712160000) and job_board_postings_missing_since_idx (20260728120000)
-- both exist and cover this path. What changed is the ratio of DEAD tuples the
-- index scan has to walk to find live ones.
--
-- WHERE THE DEAD TUPLES CAME FROM. Every UPDATE in Postgres writes a new row
-- version and leaves the old one dead until vacuum reclaims it. Today the board
-- ran two of the largest update waves in its history over this table: the
-- employment_type backfill across the corpus, and the per-visit corrections
-- patcher — the one capped at 1,000 rows/visit in build .50 precisely because
-- it was already saturating writes. On top of that the rotation upserts every
-- posting it re-fetches, ~24k boards deep.
--
-- WHY AUTOVACUUM NEVER CAUGHT UP. 20260827181000 correctly killed two runaway
-- VACUUM cron jobs and handed the steady state back to autovacuum — with its
-- DEFAULTS, which are tuned for tables far smaller than this one:
--
--   autovacuum_vacuum_scale_factor = 0.2   ->  on ~700k rows, autovacuum waits
--                                              for ~140,000 dead tuples before
--                                              it will even start
--   autovacuum_vacuum_cost_limit   = 200   ->  and then works so slowly that a
--                                              table still taking writes can
--                                              outrun it indefinitely
--
-- So the table accumulates six figures of dead rows between passes, every index
-- scan walks them, and a one-row lookup turns into thirty seconds. This is the
-- whole mechanism; nothing about the query or its indexes is wrong.
--
-- THE FIX IS A STORAGE PARAMETER, NOT A CRON JOB. 20260827181000's post-mortem
-- is explicit that scheduled VACUUMs on this table were the previous cure that
-- became the disease: they take a ShareUpdateExclusiveLock and compete with
-- for I/O with both the rotation and every serving query, and one of them could not even
-- unschedule itself (VACUUM cannot run inside pg_cron's transaction). This
-- migration schedules NOTHING. It changes when autovacuum — which is already
-- running, already throttled, and already able to yield to queries — decides
-- this table is dirty enough to visit.
--
-- ALTER TABLE ... SET (...) is a catalog-only change. It takes a brief
-- SHARE UPDATE EXCLUSIVE lock — it does NOT block reads or writes, only other
-- vacuum/DDL on this table — applies in milliseconds, and rewrites no data.
-- Stated precisely because the first draft of this line said ACCESS EXCLUSIVE,
-- which is the lock that WOULD stall every query, and that is exactly the
-- sentence that decides whether a fix ships during an incident or after it.
ALTER TABLE public.job_board_postings SET (
  -- 2% instead of 20%: autovacuum wakes at ~14k dead rows rather than ~140k, so
  -- it runs often and briefly instead of rarely and catastrophically.
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  -- ANALYZE just as eagerly: the planner's row estimates drive the count path
  -- (`estimated` escalates to an exact count when it thinks a result set is
  -- small), and stale statistics on a table this size are how a text query's
  -- count started timing out today.
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 5000,
  -- 10x the default work budget per round. The point is to let autovacuum keep
  -- PACE with an ingest that never stops; at the default 200 it cannot, and a
  -- vacuum that never finishes is the same as no vacuum at all. Still cost-based
  -- and still yields — this is not a blocking VACUUM.
  autovacuum_vacuum_cost_limit = 2000
);

-- Leave room ON the page for updated row versions, so an UPDATE can often reuse
-- the same page instead of dirtying a new one. Applies to pages written from
-- here on rather than rewriting the table, so it helps the steady state rather
-- than this minute — which is the right trade for a change that must not itself
-- cause an outage.
ALTER TABLE public.job_board_postings SET (fillfactor = 90);

-- The two ledger tables the rotation writes on every pass have the same shape of
-- churn at a smaller scale. Same treatment, same reasoning.
ALTER TABLE public.job_board_meta SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05
);

-- Self-verifying: the settings must actually be on the table. A migration that
-- silently no-ops is worse than one that fails, because the next person reads
-- the file and believes it.
DO $$
DECLARE opts text[];
BEGIN
  SELECT reloptions INTO opts FROM pg_class
   WHERE oid = 'public.job_board_postings'::regclass;
  IF opts IS NULL OR NOT (array_to_string(opts, ',') LIKE '%autovacuum_vacuum_scale_factor=0.02%') THEN
    RAISE EXCEPTION 'autovacuum tuning did not apply to job_board_postings (reloptions: %)', opts;
  END IF;
END $$;
