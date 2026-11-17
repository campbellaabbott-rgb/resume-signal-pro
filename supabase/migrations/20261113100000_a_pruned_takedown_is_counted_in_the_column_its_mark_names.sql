-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing and changes no job: the closure rollup job keeps its daily '17 3 * * *' schedule and its command (reviewed 2026-11-17 in the bug round B, lane data-pages-b).
--
-- A PRUNED TAKEDOWN IS COUNTED IN THE COLUMN ITS MARK NAMES (S14X-159).
--
-- WHAT WAS WRONG. roll_up_and_prune_closures (20261008112500) sorts each
-- month's closures into columns: fills (not superseded, not suspect, not a
-- lap backfill), relists (superseded) and backfill_n (lap backfill). A
-- closure marked suspect and not superseded fell in none of them, so the
-- rollup did not count it at all, and its prune, which only needs the month
-- to carry a final summary row, would delete it uncounted. Final months were
-- never rolled again, so a repair that marked rows suspect after their month
-- went final left the false takedowns in fills: the Teamtailor repair rolled
-- its own boards again (20261009100300, S11-135), while the Reyes
-- (20261025110000) and iCIMS (20261026110000) repairs mark rows suspect with
-- no such step. Live 2026-11-15: a read of suspect_n on the rollup answers
-- 42703 (no such column), against 42501 (denied) for fills.
--
-- WHAT THIS FILE DOES.
--   1. job_board_closure_rollup gains suspect_n, integer, not null, default
--      0 (a constant default, so no table rewrite): suspect closures that
--      are not superseded and not lap backfills. With fills, relists and
--      backfill_n it now counts every closure of the group once. A suspect
--      superseded closure stays in relists, as before.
--   2. roll_up_and_prune_closures counts suspect_n when it rolls a month,
--      and its prune now deletes and counts in ONE statement: the rows it
--      deletes are rolled again into their final month from those same
--      rows, so a repair that marked rows suspect after the month went final
--      is counted when the rows go, and no row is deleted that the same pass
--      did not count. 20261008112500 rejected that shape because nothing could
--      change in an ended month; the repairs since then change one. The
--      roll-up-first EXISTS guard stays on the delete. The cron passes NULL,
--      which deletes nothing, so today this is the rule the prune will keep
--      when a day count is passed again.
--   3. Every final month that still holds rows is rolled again once, here,
--      from those rows, one month per statement, so suspect_n is filled and
--      the Reyes and iCIMS marks leave fills. Rows no longer held cannot be
--      counted again: a month already pruned keeps the figures it had. None
--      has been pruned (the cron has passed NULL since 20261001090000, and
--      the ledger was younger than the 180 days it passed before).
--   4. The rollup table's grants are stated again: Supabase's default
--      privileges would give anon and authenticated everything on a table
--      re-created by hand, so both are revoked by name and service_role
--      alone keeps access, as 20261004110000 left it.
--
-- Everything else in the function is the 20261008112500 text: one whole
-- ended month per run, the watermark, the lap_backfill exclusion, the ten
-- minute header, the grants (service_role only) and the comment's date
-- basis. The cron job is not touched. Safe to run twice: the column is added
-- if absent, the function is replaced, and the re-roll writes the same
-- figures again. The last block reads the end state back and raises.

SET LOCAL statement_timeout = '15min';

-- 1. the column.
ALTER TABLE public.job_board_closure_rollup
  ADD COLUMN IF NOT EXISTS suspect_n integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.job_board_closure_rollup.suspect_n IS
  'Closures in this group and month the collector or a repair marked suspect '
  '(a feed-dark batch, or a takedown a repair found nobody made), not '
  'superseded and not a lap backfill. fills + relists + backfill_n + suspect_n '
  'is every closure of the group; a suspect superseded closure is a relist. '
  'Added by 20261113100000 (S14X-159); a month rolled before that file and '
  'already pruned reads 0 here, since its rows cannot be counted again.';

-- 2. the function.
CREATE OR REPLACE FUNCTION public.roll_up_and_prune_closures(p_keep_days integer DEFAULT 180)
RETURNS TABLE (months_rolled integer, rows_pruned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  -- NULL / <= 0 means KEEP THE RAW LEDGER FOREVER: whole months are still
  -- rolled, nothing is deleted.
  v_cutoff timestamptz := CASE
    WHEN p_keep_days IS NULL OR p_keep_days <= 0 THEN NULL
    ELSE now() - make_interval(days => GREATEST(p_keep_days, 30))
  END;
  -- The month after the newest one already rolled after it ended.
  v_after timestamptz;
  -- The month this run rolls: the first one after v_after that holds a row
  -- the rollup reads, if it has ended. One month per run, so no run reads
  -- more than a month of the ledger however far behind the rollup is.
  v_roll_from timestamptz;
  v_roll_to timestamptz;
  v_months integer := 0;
  v_pruned integer := 0;
BEGIN
  SELECT max(rr.month) + interval '1 month' INTO v_after
    FROM public.job_board_closure_rollup rr
   WHERE rr.rolled_at >= rr.month + interval '1 month';
  -- The first month holding a row the rollup reads, so a month with no rows
  -- (or only rows it never rolls) cannot stall the watermark.
  SELECT date_trunc('month', min(c.closed_at)) INTO v_roll_from
    FROM public.job_board_closures c
   WHERE c.closed_at >= COALESCE(v_after, '-infinity'::timestamptz)
     AND c.company_token <> '';
  v_roll_to := LEAST(date_trunc('month', now()), v_roll_from + interval '1 month');

  WITH src AS (
    SELECT
      c.company_token,
      max(c.company) AS company,
      COALESCE(NULLIF(c.category, ''), 'other') AS category,
      date_trunc('month', c.closed_at)::date AS month,
      count(*) FILTER (
        WHERE NOT c.superseded
          AND NOT COALESCE(c.suspect, false)
          AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      )::int AS fills,
      count(*) FILTER (WHERE c.superseded
                         AND c.absence_basis IS DISTINCT FROM 'lap_backfill')::int AS relists,
      count(*) FILTER (WHERE c.absence_basis = 'lap_backfill')::int AS backfill_n,
      count(*) FILTER (WHERE NOT c.superseded
                         AND COALESCE(c.suspect, false)
                         AND c.absence_basis IS DISTINCT FROM 'lap_backfill')::int AS suspect_n,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                  AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                  AND c.posted_at IS NOT NULL
                  AND c.closed_at >= c.posted_at
                  AND c.closed_at - c.posted_at <= interval '365 days') AS p50,
      percentile_cont(0.75) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                  AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                  AND c.posted_at IS NOT NULL
                  AND c.closed_at >= c.posted_at
                  AND c.closed_at - c.posted_at <= interval '365 days') AS p75,
      count(*) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                         AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                         AND c.posted_at IS NOT NULL
                         AND c.closed_at >= c.posted_at
                         AND c.closed_at - c.posted_at <= interval '365 days')::int AS dated_n,
      min(c.closed_at) AS first_c,
      max(c.closed_at) AS last_c
    FROM public.job_board_closures c
    WHERE c.closed_at >= v_roll_from
      AND c.closed_at < v_roll_to
      AND c.company_token <> ''
    GROUP BY c.company_token, COALESCE(NULLIF(c.category, ''), 'other'), date_trunc('month', c.closed_at)::date
  )
  INSERT INTO public.job_board_closure_rollup AS r
    (company_token, company, category, month, fills, relists, dated_n, backfill_n, suspect_n, p50_days_open, p75_days_open, first_closed_at, last_closed_at, rolled_at)
  SELECT s.company_token, s.company, s.category, s.month, s.fills, s.relists, s.dated_n, s.backfill_n, s.suspect_n,
         round(s.p50::numeric, 1), round(s.p75::numeric, 1), s.first_c, s.last_c, now()
  FROM src s
  ON CONFLICT (company_token, category, month) DO UPDATE SET
    fills = EXCLUDED.fills,
    relists = EXCLUDED.relists,
    dated_n = EXCLUDED.dated_n,
    backfill_n = EXCLUDED.backfill_n,
    suspect_n = EXCLUDED.suspect_n,
    p50_days_open = EXCLUDED.p50_days_open,
    p75_days_open = EXCLUDED.p75_days_open,
    first_closed_at = LEAST(r.first_closed_at, EXCLUDED.first_closed_at),
    last_closed_at = GREATEST(r.last_closed_at, EXCLUDED.last_closed_at),
    rolled_at = now();
  GET DIAGNOSTICS v_months = ROW_COUNT;

  IF v_cutoff IS NULL THEN
    v_pruned := 0;
  ELSE
    -- Whole months that ended on or before the cutoff, and only rows whose
    -- month already has a FINAL summary row: rolled after the month ended.
    -- The rows deleted are rolled again into that final row from the same
    -- rows, in this one statement, so a mark a repair made after the month
    -- went final is counted, and nothing is deleted this pass did not count.
    WITH gone AS (
      DELETE FROM public.job_board_closures c
      WHERE (date_trunc('month', c.closed_at) + interval '1 month') <= v_cutoff
        AND c.company_token <> ''
        AND EXISTS (
          SELECT 1 FROM public.job_board_closure_rollup rr
          WHERE rr.company_token = c.company_token
            AND rr.category = COALESCE(NULLIF(c.category, ''), 'other')
            AND rr.month = date_trunc('month', c.closed_at)::date
            AND rr.rolled_at >= rr.month + interval '1 month'
        )
      RETURNING c.company_token, c.company, c.category, c.posted_at, c.closed_at,
                c.superseded, c.suspect, c.absence_basis
    ),
    src AS (
      SELECT
        g.company_token,
        max(g.company) AS company,
        COALESCE(NULLIF(g.category, ''), 'other') AS category,
        date_trunc('month', g.closed_at)::date AS month,
        count(*) FILTER (
          WHERE NOT g.superseded
            AND NOT COALESCE(g.suspect, false)
            AND g.absence_basis IS DISTINCT FROM 'lap_backfill'
        )::int AS fills,
        count(*) FILTER (WHERE g.superseded
                           AND g.absence_basis IS DISTINCT FROM 'lap_backfill')::int AS relists,
        count(*) FILTER (WHERE g.absence_basis = 'lap_backfill')::int AS backfill_n,
        count(*) FILTER (WHERE NOT g.superseded
                           AND COALESCE(g.suspect, false)
                           AND g.absence_basis IS DISTINCT FROM 'lap_backfill')::int AS suspect_n,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM (g.closed_at - g.posted_at)) / 86400.0
        ) FILTER (WHERE NOT g.superseded AND NOT COALESCE(g.suspect, false)
                    AND g.absence_basis IS DISTINCT FROM 'lap_backfill'
                    AND g.posted_at IS NOT NULL
                    AND g.closed_at >= g.posted_at
                    AND g.closed_at - g.posted_at <= interval '365 days') AS p50,
        percentile_cont(0.75) WITHIN GROUP (
          ORDER BY extract(epoch FROM (g.closed_at - g.posted_at)) / 86400.0
        ) FILTER (WHERE NOT g.superseded AND NOT COALESCE(g.suspect, false)
                    AND g.absence_basis IS DISTINCT FROM 'lap_backfill'
                    AND g.posted_at IS NOT NULL
                    AND g.closed_at >= g.posted_at
                    AND g.closed_at - g.posted_at <= interval '365 days') AS p75,
        count(*) FILTER (WHERE NOT g.superseded AND NOT COALESCE(g.suspect, false)
                           AND g.absence_basis IS DISTINCT FROM 'lap_backfill'
                           AND g.posted_at IS NOT NULL
                           AND g.closed_at >= g.posted_at
                           AND g.closed_at - g.posted_at <= interval '365 days')::int AS dated_n,
        min(g.closed_at) AS first_c,
        max(g.closed_at) AS last_c
      FROM gone g
      GROUP BY g.company_token, COALESCE(NULLIF(g.category, ''), 'other'), date_trunc('month', g.closed_at)::date
    ),
    counted AS (
      INSERT INTO public.job_board_closure_rollup AS r
        (company_token, company, category, month, fills, relists, dated_n, backfill_n, suspect_n, p50_days_open, p75_days_open, first_closed_at, last_closed_at, rolled_at)
      SELECT s.company_token, s.company, s.category, s.month, s.fills, s.relists, s.dated_n, s.backfill_n, s.suspect_n,
             round(s.p50::numeric, 1), round(s.p75::numeric, 1), s.first_c, s.last_c, now()
      FROM src s
      ON CONFLICT (company_token, category, month) DO UPDATE SET
        fills = EXCLUDED.fills,
        relists = EXCLUDED.relists,
        dated_n = EXCLUDED.dated_n,
        backfill_n = EXCLUDED.backfill_n,
        suspect_n = EXCLUDED.suspect_n,
        p50_days_open = EXCLUDED.p50_days_open,
        p75_days_open = EXCLUDED.p75_days_open,
        first_closed_at = LEAST(r.first_closed_at, EXCLUDED.first_closed_at),
        last_closed_at = GREATEST(r.last_closed_at, EXCLUDED.last_closed_at),
        rolled_at = now()
      RETURNING 1
    )
    SELECT count(*)::int INTO v_pruned FROM gone;
  END IF;

  RETURN QUERY SELECT v_months, v_pruned;
END;
$$;

COMMENT ON FUNCTION public.roll_up_and_prune_closures(integer) IS
  'Rolls ONE WHOLE calendar month of job_board_closures per run into '
  'job_board_closure_rollup -- the first month that has ended, holds a row, and '
  'was not already rolled after it ended -- and -- only when p_keep_days is a '
  'positive number -- deletes '
  'the rows of whole months that ended on or before now() - p_keep_days days '
  'and already carry a final summary row (20261008112500), rolling those same '
  'rows into that final row in the same statement, so a suspect mark a repair '
  'made after the month went final is counted and no row goes uncounted '
  '(20261113100000). Every closure lands in one column: fills (not superseded, '
  'not suspect, not lap_backfill), relists (superseded, not lap_backfill), '
  'suspect_n (suspect, not superseded, not lap_backfill) or backfill_n '
  '(lap_backfill). A month is final once rolled after it ended: closed_at is '
  'the moment a row is written, so nothing can arrive in an ended month, and '
  'the overwrite on conflict is correct because a month is only ever read '
  'whole. DATE BASIS: p50/p75 are measured '
  'from the employer''s stated posted_at ALONE over the closures that carry '
  'one, exclude relists and suspect batches, and carry the live read paths'' '
  'two sanity guards (closed_at >= posted_at, and the duration under a year). '
  'dated_n is the count behind those percentiles; `fills` counts a LARGER '
  'population, because it does not require a post date. The live functions '
  'also drop unstamped feed-dark batches via a read-time proxy against company '
  'snapshots pruned at 35 days, which cannot be reconstructed here; batches '
  'the collector stamped suspect ARE excluded, and every batch carries that '
  'stamp from 2026-09-06. ADMITTED ABSENCE BASES: full_read, lap, and NULL -- '
  'NULL is a row written before the column existed on 2026-09-08 and is a '
  'full_read closure. lap_backfill is EXCLUDED from fills, relists, suspect_n, '
  'dated_n, p50_days_open and p75_days_open and counted in backfill_n. '
  'RETENTION: the prune runs ONLY when p_keep_days is positive; the '
  '''job-board-closures-rollup-retention'' cron passes NULL, so the raw ledger '
  '-- the one /v1/changes serves -- is kept. Service-role only.';

REVOKE ALL ON FUNCTION public.roll_up_and_prune_closures(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_closures(integer) TO service_role;

-- 3. every final month that still holds rows, rolled again from them, one
-- month per statement. Only a group whose summary row is final is
-- overwritten; a group with no row yet is added, as the nightly roll would.
DO $$
DECLARE
  v_after timestamptz;
  v_month timestamptz;
  v_groups integer;
  v_total integer := 0;
BEGIN
  SELECT max(rr.month) + interval '1 month' INTO v_after
    FROM public.job_board_closure_rollup rr
   WHERE rr.rolled_at >= rr.month + interval '1 month';
  IF v_after IS NULL THEN
    RAISE NOTICE 'closure rollup: no month is final yet, so none is rolled again';
    RETURN;
  END IF;
  SELECT date_trunc('month', min(c.closed_at)) INTO v_month
    FROM public.job_board_closures c
   WHERE c.closed_at < v_after
     AND c.company_token <> '';
  WHILE v_month IS NOT NULL AND v_month < v_after LOOP
    WITH src AS (
      SELECT
        c.company_token,
        max(c.company) AS company,
        COALESCE(NULLIF(c.category, ''), 'other') AS category,
        date_trunc('month', c.closed_at)::date AS month,
        count(*) FILTER (
          WHERE NOT c.superseded
            AND NOT COALESCE(c.suspect, false)
            AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
        )::int AS fills,
        count(*) FILTER (WHERE c.superseded
                           AND c.absence_basis IS DISTINCT FROM 'lap_backfill')::int AS relists,
        count(*) FILTER (WHERE c.absence_basis = 'lap_backfill')::int AS backfill_n,
        count(*) FILTER (WHERE NOT c.superseded
                           AND COALESCE(c.suspect, false)
                           AND c.absence_basis IS DISTINCT FROM 'lap_backfill')::int AS suspect_n,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
        ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                    AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                    AND c.posted_at IS NOT NULL
                    AND c.closed_at >= c.posted_at
                    AND c.closed_at - c.posted_at <= interval '365 days') AS p50,
        percentile_cont(0.75) WITHIN GROUP (
          ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
        ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                    AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                    AND c.posted_at IS NOT NULL
                    AND c.closed_at >= c.posted_at
                    AND c.closed_at - c.posted_at <= interval '365 days') AS p75,
        count(*) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                           AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                           AND c.posted_at IS NOT NULL
                           AND c.closed_at >= c.posted_at
                           AND c.closed_at - c.posted_at <= interval '365 days')::int AS dated_n,
        min(c.closed_at) AS first_c,
        max(c.closed_at) AS last_c
      FROM public.job_board_closures c
      WHERE c.closed_at >= v_month
        AND c.closed_at < v_month + interval '1 month'
        AND c.company_token <> ''
      GROUP BY c.company_token, COALESCE(NULLIF(c.category, ''), 'other'), date_trunc('month', c.closed_at)::date
    )
    INSERT INTO public.job_board_closure_rollup AS r
      (company_token, company, category, month, fills, relists, dated_n, backfill_n, suspect_n, p50_days_open, p75_days_open, first_closed_at, last_closed_at, rolled_at)
    SELECT s.company_token, s.company, s.category, s.month, s.fills, s.relists, s.dated_n, s.backfill_n, s.suspect_n,
           round(s.p50::numeric, 1), round(s.p75::numeric, 1), s.first_c, s.last_c, now()
    FROM src s
    ON CONFLICT (company_token, category, month) DO UPDATE SET
      fills = EXCLUDED.fills,
      relists = EXCLUDED.relists,
      dated_n = EXCLUDED.dated_n,
      backfill_n = EXCLUDED.backfill_n,
      suspect_n = EXCLUDED.suspect_n,
      p50_days_open = EXCLUDED.p50_days_open,
      p75_days_open = EXCLUDED.p75_days_open,
      first_closed_at = LEAST(r.first_closed_at, EXCLUDED.first_closed_at),
      last_closed_at = GREATEST(r.last_closed_at, EXCLUDED.last_closed_at),
      rolled_at = now()
    WHERE r.rolled_at >= r.month + interval '1 month';
    GET DIAGNOSTICS v_groups = ROW_COUNT;
    v_total := v_total + v_groups;
    v_month := v_month + interval '1 month';
  END LOOP;
  RAISE NOTICE 'closure rollup: % group-months of final months rolled again from the rows they hold', v_total;
END $$;

-- 4. the table's grants, stated again.
REVOKE ALL ON TABLE public.job_board_closure_rollup FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_board_closure_rollup TO service_role;

-- The end state, read back.
DO $$
DECLARE n int; src text; cfg text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'job_board_closure_rollup'
       AND column_name = 'suspect_n' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'job_board_closure_rollup: suspect_n is missing or nullable';
  END IF;
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_closures';
  IF n <> 1 THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: expected exactly one definition, found %', n;
  END IF;
  SELECT p.prosrc, p.proconfig INTO src, cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_closures';
  IF src NOT LIKE '%c.closed_at < v_roll_to%' OR src LIKE '%c.closed_at < v_cutoff%' THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: the rollup reads by instant, not whole months';
  END IF;
  IF src NOT LIKE '%suspect_n = EXCLUDED.suspect_n%' THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: a suspect closure lands in no column';
  END IF;
  IF src NOT LIKE '%WITH gone AS (%DELETE FROM public.job_board_closures c%FROM gone g%' THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: the prune deletes rows it does not count in the same statement';
  END IF;
  IF cfg IS NULL OR NOT ('statement_timeout=10min' = ANY(cfg)) THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: re-created without its ten-minute header: %', cfg;
  END IF;
  IF has_function_privilege('anon', 'public.roll_up_and_prune_closures(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.roll_up_and_prune_closures(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: a client role can execute the closure ledger''s prune';
  END IF;
  IF has_table_privilege('anon', 'public.job_board_closure_rollup', 'SELECT')
     OR has_table_privilege('authenticated', 'public.job_board_closure_rollup', 'SELECT') THEN
    RAISE EXCEPTION 'job_board_closure_rollup: a client role can read the closure rollup';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (
         SELECT 1 FROM cron.job j
          WHERE j.jobname = 'job-board-closures-rollup-retention'
            AND j.command LIKE '%statement_timeout = ''10min''%'
            AND j.command LIKE '%roll_up_and_prune_closures(NULL)%') THEN
      RAISE EXCEPTION 'roll_up_and_prune_closures: the retention job does not carry the header and the NULL argument';
    END IF;
  END IF;
END $$;
