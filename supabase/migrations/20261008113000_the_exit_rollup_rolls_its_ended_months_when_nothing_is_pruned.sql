-- THE EXIT ROLLUP ROLLS ITS ENDED MONTHS WHEN NOTHING IS PRUNED.
--
-- The twin of 20261008112500, for job_board_exits. roll_up_and_prune_exits
-- (20261001090000) already rolled whole months, but only months that ended on
-- or before now() - p_keep_days: its source was
-- `(date_trunc('month', exited_at) + interval '1 month') <= v_cutoff`, and
-- since the cron passes NULL (20261001090000, applied 2026-10-08) v_cutoff is
-- NULL and that comparison is never true. The file's header promised "the
-- roll-up keeps running every night either way"; it has rolled nothing since.
-- Same register item as the closure rollup (L13-16), same file, same defect.
--
-- THE FIX, as for closures: each run rolls ONE whole month that has ended --
-- the first month after the newest one already rolled after it ended that
-- holds a row the rollup reads; an exit row is written at the moment it is
-- observed, so an ended month cannot gain rows and a month rolled after its
-- end is final. NULL rolls and deletes nothing; a day count also deletes the
-- whole months that ended on or before the cutoff, and only where the summary
-- row is final. The rollup's last final month is from the 90-day prune era,
-- so the job catches up on the months since over its first nights, one a
-- night. Every aggregate, dimension and the closed exit_reason vocabulary are
-- the 20261001090000 text; the grants and the census status (service_role
-- only) are unchanged.
--
-- THE CRON: like the closure job, this one was re-scheduled bare by
-- 20261001090000 after 20261004010000 had given it its header, so it is held
-- to two minutes (get_cron_health 2026-10-08: timeout null). The header rises
-- from 300s to ten minutes, as for closures, and the job's command is
-- rewritten in place to set it.
--
--    REJECTED -- ROLL EVERY ENDED MONTH ON EVERY RUN. No watermark, one line
--    shorter. With the prune off the raw ledger only grows, so every nightly
--    run would re-aggregate the whole of history, and within a year it would
--    pass any header we could give it -- a timeout that, under pg_cron, fails
--    silently and leaves the rollup frozen at its last good run.
--
--    REJECTED -- ADD TO THE MONTH ON CONFLICT INSTEAD OF OVERWRITING. Right
--    when every counted row is deleted in the same run (the layoff rollup,
--    20261008113500, is built that way), wrong here: with the prune off a
--    month that was ever re-read would be added to itself.

CREATE OR REPLACE FUNCTION public.roll_up_and_prune_exits(p_keep_days integer DEFAULT 90)
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
  -- the rollup reads, if it has ended. One month per run.
  v_roll_from timestamptz;
  v_roll_to timestamptz;
  v_months integer := 0;
  v_pruned integer := 0;
BEGIN
  SELECT max(rr.month) + interval '1 month' INTO v_after
    FROM public.job_board_exit_rollup rr
   WHERE rr.rolled_at >= rr.month + interval '1 month';
  -- Found from the ledger, so a month with no rollable row cannot stall it.
  SELECT date_trunc('month', min(e.exited_at)) INTO v_roll_from
    FROM public.job_board_exits e
   WHERE e.exited_at >= COALESCE(v_after, '-infinity'::timestamptz)
     AND e.company_token <> ''
     AND e.exit_reason IN ('removed', 'aged_out', 'backdated', 'board_dormant', 'untracked');
  v_roll_to := LEAST(date_trunc('month', now()), v_roll_from + interval '1 month');

  -- 1. Roll up WHOLE months only. Every table is aliased and every column
  -- qualified: in plpgsql the RETURNS TABLE names are OUT parameters in scope
  -- for the whole body, and an unqualified column that collides with one is
  -- the 42702 that took get_board_flow down twice.
  WITH src AS (
    SELECT e.company_token,
           COALESCE(NULLIF(e.category, ''), 'other') AS category,
           e.exit_reason,
           COALESCE(NULLIF(e.country, ''), '(none)') AS country,
           date_trunc('month', e.exited_at)::date AS month,
           e.days_on_board,
           e.origin_basis,
           e.salary_min_annual,
           e.exited_at,
           left(COALESCE(NULLIF(btrim(e.work_mode), ''), '(none)'), 80)       AS work_mode,
           left(COALESCE(NULLIF(btrim(e.experience_band), ''), '(none)'), 80) AS experience_band,
           left(COALESCE(NULLIF(btrim(e.employment_type), ''), '(none)'), 80) AS employment_type,
           left(COALESCE(NULLIF(btrim(e.region_code), ''), '(none)'), 80)     AS region_code
    FROM public.job_board_exits e
    WHERE e.exited_at >= v_roll_from
      AND e.exited_at < v_roll_to
      AND e.company_token <> ''
      -- THE CLOSED VOCABULARY, SPELLED OUT. A no-op against the table's own
      -- CHECK (which is NOT VALID, so it guarantees nothing about rows written
      -- before 20260817222407), and it does three things worth the line: a
      -- sixth exit_reason invented later is left unrolled and therefore also
      -- unpruned by step 2, rather than being folded away silently; the
      -- vocabulary is readable at the one place that summarises it; and the
      -- repo's standing guard that nothing reads this ledger without saying
      -- which reasons it admits (src/test/published-claims.test.ts) is
      -- satisfied by the SQL rather than by relaxing the guard — this codebase
      -- has a history of guards that pin spellings being edited instead of
      -- obeyed.
      AND e.exit_reason IN ('removed', 'aged_out', 'backdated', 'board_dormant', 'untracked')
  ),
  dims AS (
    SELECT s.company_token, s.category, s.exit_reason, s.country, s.month,
           d.dimension || '=' || d.value AS k,
           count(*)::int AS n
    FROM src s
    CROSS JOIN LATERAL (VALUES
      ('work_mode',       s.work_mode),
      ('experience_band', s.experience_band),
      ('employment_type', s.employment_type),
      -- THE JURISDICTION SURVIVES THE PRUNE, and it is here rather than in the
      -- primary key on purpose. region_code is the grain pay-disclosure law is
      -- written at (item 10 exists for it) and the raw column is gone at 90
      -- days, so if it is summarised nowhere the state-level cut lives ~90
      -- days and then stops — the same delete-before-summarise shape this file
      -- was written to end, one level down. Putting it in the key instead
      -- would multiply the row count of every large US employer's groups;
      -- inside dim_counts it costs a handful of jsonb entries per group.
      ('region_code',     s.region_code)
    ) AS d(dimension, value)
    GROUP BY s.company_token, s.category, s.exit_reason, s.country, s.month, d.dimension || '=' || d.value
  ),
  -- The one cut dim_counts could not otherwise answer: PAY DISCLOSURE BY
  -- JURISDICTION. A count of exits per region says how many roles ended in
  -- Colorado; this says how many of them disclosed pay, which is the actual
  -- compliance number and is not derivable from the two separately.
  dims_pay AS (
    SELECT s.company_token, s.category, s.exit_reason, s.country, s.month,
           'region_disclosed=' || s.region_code AS k,
           count(*)::int AS n
    FROM src s
    WHERE s.salary_min_annual IS NOT NULL
    GROUP BY s.company_token, s.category, s.exit_reason, s.country, s.month, s.region_code
  ),
  dims_json AS (
    SELECT x.company_token, x.category, x.exit_reason, x.country, x.month,
           jsonb_object_agg(x.k, x.n) AS dim_counts
    FROM (SELECT * FROM dims UNION ALL SELECT * FROM dims_pay) x
    GROUP BY x.company_token, x.category, x.exit_reason, x.country, x.month
  ),
  agg AS (
    SELECT s.company_token, s.category, s.exit_reason, s.country, s.month,
           count(*)::int AS exits,
           -- THE COUNT AND ITS PERCENTILE ARE ONE POPULATION. Not
           -- `origin_basis = 'stated'` alone: that is a larger set than the
           -- percentile whenever a stated row carries no duration, and a
           -- sample size printed beside a statistic it does not describe is
           -- the `closed_90d 41 / median null` shape this wave removed from
           -- the live surfaces. The two coincide today by construction (a
           -- null duration is written with a null basis), and this spelling
           -- keeps them coinciding if that ever stops being true.
           count(*) FILTER (WHERE s.origin_basis = 'stated'
                              AND s.days_on_board IS NOT NULL)::int AS n_stated,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.days_on_board)
             FILTER (WHERE s.origin_basis = 'stated' AND s.days_on_board IS NOT NULL) AS p50_stated,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY s.days_on_board)
             FILTER (WHERE s.origin_basis = 'stated' AND s.days_on_board IS NOT NULL) AS p75_stated,
           count(*) FILTER (WHERE s.origin_basis = 'discovered'
                              AND s.days_on_board IS NOT NULL)::int AS n_discovered,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.days_on_board)
             FILTER (WHERE s.origin_basis = 'discovered' AND s.days_on_board IS NOT NULL) AS p50_disc,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY s.days_on_board)
             FILTER (WHERE s.origin_basis = 'discovered' AND s.days_on_board IS NOT NULL) AS p75_disc,
           count(*) FILTER (WHERE s.origin_basis IS NULL)::int AS n_unrecorded,
           count(*) FILTER (WHERE s.salary_min_annual IS NOT NULL)::int AS n_salary,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.salary_min_annual)
             FILTER (WHERE s.salary_min_annual IS NOT NULL) AS p50_salary,
           min(s.exited_at) AS first_e,
           max(s.exited_at) AS last_e
    FROM src s
    GROUP BY s.company_token, s.category, s.exit_reason, s.country, s.month
  )
  INSERT INTO public.job_board_exit_rollup AS r
    (company_token, category, exit_reason, country, month, exits,
     n_stated, p50_days_stated, p75_days_stated,
     n_discovered, p50_days_discovered, p75_days_discovered,
     n_basis_unrecorded, n_salary_disclosed, p50_salary_min_annual,
     dim_counts, first_exited_at, last_exited_at, rolled_at)
  SELECT a.company_token, a.category, a.exit_reason, a.country, a.month, a.exits,
         a.n_stated, round(a.p50_stated::numeric, 1), round(a.p75_stated::numeric, 1),
         a.n_discovered, round(a.p50_disc::numeric, 1), round(a.p75_disc::numeric, 1),
         a.n_unrecorded, a.n_salary, round(a.p50_salary::numeric, 2),
         COALESCE(j.dim_counts, '{}'::jsonb), a.first_e, a.last_e, now()
  FROM agg a
  LEFT JOIN dims_json j
    ON  j.company_token = a.company_token
    AND j.category      = a.category
    AND j.exit_reason   = a.exit_reason
    AND j.country       = a.country
    AND j.month         = a.month
  ON CONFLICT (company_token, category, exit_reason, country, month) DO UPDATE SET
    exits                 = EXCLUDED.exits,
    n_stated              = EXCLUDED.n_stated,
    p50_days_stated       = EXCLUDED.p50_days_stated,
    p75_days_stated       = EXCLUDED.p75_days_stated,
    n_discovered          = EXCLUDED.n_discovered,
    p50_days_discovered   = EXCLUDED.p50_days_discovered,
    p75_days_discovered   = EXCLUDED.p75_days_discovered,
    n_basis_unrecorded    = EXCLUDED.n_basis_unrecorded,
    n_salary_disclosed    = EXCLUDED.n_salary_disclosed,
    p50_salary_min_annual = EXCLUDED.p50_salary_min_annual,
    dim_counts            = EXCLUDED.dim_counts,
    first_exited_at       = LEAST(r.first_exited_at, EXCLUDED.first_exited_at),
    last_exited_at        = GREATEST(r.last_exited_at, EXCLUDED.last_exited_at),
    rolled_at             = now();
  GET DIAGNOSTICS v_months = ROW_COUNT;

  -- 2. Prune ONLY what is provably summarised, and only from months that were
  -- eligible to be rolled in full. If step 1 failed or skipped a group, its
  -- raw rows survive to the next run — the ledger is never destroyed ahead of
  -- its summary. Rows with an empty company_token are excluded from the roll
  -- up and are therefore never pruned by this clause either.
  IF v_cutoff IS NULL THEN
    v_pruned := 0;
  ELSE
  DELETE FROM public.job_board_exits e
  WHERE (date_trunc('month', e.exited_at) + interval '1 month') <= v_cutoff
    AND EXISTS (
      SELECT 1 FROM public.job_board_exit_rollup rr
      WHERE rr.company_token = e.company_token
        AND rr.category      = COALESCE(NULLIF(e.category, ''), 'other')
        AND rr.exit_reason   = e.exit_reason
        AND rr.country       = COALESCE(NULLIF(e.country, ''), '(none)')
        AND rr.month         = date_trunc('month', e.exited_at)::date
        AND rr.rolled_at    >= rr.month + interval '1 month'
    );
  GET DIAGNOSTICS v_pruned = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_months, v_pruned;
END;
$$;

COMMENT ON FUNCTION public.roll_up_and_prune_exits(integer) IS
  'Summarises ONE WHOLE calendar month of job_board_exits per run into '
  'job_board_exit_rollup -- the first month that has ended, holds a row, and '
  'was not already rolled after it ended -- and -- only when p_keep_days is a '
  'positive number -- deletes the rows '
  'of whole months that ended on or before now() - p_keep_days days and carry a '
  'final summary row (20261008113000). With NULL, which the '
  '''job-board-exits-rollup-retention'' cron passes, it rolled nothing between '
  '20261001090000 and that file. An exit row is written when it is observed, so '
  'an ended month cannot gain rows and a month rolled after its end is final. '
  'DATE BASIS: every duration statistic is SPLIT BY origin_basis rather than '
  'mixed or filtered away: days_on_board is read only inside per-basis FILTERs, '
  'so no percentile combines the ''stated'' clock (the employer''s posted_at) '
  'with the ''discovered'' clock (OUR first_seen); pre-2026-09-06 rows, whose '
  'basis was never recorded, are counted in n_basis_unrecorded and given NO '
  'percentile. Basis-blind quantities (exits, n_salary_disclosed, '
  'p50_salary_min_annual, dim_counts) stay at the whole-group grain. RETENTION: '
  'the prune runs ONLY when p_keep_days is positive; NULL keeps the raw ledger, '
  'because a closed posting is on no public page and the ledger cannot be '
  'backfilled. Service-role only.';

REVOKE ALL ON FUNCTION public.roll_up_and_prune_exits(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_exits(integer) TO service_role;

DO $$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- no exit rollup job to give its header';
    RETURN;
  END IF;
  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'job-board-exits-rollup-retention';
  IF v_id IS NULL THEN
    PERFORM cron.schedule('job-board-exits-rollup-retention', '17 4 * * *',
      $job$SET statement_timeout = '10min'; SELECT public.roll_up_and_prune_exits(NULL);$job$);
  ELSE
    PERFORM cron.alter_job(job_id := v_id,
      command := $job$SET statement_timeout = '10min'; SELECT public.roll_up_and_prune_exits(NULL);$job$);
  END IF;
END $$;

DO $$
DECLARE n int; src text; cfg text[];
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_exits';
  IF n <> 1 THEN
    RAISE EXCEPTION 'roll_up_and_prune_exits: expected exactly one definition, found %', n;
  END IF;
  SELECT p.prosrc, p.proconfig INTO src, cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_exits';
  IF src NOT LIKE '%e.exited_at < v_roll_to%' THEN
    RAISE EXCEPTION 'roll_up_and_prune_exits: the rollup still waits on the prune cutoff, so NULL rolls nothing';
  END IF;
  IF cfg IS NULL OR NOT ('statement_timeout=10min' = ANY(cfg)) THEN
    RAISE EXCEPTION 'roll_up_and_prune_exits: re-created without its ten-minute header: %', cfg;
  END IF;
  IF has_function_privilege('anon', 'public.roll_up_and_prune_exits(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.roll_up_and_prune_exits(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_exits: a client role can execute the exit ledger''s prune';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') AND NOT EXISTS (
       SELECT 1 FROM cron.job j
        WHERE j.jobname = 'job-board-exits-rollup-retention'
          AND j.command LIKE '%statement_timeout = ''10min''%'
          AND j.command LIKE '%roll_up_and_prune_exits(NULL)%') THEN
    RAISE EXCEPTION 'roll_up_and_prune_exits: the retention job does not carry the header and the NULL argument';
  END IF;
END $$;
