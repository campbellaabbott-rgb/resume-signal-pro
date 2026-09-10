-- THE BUCKET WE COMPUTED AND THREW AWAY.
--
-- refresh_closure_population() (20260909210000) sorts every board observed in
-- the last seven days into one of five observability buckets -- full_read,
-- lap_proven, lap_pending, unprovable, unobserved -- and then keeps only the
-- COUNTS. The per-board verdict, the one thing that says whether a given
-- employer's absences are observable at all, was computed twice an hour and
-- discarded twice an hour.
--
-- 20260909217000 and 20260909217500 need it per board. A posting on a windowed
-- board with no proven lap can never be seen to come down, so "still advertised
-- at day 30" is 1.0 there BY CONSTRUCTION, and the only honest day-30 figure
-- for such a board is none. Measured live on 2026-09-10 from
-- get_closure_population(): boards_full_read 43381, boards_lap_proven 125,
-- boards_lap_pending 378, boards_unprovable 117, boards_unobserved 304; from
-- the status action, deepCursor.laps tracking 505, proven 130, disarmed 14,
-- firstLapAt 2026-09-09T15:09:37Z. Laps are proving as of yesterday afternoon;
-- the gate is not hypothetical and it is not permanent.
--
-- WHAT THIS DOES. job_board_board_observability(company_token PK, bucket,
-- lap_w0, as_of) is written by the SAME refresh, from the SAME classification
-- CTE, in the SAME statement that produces the cached counts -- a
-- data-modifying WITH, so the table and the disclosure can never describe two
-- different passes over the board ledger. Rows whose as_of was not touched by
-- the pass are deleted afterwards: a board that left the seven-day window
-- leaves the table, exactly as it leaves the counts. lap_w0 is the ingest's
-- own record of when the board's first lap opened, the observability boundary
-- 20260909010000 describes; it is carried so a caption can print it.
--
-- The counts and their keys are unchanged; get_closure_population() is not
-- touched. The function stays service-role only with the same ten-minute
-- budget, the same :09/:39 schedule, and the same no-partial-failure rule --
-- if the write fails the counts are not written either, and the previous rows
-- stand with their own as_of.
--
-- WHY THE TABLE'S DDL ALSO APPEARS IN 20260909217000. A LANGUAGE sql body is
-- validated at CREATE and that file sorts first, so it issues the identical
-- CREATE TABLE IF NOT EXISTS ahead of the function that reads it. This file
-- owns the table: its comments, its grants' rationale, and its writer.
--
-- THE SEED IS ITS OWN STATEMENT, NOT ITS OWN FILE, and that is deliberate:
-- 20260909211000 split the seed out because 210000's transaction held an
-- ACCESS EXCLUSIVE lock on a hot table while the ten-minute measurement ran.
-- Nothing in this file takes a lock on a hot table -- the new table is empty
-- and unreferenced by the ingest -- so the seed runs here, wrapped so a slow
-- first measurement degrades the freshness of one table instead of failing
-- the migration.

-- ── the table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_board_board_observability (
  company_token text PRIMARY KEY,
  bucket        text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
  lap_w0        timestamptz,
  as_of         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_board_board_observability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_board_board_observability FROM anon, authenticated;
GRANT ALL ON public.job_board_board_observability TO service_role;

COMMENT ON TABLE public.job_board_board_observability IS
  'One row per board observed in the last seven days: which of the five '
  'observability buckets refresh_closure_population() put it in, written by '
  'that refresh from the same classification that produces the cached counts '
  'get_closure_population() serves, in the same statement. It exists so a '
  'per-employer or per-field statistic that depends on ABSENCE being '
  'observable can refuse where it is not: a board over the page cap with no '
  'completed lap cannot be seen to take a posting down, so any survival figure '
  'over it reads 1.0 by construction. Only full_read and lap_proven may carry '
  'such a figure. A board with no row here was not observed in the window and '
  'must be treated as NOT admitted. Service-role only; read through SECURITY '
  'DEFINER functions that publish aggregates, never the rows.';
COMMENT ON COLUMN public.job_board_board_observability.bucket IS
  'full_read: the whole board is read within a visit, absences observable. '
  'lap_proven: over the cap, at least one completed lap, absences observable '
  'from lap_w0 onward. lap_pending: over the cap, being walked, no complete '
  'pass yet -- nothing provable. unprovable: over the cap and unable to '
  'complete a lap at all. unobserved: the last observation in the window was '
  'an error or unreadable; nothing is known. The values are the ones '
  'get_closure_population() counts, spelled identically.';
COMMENT ON COLUMN public.job_board_board_observability.lap_w0 IS
  'When the board''s first lap opened, from the ingest''s lap map (__laps.w0). '
  'The observability boundary for a windowed board: closures before it were '
  'structurally unobservable. NULL for a board that has never been lapped.';
COMMENT ON COLUMN public.job_board_board_observability.as_of IS
  'The pass that wrote this row. Every row carries the same as_of after a '
  'refresh; a row older than the newest is a board that left the window and '
  'is deleted by the same refresh.';

-- ── the refresh, now keeping what it computes ────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_closure_population()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10min'
AS $$
DECLARE
  payload jsonb;
  v_as_of timestamptz := now();
BEGIN
  WITH laps AS (
    SELECT COALESCE((SELECT m.v -> '__laps' FROM public.job_board_meta m WHERE m.k = 'deep_cursor'), '{}'::jsonb) AS m
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
  -- WINDOW. Served index-only by job_board_board_state_latest_idx.
  latest AS (
    SELECT DISTINCT ON (s.company_token)
           s.company_token, s.state, s.stored_count
    FROM public.job_board_board_state s
    WHERE s.observed_on >= current_date - 7
    ORDER BY s.company_token, s.observed_on DESC
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
        -- `state <> 'truncated'`: the ingest also writes 'error', `state` can
        -- be NULL, and `NULL <> 'truncated'` is NULL, not true.
        WHEN l.state IN ('ok', 'dark', 'empty') THEN 'full_read'
        ELSE 'unobserved'
      END AS bucket,
      -- w0 is an ISO instant written by the ingest; anything else is not a
      -- boundary and must not fail the whole refresh.
      CASE WHEN li.w0 ~ '^\d{4}-\d{2}-\d{2}T' THEN li.w0::timestamptz END AS lap_w0
    FROM latest l
    LEFT JOIN lapinfo li ON li.tok = l.company_token
  ),
  -- THE PER-BOARD VERDICT, KEPT. Same CTE, same pass, same statement as the
  -- counts below; a data-modifying WITH runs exactly once whether or not the
  -- outer query reads it.
  written AS (
    INSERT INTO public.job_board_board_observability AS o (company_token, bucket, lap_w0, as_of)
    SELECT x.company_token, x.bucket, x.lap_w0, v_as_of
    FROM classed x
    ON CONFLICT (company_token) DO UPDATE
      SET bucket = EXCLUDED.bucket,
          lap_w0 = EXCLUDED.lap_w0,
          as_of  = EXCLUDED.as_of
    RETURNING o.company_token
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
  -- ONE PASS, NOT FOUR, split with FILTER.
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

  -- A board that left the seven-day window leaves the table, as it leaves the
  -- counts. Same transaction as the upsert, so a reader sees one pass or the
  -- previous one, never a mixture.
  DELETE FROM public.job_board_board_observability o
   WHERE o.as_of < v_as_of;

  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  VALUES ('closure_population', payload, v_as_of)
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;

COMMENT ON FUNCTION public.refresh_closure_population() IS
  'Measures the population every closure statistic on this board is drawn from '
  'and caches it in job_board_stats_rollup k = ''closure_population''. All of '
  'the meaning lives in the COMMENT on get_closure_population(), which serves '
  'what this writes; this function is the same query with the two costs that '
  'timed it out removed -- one grouped pass over the closure log instead of '
  'four full scans, and a DISTINCT ON that '
  'job_board_board_state_latest_idx serves index-only instead of sorting the '
  'whole seven-day slice. Service-role only, ten-minute budget, scheduled at '
  ':09 and :39 past the hour, clear of the explore cache (:07), the facet '
  'sweep (:07/:22/:37/:52) and ghost stats (:05/:35). IT WRITES UNCONDITIONALLY '
  'AND HAS NO PARTIAL-FAILURE MODE: a population figure whose board buckets are '
  'fresh and whose closure counts are an hour old would size a mixture, which '
  'is the exact error this disclosure exists to prevent. If it raises, the '
  'previous row stands with its own computed_at and the staleness is visible '
  'in as_of. '
  'AS OF 20260909217800 IT ALSO KEEPS THE PER-BOARD VERDICT: the same '
  'classification CTE that produces the five bucket counts is written, in the '
  'same statement, to job_board_board_observability (company_token, bucket, '
  'lap_w0, as_of), and rows the pass did not touch are deleted afterwards. '
  'The table and the cached counts therefore always describe one pass over '
  'job_board_board_state. That table is what lets a day-30 survival figure '
  'refuse on a board whose absences cannot be observed.';

REVOKE ALL ON FUNCTION public.refresh_closure_population() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_closure_population() TO service_role;

-- ── the schedule: unchanged, re-issued so a fresh database has it ───────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- refresh_closure_population() must be called by the refresh job instead';
  ELSE
    PERFORM cron.schedule(
      'refresh-closure-population', '9,39 * * * *',
      $job$ SELECT public.refresh_closure_population(); $job$);
  END IF;
END $$;

-- ── the seed, so the gate has rows before the next :09/:39 tick ─────────────
-- No hot-table lock is held by this transaction (see the header), so the seed
-- may run here. A failure leaves the table empty, which the readers treat as
-- "nothing admitted": every day-30 column is NULL until the first tick lands.
DO $$
DECLARE n bigint;
BEGIN
  PERFORM public.refresh_closure_population();
  SELECT count(*) INTO n FROM public.job_board_board_observability;
  RAISE NOTICE 'job_board_board_observability seeded with % rows', n;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'observability seed failed (%); the :09/:39 cron will fill it', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
