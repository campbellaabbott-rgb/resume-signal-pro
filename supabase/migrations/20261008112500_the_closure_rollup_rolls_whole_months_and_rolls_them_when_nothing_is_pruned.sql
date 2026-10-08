-- THE CLOSURE ROLLUP ROLLS WHOLE MONTHS, AND ROLLS THEM WHEN NOTHING IS PRUNED.
--
-- roll_up_and_prune_closures (20261001090000) had two defects, one latent and
-- one live (register L13-16, still open from 1.32):
--
--   * WITH A DAY COUNT IT ROLLED BY INSTANT AND OVERWROTE THE MONTH. Its source
--     was `closed_at < now() - p_keep_days`, grouped by month, upserted with
--     `fills = EXCLUDED.fills`, and the DELETE then removed exactly those rows.
--     The boundary month is cut mid-way, so each night overwrote that month's
--     row with one more day's slice and deleted the slice: a month kept about
--     one day in thirty. Nothing has been lost yet -- the ledger is younger
--     than the 180 days the cron passed until 20261001090000 -- which is the
--     only reason this is latent rather than an incident.
--   * WITH NULL IT ROLLED NOTHING. NULL is what the cron has passed since
--     20261001090000 (applied 2026-10-08), and `closed_at < NULL` is never
--     true, so the comment's promise that "the roll-up still runs" was false
--     from the day it was written. roll_up_and_prune_exits, in the same file,
--     has the same NULL defect and is fixed beside this one (20261008113000).
--
-- THE FIX. The rollup reads WHOLE MONTHS that have ended -- closed_at before
-- the first instant of the current month -- whatever the argument, starting
-- at the first month not already rolled after it ended (a month rolled after
-- its end is final: closed_at is always the moment a row is written, so no row
-- can arrive in a month that has ended). NULL now rolls those months and
-- deletes nothing; a day count rolls them and deletes only whole months that
-- ended on or before the cutoff and are rolled. The upsert still overwrites,
-- which is now correct: a month is only ever read whole. The DELETE keeps its
-- roll-up-first EXISTS guard and now also requires the summary row to be a
-- final one. Every aggregate, the lap_backfill exclusion, the grants and the
-- census status (service_role only) are the 20261001090000 text.
--
-- THE CRON. 20261001090000 re-scheduled the job with a bare
-- `SELECT public.roll_up_and_prune_closures(NULL);` and was applied after
-- 20261004010000, so its command carries no statement_timeout and is held to
-- the session's two minutes (get_cron_health, read-only, 2026-10-08: timeout
-- null). The first run under this file reads every month the ledger holds
-- that has ended, so the function gets a ten-minute header and the job's
-- command is rewritten in place to set it, keeping its id, schedule, owner and
-- active flag. Every later run reads one month at most.
--
--    REJECTED -- ROLL EVERY ENDED MONTH ON EVERY RUN. No watermark. With the
--    prune off the ledger only grows, so each night would re-aggregate all of
--    history -- several million rows a month today -- and the run would pass
--    its header within months, failing silently under pg_cron.
--
--    REJECTED -- DELETE AND COUNT IN ONE STATEMENT, as the layoff rollup now
--    does (20261008113500). It is only needed where a row can arrive in a month
--    already rolled; a closure's closed_at is the moment it is written, so it
--    cannot, and the two-statement shape keeps the roll-up-first EXISTS guard
--    the prune was built around and the guards that read it.

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
  -- Every month that has ended: closed_at before this instant.
  v_roll_to timestamptz := date_trunc('month', now());
  -- The first month not yet rolled after it ended.
  v_roll_from timestamptz;
  v_months integer := 0;
  v_pruned integer := 0;
BEGIN
  SELECT max(rr.month) + interval '1 month' INTO v_roll_from
    FROM public.job_board_closure_rollup rr
   WHERE rr.rolled_at >= rr.month + interval '1 month';
  v_roll_from := COALESCE(v_roll_from, '-infinity'::timestamptz);

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
    (company_token, company, category, month, fills, relists, dated_n, backfill_n, p50_days_open, p75_days_open, first_closed_at, last_closed_at, rolled_at)
  SELECT s.company_token, s.company, s.category, s.month, s.fills, s.relists, s.dated_n, s.backfill_n,
         round(s.p50::numeric, 1), round(s.p75::numeric, 1), s.first_c, s.last_c, now()
  FROM src s
  ON CONFLICT (company_token, category, month) DO UPDATE SET
    fills = EXCLUDED.fills,
    relists = EXCLUDED.relists,
    dated_n = EXCLUDED.dated_n,
    backfill_n = EXCLUDED.backfill_n,
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
    DELETE FROM public.job_board_closures c
    WHERE (date_trunc('month', c.closed_at) + interval '1 month') <= v_cutoff
      AND EXISTS (
        SELECT 1 FROM public.job_board_closure_rollup rr
        WHERE rr.company_token = c.company_token
          AND rr.category = COALESCE(NULLIF(c.category, ''), 'other')
          AND rr.month = date_trunc('month', c.closed_at)::date
          AND rr.rolled_at >= rr.month + interval '1 month'
      );
    GET DIAGNOSTICS v_pruned = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_months, v_pruned;
END;
$$;

COMMENT ON FUNCTION public.roll_up_and_prune_closures(integer) IS
  'Rolls WHOLE calendar months of job_board_closures that have ended into '
  'job_board_closure_rollup, starting at the first month not already rolled '
  'after it ended, and -- only when p_keep_days is a positive number -- deletes '
  'the rows of whole months that ended on or before now() - p_keep_days days '
  'and already carry a final summary row (20261008112500). Before that file it '
  'rolled by instant and overwrote the month, so the boundary month kept about '
  'one day in thirty once pruning ran, and with NULL -- what the cron passes '
  'since 20261001090000 -- it rolled nothing at all. A month is final once '
  'rolled after it ended: closed_at is the moment a row is written, so nothing '
  'can arrive in an ended month, and the overwrite on conflict is correct '
  'because a month is only ever read whole. DATE BASIS: p50/p75 are measured '
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
  'full_read closure. lap_backfill is EXCLUDED from fills, relists, dated_n, '
  'p50_days_open and p75_days_open and counted in backfill_n. RETENTION: the '
  'prune runs ONLY when p_keep_days is positive; the '
  '''job-board-closures-rollup-retention'' cron passes NULL, so the raw ledger '
  '-- the one /v1/changes serves -- is kept. Service-role only.';

REVOKE ALL ON FUNCTION public.roll_up_and_prune_closures(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_closures(integer) TO service_role;

-- The job's command sets the header the function asks for; id, schedule,
-- owner and active flag are kept (cron.alter_job, as 20261004010000 used it).
DO $$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- no closure rollup job to give its header';
    RETURN;
  END IF;
  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'job-board-closures-rollup-retention';
  IF v_id IS NULL THEN
    PERFORM cron.schedule('job-board-closures-rollup-retention', '17 3 * * *',
      $job$SET statement_timeout = '10min'; SELECT public.roll_up_and_prune_closures(NULL);$job$);
  ELSE
    PERFORM cron.alter_job(job_id := v_id,
      command := $job$SET statement_timeout = '10min'; SELECT public.roll_up_and_prune_closures(NULL);$job$);
  END IF;
END $$;

DO $$
DECLARE n int; src text; cfg text[];
BEGIN
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
    RAISE EXCEPTION 'roll_up_and_prune_closures: the rollup still reads by instant, not whole months';
  END IF;
  IF cfg IS NULL OR NOT ('statement_timeout=10min' = ANY(cfg)) THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: re-created without its ten-minute header: %', cfg;
  END IF;
  IF has_function_privilege('anon', 'public.roll_up_and_prune_closures(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.roll_up_and_prune_closures(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: a client role can execute the closure ledger''s prune';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') AND NOT EXISTS (
       SELECT 1 FROM cron.job j
        WHERE j.jobname = 'job-board-closures-rollup-retention'
          AND j.command LIKE '%statement_timeout = ''10min''%'
          AND j.command LIKE '%roll_up_and_prune_closures(NULL)%') THEN
    RAISE EXCEPTION 'roll_up_and_prune_closures: the retention job does not carry the header and the NULL argument';
  END IF;
END $$;
