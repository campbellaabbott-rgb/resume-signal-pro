-- THE CLOSURE LEDGER IS THE ASSET. STOP DELETING IT.
--
-- 20260906218000 replaced a bare 90-day DELETE with summarise-then-prune, and
-- that was the right fix for the failure it faced: the ledger was dying ahead
-- of any summary. It is still not enough, because the thing it prunes is the
-- only thing here a competitor cannot rebuild.
--
-- WHAT THE ROLL-UP KEEPS, AND WHAT IT DOES NOT. job_board_exit_rollup is keyed
-- (company_token, category, exit_reason, country, month), so the EMPLOYER-level
-- monthly series survives a prune — that part of 20260906218000 is better than
-- it is usually given credit for. What does not survive is the row: the
-- individual requisition, its exact exited_at, its own days_on_board, and every
-- dimension not already folded into dim_counts. No aggregate can be
-- disaggregated later. A summary can always be recomputed from rows; rows can
-- never be recovered from a summary, and the recomputation people will want in
-- two years is one nobody has thought of yet.
--
-- ANYTHING ELSE HERE CAN BE REBUILT. The catalogue can be re-crawled, the
-- postings re-fetched, the salaries re-parsed — every one of those is a
-- function of a public page that still exists. A posting that CLOSED is not on
-- any public page any more. The record that it existed, and for how long,
-- exists because this system was watching on the day it happened and wrote it
-- down. That is not a dataset you can buy, scrape or backfill; it accrues only
-- with elapsed calendar time, and deleting it resets a clock that cannot be
-- restarted.
--
-- SO THE PRUNE IS TURNED OFF, not tuned. p_keep_days NULL or <= 0 now means
-- "roll up, never delete", and the cron passes NULL. The DELETE and its
-- roll-up-first EXISTS guard are kept exactly as they were, inside an IF, so
-- the capability survives for a future operator who has a real storage reason
-- to re-enable it. Re-enabling is one argument, and it is a decision somebody
-- makes on purpose rather than a default nobody chose.
--
-- COST, STATED HONESTLY RATHER THAN ASSUMED. The raw ledger is narrow — a
-- couple of hundred bytes a row. Even at a deliberately pessimistic 100k exits
-- a day it is on the order of tens of GB a year, which at Supabase disk rates
-- is tens of dollars a month against an asset whose whole value is that it is
-- uncopyable. The exact rate is NOT stated here because it cannot be measured
-- with the anon key: job_board_exits is service_role-only (verified today: the
-- REST read answers 200 [] with content-range */0, which is RLS with no policy,
-- not an empty table). Whoever applies this should run
--   SELECT count(*), min(exited_at), max(exited_at) FROM public.job_board_exits;
-- and record the number, so the growth curve is a measurement instead of this
-- paragraph's guess.
--
--    REJECTED — TUNE THE RETENTION INSTEAD, e.g. roll_up_and_prune_exits(3650).
--    One character of diff, no redefinition, and no risk of copying a stale
--    body. It is rejected because a large number is not a decision anybody can
--    read: 3650 states a ten-year policy nobody chose, and it lapses silently
--    on a date nobody will be watching for. It also leaves the floor
--    GREATEST(p_keep_days, 30) sitting under a value that was never about
--    thirty days. NULL says the thing that is true — never prune — and a
--    reader of the cron line sees the policy without arithmetic.
--
--    REJECTED — DELETE THE PRUNE AND ITS EXISTS GUARD OUTRIGHT. Tempting,
--    since nothing calls it now. It is rejected because the roll-up-first
--    EXISTS test is exactly what makes re-enabling SAFE, and it was written
--    against a live incident. An operator in two years facing a real storage
--    bill should turn this back on with one argument, not reconstruct the
--    guard from the incident that motivated it — and a guard reconstructed
--    from memory is how the bare DELETE came back the first time.
--
--    REJECTED — KEEP PRUNING AND RELY ON job_board_exit_rollup. The honest
--    version of this argument is strong: the rollup carries company_token, so
--    the employer-month series does survive, and that is most of what anyone
--    asks today. It is rejected on what it costs LATER: the rollup fixes the
--    grain at (company, category, reason, country, month), so every question
--    below that grain becomes unanswerable for the pruned period — per-
--    requisition timing, the distribution behind a median rather than its p50
--    and p75, any dimension not already folded into dim_counts, and any
--    re-cut somebody thinks of after the rows are gone. Aggregates are a
--    function of rows; rows are not a function of aggregates.
--
--    REJECTED FOR NOW — ARCHIVE THE RAW ROWS TO OBJECT STORAGE AND PRUNE THE
--    TABLE. This is the right answer eventually and is NOT dismissed: it
--    keeps the rows and takes them off primary disk. It is deferred because a
--    restore path that has never been exercised is not a backup, so it needs a
--    tested round trip before it can be trusted with the one dataset that
--    cannot be refetched — and at the volumes implied above that work is not
--    yet worth its own failure modes. Revisit when the measured row count
--    makes the disk line visible, which is why this file asks for that count
--    to be recorded rather than guessed.
--
-- The roll-up keeps running every night either way: it is what makes the
-- employer series cheap to read, and it must stay current so that turning the
-- prune back on later remains safe.

CREATE OR REPLACE FUNCTION public.roll_up_and_prune_exits(p_keep_days integer DEFAULT 90)
RETURNS TABLE (months_rolled integer, rows_pruned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  -- NULL / <= 0 means KEEP THE RAW LEDGER FOREVER. The roll-up above still
  -- runs; only the prune below is skipped.
  v_cutoff timestamptz := CASE
    WHEN p_keep_days IS NULL OR p_keep_days <= 0 THEN NULL
    ELSE now() - make_interval(days => GREATEST(p_keep_days, 30))
  END;
  v_months integer := 0;
  v_pruned integer := 0;
BEGIN
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
    WHERE (date_trunc('month', e.exited_at) + interval '1 month') <= v_cutoff
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
    );
  GET DIAGNOSTICS v_pruned = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_months, v_pruned;
END;
$$;

COMMENT ON FUNCTION public.roll_up_and_prune_exits(integer) IS
  'Summarises whole calendar months of job_board_exits into '
  'job_board_exit_rollup and then deletes ONLY the raw rows it has provably '
  'summarised, replacing the bare 90-day DELETE that would have destroyed the '
  'ledger from 2026-10-24 with nothing kept. DATE BASIS — THE DECISION THIS '
  'FUNCTION MAKES AND CANNOT LATER UNMAKE: every duration statistic is SPLIT '
  'BY origin_basis rather than mixed or filtered away. days_on_board is read '
  'only inside per-basis FILTERs, so no percentile stored here ever combines '
  'the ''stated'' clock (the employer''s posted_at) with the ''discovered'' '
  'clock (OUR first_seen); the ''discovered'' series is kept, separately, '
  'rather than filtered away, because this function prunes '
  'what it summarises and filtering those rows out of the summary would erase '
  'them from history instead of merely excluding them from a number; and the '
  'pre-2026-09-06 rows, whose basis was never recorded, are counted in '
  'n_basis_unrecorded and given NO percentile, because there is no honest one '
  'to compute. origin_basis is deliberately NOT in the primary key: it would '
  'split the volume, pay-disclosure and dim_counts figures by a property of '
  'our own metadata, and could not represent the NULL-basis rows at all. '
  'Basis-blind quantities (exits, n_salary_disclosed, p50_salary_min_annual, '
  'dim_counts) are unaffected by any of this and stay at the whole-group '
  'grain. Consistent with roll_up_and_prune_closures, which restricts its '
  'percentiles to the dated cohort and publishes dated_n beside them, and with '
  'get_company_fill_curve, which measures from posted_at ALONE and publishes '
  'dated_coverage: three summaries, one rule — disclose the coverage, never '
  'coalesce the clocks. Service-role only; run by the '
  '''job-board-exits-rollup-retention'' cron at 04:17 daily.'
  ' RETENTION, CHANGED 20261001090000: the prune runs ONLY when p_keep_days '
  'is a positive number. NULL or <= 0 -- which is what the '
  '''job-board-exits-rollup-retention'' cron now passes -- means roll up and '
  'KEEP THE RAW LEDGER. The rollup carries company_token, so the '
  'employer-level monthly series would survive a prune; the individual '
  'requisition, its exact exited_at and its own days_on_board would not, and '
  'no aggregate can be disaggregated afterwards. Every other dataset here is '
  'a function of a public page and can be rebuilt; a closed posting is on no '
  'public page, so this ledger accrues only with elapsed calendar time and '
  'cannot be backfilled. The DELETE and its roll-up-first EXISTS guard are '
  'retained inside an IF so an operator with a measured storage reason can '
  'turn the prune back on deliberately, with one argument.';

-- The cron keeps its name and its 04:17 slot; only the argument changes, so
-- there is one scheduled job for this ledger and its behaviour is readable in
-- the argument rather than hidden in a redefinition.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-exits-rollup-retention') THEN
      PERFORM cron.unschedule('job-board-exits-rollup-retention');
    END IF;
    -- NULL = roll up, never prune.
    PERFORM cron.schedule(
      'job-board-exits-rollup-retention', '17 4 * * *',
      $job$ SELECT public.roll_up_and_prune_exits(NULL); $job$);
  END IF;
END $$;
