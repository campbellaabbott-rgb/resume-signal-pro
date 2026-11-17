-- lovable-cron-fallback-reviewed: no cron; this file creates or changes no cron schedule (reviewed 2026-11-16 by the project owner).
--
-- A BOARD VERDICT IS REWRITTEN ONLY WHEN THE BOARD CHANGED BUCKET.
--
-- Cost audit 2026-11-08, "Closure population". refresh_closure_population()
-- (20260909217800) runs at :09 and :39 and upserts EVERY board observed in the
-- last seven days into job_board_board_observability, stamping each row with
-- the pass's as_of so the trailing DELETE could find boards that left the
-- window by an old stamp. About 44,000 boards a pass, 48 passes a day: some
-- 2.1M row versions a day, almost all of them writing the same bucket and
-- lap_w0 the row already held, each leaving a dead tuple behind.
--
-- WHAT CHANGES, AND ONLY THIS:
--   1. The upsert writes a row only where the verdict moved. Its source
--      leaves out every board whose stored (bucket, lap_w0) already equals
--      the new pair, so an unchanged board's row is neither rewritten nor
--      locked: ON CONFLICT DO UPDATE locks the conflicting row BEFORE its
--      WHERE is read, so a WHERE alone would still stamp xmax on all 44,000
--      rows and dirty their pages. The ON CONFLICT ... WHERE (bucket, lap_w0)
--      IS DISTINCT FROM the new pair stays, for a row another pass wrote
--      between the read and the insert.
--   2. A board that left the seven-day window is deleted by name -- it is not
--      in this pass's classification -- in the SAME statement as the upsert
--      (a second data-modifying CTE), instead of by an as_of older than the
--      pass. The two CTEs touch disjoint rows: the upsert only boards in the
--      classification, the delete only boards outside it.
--   3. as_of therefore means "the pass that last CHANGED this row's verdict"
--      (the column's description is restated below). Nothing outside this
--      function reads it: the per-board readers use bucket and lap_w0 only.
--
-- WHAT DOES NOT CHANGE. The classification CTEs, the counts, every key of the
-- cached payload, its computed_at, the closure-log split, the ten-minute
-- header, the :09/:39 schedule, the service-role grant and the no-partial-
-- failure rule (one statement writes the verdicts; the counts row follows in
-- the same transaction) are byte-for-byte the 20260909217800 function's. The
-- set of rows in the table after a pass, and every bucket and lap_w0 in it,
-- is the same as before -- src/test/a-board-verdict-is-rewritten-only-when-
-- the-board-changed-bucket.test.ts runs both functions over one fixture and
-- compares the published numbers and the table.
--
-- The closure-log split's full-heap read is the other half of the audit item
-- and is answered by an index built outside any transaction
-- (20261109141000); this file needs nothing from it.
--
-- Re-runnable (CREATE OR REPLACE and COMMENT only). Self-verifying below.

COMMENT ON COLUMN public.job_board_board_observability.as_of IS
  'The pass that last CHANGED this row''s verdict (bucket or lap_w0), as of '
  '20261109140000. A pass that classifies a board the same way leaves its row '
  'untouched, so rows carry different as_of values; a board that left the '
  'seven-day window is deleted by the same pass by name. The cached counts '
  'say when the last pass ran (job_board_stats_rollup k = '
  '''closure_population'', computed_at).';

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
  -- THE PER-BOARD VERDICT, KEPT -- and now written only where it moved. Same
  -- CTE, same pass, same statement as the counts below; a data-modifying WITH
  -- runs exactly once whether or not the outer query reads it. An existing
  -- row whose bucket and lap_w0 already match never reaches the INSERT, so
  -- it is left as it is: no new row version, no dead tuple and no row lock.
  written AS (
    INSERT INTO public.job_board_board_observability AS o (company_token, bucket, lap_w0, as_of)
    SELECT x.company_token, x.bucket, x.lap_w0, v_as_of
    FROM classed x
    LEFT JOIN public.job_board_board_observability cur ON cur.company_token = x.company_token
    WHERE cur.company_token IS NULL
       OR (cur.bucket, cur.lap_w0) IS DISTINCT FROM (x.bucket, x.lap_w0)
    ON CONFLICT (company_token) DO UPDATE
      SET bucket = EXCLUDED.bucket,
          lap_w0 = EXCLUDED.lap_w0,
          as_of  = EXCLUDED.as_of
      WHERE (o.bucket, o.lap_w0) IS DISTINCT FROM (EXCLUDED.bucket, EXCLUDED.lap_w0)
    RETURNING o.company_token
  ),
  -- A board that left the seven-day window leaves the table, as it leaves the
  -- counts: it is named by its absence from this pass's classification, in
  -- the same statement, so a reader sees one pass or the previous one, never
  -- a mixture. Disjoint from the upsert's rows by construction.
  left_window AS (
    DELETE FROM public.job_board_board_observability o
     WHERE NOT EXISTS (SELECT 1 FROM classed x WHERE x.company_token = o.company_token)
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
  -- ONE PASS, NOT FOUR, split with FILTER. With
  -- job_board_closures_absence_basis_idx in place (20261109141000) the
  -- planner can answer this from the index alone.
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
  'sweep (:02/:17/:32/:47) and ghost stats (:15). IT WRITES UNCONDITIONALLY '
  'AND HAS NO PARTIAL-FAILURE MODE: a population figure whose board buckets are '
  'fresh and whose closure counts are an hour old would size a mixture, which '
  'is the exact error this disclosure exists to prevent. If it raises, the '
  'previous row stands with its own computed_at and the staleness is visible '
  'in as_of. '
  'AS OF 20260909217800 IT ALSO KEEPS THE PER-BOARD VERDICT: the same '
  'classification CTE that produces the five bucket counts is written, in the '
  'same statement, to job_board_board_observability (company_token, bucket, '
  'lap_w0, as_of). AS OF 20261109140000 a row is written only where the '
  'board''s bucket or lap_w0 moved, and a board that left the seven-day window '
  'is deleted by name in that same statement; the set of rows and every '
  'verdict in them are what the unconditional rewrite produced. '
  'The table and the cached counts therefore always describe one pass over '
  'job_board_board_state. That table is what lets a day-30 survival figure '
  'refuse on a board whose absences cannot be observed.';

REVOKE ALL ON FUNCTION public.refresh_closure_population() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_closure_population() TO service_role;

-- The end state, read back from the catalogue.
DO $verify$
DECLARE
  f   oid := to_regprocedure('public.refresh_closure_population()');
  src text;
  cfg text[];
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'refresh_closure_population() is missing after CREATE OR REPLACE';
  END IF;
  SELECT p.prosrc, p.proconfig INTO src, cfg FROM pg_proc p WHERE p.oid = f;
  IF position('IS DISTINCT FROM (EXCLUDED.bucket, EXCLUDED.lap_w0)' IN src) = 0 THEN
    RAISE EXCEPTION 'refresh_closure_population still rewrites every verdict';
  END IF;
  IF position('(cur.bucket, cur.lap_w0) IS DISTINCT FROM (x.bucket, x.lap_w0)' IN src) = 0 THEN
    RAISE EXCEPTION 'refresh_closure_population still hands every unchanged verdict to the upsert, which locks each row';
  END IF;
  IF position('o.as_of < v_as_of' IN src) > 0 THEN
    RAISE EXCEPTION 'refresh_closure_population still deletes by an old stamp, which would now delete unchanged boards';
  END IF;
  IF position('left_window AS (' IN src) = 0 THEN
    RAISE EXCEPTION 'refresh_closure_population no longer deletes boards that left the window';
  END IF;
  IF NOT ('statement_timeout=10min' = ANY (cfg)) THEN
    RAISE EXCEPTION 'refresh_closure_population lost its ten-minute header: %', cfg;
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh_closure_population is not service-role only';
  END IF;
END
$verify$;
