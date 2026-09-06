-- THE FIRST IRREVERSIBLE LOSS LANDS ON OR ABOUT 2026-10-24.
--
-- job_board_exits is on a bare DELETE at 90 days — scheduled by
-- 20260726052000:48 and re-scheduled identically by 20260728180142:43:
--
--   DELETE FROM public.job_board_exits WHERE exited_at < now() - interval '90 days'
--
-- with NO rollup anywhere. Its first rows date from 2026-07-26, so the cron
-- starts destroying real history about 2026-10-24 and nothing survives it.
--
-- The closure log has been protected from exactly this since 20260727140000,
-- which replaced its identical bare DELETE with a summarise-then-prune that
-- REFUSES to delete a period it has not already summarised. The exit ledger
-- was left on the original pattern.
--
-- WHAT IS ABOUT TO BE DELETED IS NOT SECOND-TIER DATA. Age-outs are
-- simultaneously the ghost rate's NUMERATOR ("still advertised when it crossed
-- our 30-day cap") and the RIGHT-CENSORING OBSERVATIONS the hiring-health
-- estimator depends on. A survival model without its censored observations is
-- not a less precise model, it is a biased one.
--
-- ── COPIED FROM roll_up_and_prune_closures, WITH TWO CORRECTIONS ─────────
--
-- 1. ONLY WHOLE MONTHS ARE ROLLED. The closure version cuts at an INSTANT
--    (now() - 180 days) while summarising by MONTH, so it rolls the part of a
--    month that has crossed the cutoff, prunes those rows, and on the next run
--    re-rolls the SAME month from only the newly-crossed remainder —
--    overwriting the stored counts via ON CONFLICT DO UPDATE. The summary ends
--    up describing the last slice of the month rather than the month. Here a
--    month is eligible only once its END is past the cutoff, so it is
--    complete the first time it is summarised, and a re-run over an
--    already-pruned month groups zero rows and therefore writes nothing.
--    The closure function is NOT rewritten from this file: another workflow is
--    editing job_board_closures this week and a CREATE OR REPLACE from here
--    would silently overwrite theirs.
--
-- 2. PERCENTILES ARE SPLIT BY origin_basis. A median that mixes durations
--    measured from the employer's posted_at with durations measured from OUR
--    first_seen is the 2.8-day-median error frozen into a summary that outlives
--    the rows which could have explained it. 'stated' is the clean series;
--    'discovered' is a lower bound; rows written before origin_basis existed
--    are counted separately and never folded into either.
--
-- RAW RETENTION STAYS AT 90 DAYS. This migration changes what the prune is
-- ALLOWED to delete, not how long rows live; widening the window would double
-- this table's disk on a database that has already raised a disk alarm.

CREATE TABLE IF NOT EXISTS public.job_board_exit_rollup (
  company_token          text NOT NULL,
  category               text NOT NULL DEFAULT 'other',
  exit_reason            text NOT NULL,
  country                text NOT NULL DEFAULT '(none)',
  month                  date NOT NULL,            -- first day of the month
  exits                  integer NOT NULL DEFAULT 0,
  n_stated               integer NOT NULL DEFAULT 0,
  p50_days_stated        numeric,
  p75_days_stated        numeric,
  n_discovered           integer NOT NULL DEFAULT 0,
  p50_days_discovered    numeric,
  p75_days_discovered    numeric,
  n_basis_unrecorded     integer NOT NULL DEFAULT 0,
  n_salary_disclosed     integer NOT NULL DEFAULT 0,
  p50_salary_min_annual  numeric,
  dim_counts             jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_exited_at        timestamptz,
  last_exited_at         timestamptz,
  rolled_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_token, category, exit_reason, country, month)
);

COMMENT ON TABLE public.job_board_exit_rollup IS
  'Monthly summary of job_board_exits, written BEFORE the raw ledger is pruned '
  'and never after. The prune refuses to delete a month that is not present '
  'here, so the ledger can never be destroyed ahead of its summary. Private: '
  'RLS on, no policy, service_role only.';
COMMENT ON COLUMN public.job_board_exit_rollup.month IS
  'First day of the calendar month the exits were OBSERVED in (UTC). OUR '
  'observation clock — the month we concluded the postings had left the board '
  '— not any employer date.';
COMMENT ON COLUMN public.job_board_exit_rollup.exit_reason IS
  'removed | aged_out | backdated | board_dormant | untracked — the full '
  'vocabulary job_board_exits admits (20260817222407), carried into the key '
  'because they answer different questions: only aged_out is admissible in the '
  'ghost-rate numerator, and only non-removed rows are censoring observations. '
  'Folding them together would make the summary useless for both. A reason '
  'outside this set is not summarised and, because the prune matches on this '
  'column, not pruned either.';
COMMENT ON COLUMN public.job_board_exit_rollup.country IS
  'ISO 3166-1 alpha-2 of the exiting postings, in the key because jurisdiction '
  'is the cut pay-disclosure and hiring-law questions need and it is low '
  'cardinality. ''(none)'' where the postings stated no recognisable country.';
COMMENT ON COLUMN public.job_board_exit_rollup.n_stated IS
  'Exits whose days_on_board was measured from the EMPLOYER''S posted_at. The '
  'clean population; p50_days_stated and p75_days_stated describe exactly it.';
COMMENT ON COLUMN public.job_board_exit_rollup.p50_days_stated IS
  'Median days on board for the stated-basis rows only, computed at rollup '
  'time while the raw rows still exist, so it is exact for that month rather '
  'than reconstructed. Basis: the employer''s own post date.';
COMMENT ON COLUMN public.job_board_exit_rollup.p75_days_stated IS
  'As p50_days_stated, at the 75th percentile.';
COMMENT ON COLUMN public.job_board_exit_rollup.n_discovered IS
  'Exits whose days_on_board was measured from OUR first_seen because the feed '
  'stated no post date. A LOWER BOUND on tenure, never a posting age.';
COMMENT ON COLUMN public.job_board_exit_rollup.p50_days_discovered IS
  'Median days on board for the discovered-basis rows only. Measured from OUR '
  'discovery date: it understates real tenure by however long the role was '
  'open before we found the board. Never publish it as a posting age and never '
  'average it with p50_days_stated.';
COMMENT ON COLUMN public.job_board_exit_rollup.p75_days_discovered IS
  'As p50_days_discovered, at the 75th percentile, with the same caveat.';
COMMENT ON COLUMN public.job_board_exit_rollup.n_basis_unrecorded IS
  'Exits written before origin_basis existed (before 2026-09-06), whose '
  'days_on_board is a per-row MIX of the two clocks with no way to tell which. '
  'Counted so the period is not silently under-reported, and deliberately '
  'given no percentile: there is no honest one to compute.';
COMMENT ON COLUMN public.job_board_exit_rollup.n_salary_disclosed IS
  'Exits whose posting disclosed pay. The denominator is `exits`; the ratio is '
  'this employer''s pay-disclosure rate for roles that ended that month.';
COMMENT ON COLUMN public.job_board_exit_rollup.p50_salary_min_annual IS
  'Median bottom-of-band annual pay across the disclosing exits, in each '
  'row''s own currency — NOT converted. A group spanning currencies makes this '
  'meaningless; country is in the key partly so it usually does not.';
COMMENT ON COLUMN public.job_board_exit_rollup.dim_counts IS
  'Counts on the axes that would otherwise be lost when the raw rows are '
  'pruned, as a flat JSON map keyed "<dimension>=<value>". Dimensions: '
  'work_mode, experience_band, employment_type, region_code (the ISO 3166-2 '
  'subdivision, so the state-level cut outlives the 90-day raw retention), and '
  'region_disclosed — the subset of each region''s exits that DISCLOSED pay, '
  'which is the compliance number and is not derivable from the region count '
  'and n_salary_disclosed separately. ''(none)'' for undisclosed and values '
  'truncated to 80 characters. Flat rather than nested so it stays one column; '
  'a value containing "=" is stored as-is and the FIRST "=" separates the '
  'dimension. NOT carried, and therefore lost at 90 days: department (free '
  'vendor text, unbounded per group) and salary max/period/currency.';
COMMENT ON COLUMN public.job_board_exit_rollup.first_exited_at IS
  'Earliest OUR-observation exit time folded into this row.';
COMMENT ON COLUMN public.job_board_exit_rollup.last_exited_at IS
  'Latest OUR-observation exit time folded into this row.';

CREATE INDEX IF NOT EXISTS job_board_exit_rollup_month_idx
  ON public.job_board_exit_rollup (month DESC);

ALTER TABLE public.job_board_exit_rollup ENABLE ROW LEVEL SECURITY;
-- No policy, no anon grant: this summarises job_board_exits, which has been
-- service-role-only since it was created.
GRANT ALL ON public.job_board_exit_rollup TO service_role;

CREATE OR REPLACE FUNCTION public.roll_up_and_prune_exits(p_keep_days integer DEFAULT 90)
RETURNS TABLE (months_rolled integer, rows_pruned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(p_keep_days, 30));
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
           count(*) FILTER (WHERE s.origin_basis = 'stated')::int AS n_stated,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.days_on_board)
             FILTER (WHERE s.origin_basis = 'stated' AND s.days_on_board IS NOT NULL) AS p50_stated,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY s.days_on_board)
             FILTER (WHERE s.origin_basis = 'stated' AND s.days_on_board IS NOT NULL) AS p75_stated,
           count(*) FILTER (WHERE s.origin_basis = 'discovered')::int AS n_discovered,
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

  RETURN QUERY SELECT v_months, v_pruned;
END;
$$;

REVOKE ALL ON FUNCTION public.roll_up_and_prune_exits(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_exits(integer) TO service_role;

-- THE BARE DELETE MUST NOT SURVIVE THIS MIGRATION. It is unscheduled by name
-- first — leaving it in place beside the safe job would keep the 2026-10-24
-- deadline exactly where it is.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-exits-retention') THEN
      PERFORM cron.unschedule('job-board-exits-retention');
    END IF;
    PERFORM cron.schedule(
      'job-board-exits-rollup-retention', '17 4 * * *',
      $job$ SELECT public.roll_up_and_prune_exits(90); $job$);
  END IF;
END $$;
