-- THE READER PUBLISHES THE COUNTS THE NEW GATE IS BUILT FROM, AND REFUSES THE
-- ROW THAT PREDATES IT.
--
-- 20260925164237 gave refresh_layoff_partition the positive control the other
-- two day-30 chains got in 20260925163517 and 20260925163842: a per-board event
-- floor on the risk set, a floor on fills alone, a relist-against-fill balance,
-- and a ceiling on the interval half-width relative to the complement the
-- sentence asserts. This file is the reader half. It does three things.
--
-- 1. IT PUBLISHES THE COUNTS. lp_events_30, lp_fills_30 and lp_relists_30 ride
--    on the row for the reason sum_check_30 does: a gate asserted is a gate
--    nobody checked, and the section that renders this can now re-apply it
--    rather than trust it. lp_min_events, lp_min_fills and
--    lp_max_rel_half_width ride on it too, because every threshold the page
--    prints comes back on the row -- that rule is why this function exists.
--
-- 2. IT REFUSES THE ROW THE OLD GATE WROTE. This is not a live computation: the
--    partition is a STORED table with one row per arm, written by a refresh on a
--    schedule. The instant 164237 applies, the row already in it was computed by
--    the four-term gate and still carries sufficient_30 = true -- and it will
--    keep carrying it until the next refresh runs. Its events_30 is NULL,
--    because that column did not exist when it was written, and that NULL is the
--    only honest tell available. So lp_sufficient_30 requires events_30 to be
--    present, and lp_reason answers 'uncontrolled' when it is not: the same word
--    the same page's field table uses for a response that predates its own
--    control, and the same refusal. The writer COALESCES events_30 to zero on
--    every row it writes, so this NULL means one thing only and never "the gate
--    admitted nothing" -- that case answers 'ungated' or 'events'. Without this
--    the page would print the
--    uncontrolled figure for as long as the gap between the migration and the
--    next refresh -- which is exactly the window a staged migration runner makes
--    unpredictable (project_lovable_deploys).
--
-- 3. IT NAMES THE NEW REASONS. insufficient_reason gained 'events', 'fills',
--    'relists' and 'precision' arms in 164237, and they pass through here
--    unchanged; the section's own reason list carries the copy.
--
-- Nothing else moves: the arm order, the staleness window, lp_separated and
-- every existing column are the text 20260918100800 shipped. MIGRATIONS ARE
-- IMMUTABLE, so that file is untouched. One function per file.

SET LOCAL statement_timeout = '1min';

-- THE SHAPE CHANGES, SO THE FUNCTION IS DROPPED FROM THE CATALOGUE FIRST.
-- CREATE OR REPLACE cannot change a RETURNS TABLE, and this re-issue adds six
-- columns. The drop enumerates pg_proc by name rather than trusting a
-- hand-listed signature, because the live database has been observed holding
-- overloads no migration file describes (project_schema_drift). Grants are
-- discarded by the drop and re-issued at the foot of this file.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'get_layoff_partition'
  LOOP
    RAISE NOTICE 'dropping % ahead of its re-issue with the control columns', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_layoff_partition()
RETURNS TABLE (
  lp_arm                      text,
  lp_sufficient_30            boolean,
  lp_reason                   text,
  lp_taken_down_30            numeric,
  lp_still_open_30            numeric,
  lp_still_open_30_lo         numeric,
  lp_still_open_30_hi         numeric,
  lp_half_width_30            numeric,
  lp_relist_rate_30           numeric,
  lp_n_at_risk_30             int,
  lp_events_30                int,
  lp_fills_30                 int,
  lp_relists_30               int,
  lp_employers_n              int,
  lp_max_employer_share       numeric,
  lp_gate_share_30            numeric,
  lp_sum_check_30             numeric,
  lp_cohort_from              date,
  lp_cohort_to                date,
  lp_separated                boolean,
  lp_newest_filing_event_date date,
  lp_warn_lag_p50_days        numeric,
  lp_warn_lag_n               int,
  lp_computed_at              timestamptz,
  lp_filings_read_at          timestamptz,
  lp_min_n                    int,
  lp_min_events               int,
  lp_min_fills                int,
  lp_max_half_width           numeric,
  lp_max_rel_half_width       numeric,
  lp_min_employers            int,
  lp_max_employer_share_cap   numeric,
  lp_stale_hours              int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  WITH k AS (
    SELECT 25            AS min_n_at_risk_30,
           5             AS min_events_30,
           5             AS min_fills_30,
           0.15::numeric AS max_half_width_30,
           0.50::numeric AS max_rel_half_width_30,
           10            AS min_arm_employers,
           0.40::numeric AS max_employer_share,
           48            AS layoff_stale_hours_warn
  ),
  arms AS (
    SELECT 'filed' AS arm UNION ALL SELECT 'control'
  ),
  rows_ AS (
    SELECT a.arm AS arm_name, t.*
    FROM arms a
    LEFT JOIN public.job_board_layoff_partition t ON t.arm = a.arm
  ),
  sep AS (
    SELECT CASE
             WHEN f.still_open_30_lo IS NULL OR f.still_open_30_hi IS NULL
               OR c.still_open_30_lo IS NULL OR c.still_open_30_hi IS NULL THEN NULL
             ELSE (f.still_open_30_hi < c.still_open_30_lo OR c.still_open_30_hi < f.still_open_30_lo)
           END AS separated
    FROM rows_ f, rows_ c
    WHERE f.arm_name = 'filed' AND c.arm_name = 'control'
  )
  SELECT
    r.arm_name AS lp_arm,
    (r.computed_at IS NOT NULL
       AND r.computed_at >= now() - make_interval(hours => (SELECT kk.layoff_stale_hours_warn FROM k kk))
       AND r.events_30 IS NOT NULL
       AND COALESCE(r.sufficient_30, false)) AS lp_sufficient_30,
    CASE
      WHEN r.computed_at IS NULL
        OR r.computed_at < now() - make_interval(hours => (SELECT kk.layoff_stale_hours_warn FROM k kk)) THEN 'stale'
      -- AND AN ARM WRITTEN BEFORE THE CONTROL EXISTED IS NOT A SUFFICIENT ARM.
      -- job_board_layoff_partition is a stored table: after 20260925164237
      -- applies, the row that is already in it was computed by the OLD gate and
      -- keeps sufficient_30 true until the next refresh runs. Its events_30 is
      -- NULL, because the column did not exist when it was written, and that
      -- NULL is the tell. It is reported as `uncontrolled` rather than as a
      -- figure: the same word the field table uses for a response that predates
      -- its own control, and the same refusal.
      WHEN r.events_30 IS NULL THEN 'uncontrolled'
      WHEN COALESCE(r.sufficient_30, false) THEN NULL
      ELSE COALESCE(r.insufficient_reason, 'n')
    END AS lp_reason,
    r.taken_down_30            AS lp_taken_down_30,
    r.still_open_30            AS lp_still_open_30,
    r.still_open_30_lo         AS lp_still_open_30_lo,
    r.still_open_30_hi         AS lp_still_open_30_hi,
    r.half_width_30            AS lp_half_width_30,
    r.relist_rate_30           AS lp_relist_rate_30,
    r.n_at_risk_30             AS lp_n_at_risk_30,
    r.events_30                AS lp_events_30,
    r.fills_30                 AS lp_fills_30,
    r.relists_30               AS lp_relists_30,
    r.employers_n              AS lp_employers_n,
    r.max_employer_share       AS lp_max_employer_share,
    r.gate_share_30            AS lp_gate_share_30,
    r.sum_check_30             AS lp_sum_check_30,
    r.cohort_from              AS lp_cohort_from,
    r.cohort_to                AS lp_cohort_to,
    (SELECT s.separated FROM sep s) AS lp_separated,
    r.newest_filing_event_date AS lp_newest_filing_event_date,
    r.warn_lag_p50_days        AS lp_warn_lag_p50_days,
    r.warn_lag_n               AS lp_warn_lag_n,
    r.computed_at              AS lp_computed_at,
    r.filings_read_at          AS lp_filings_read_at,
    (SELECT kk.min_n_at_risk_30 FROM k kk)       AS lp_min_n,
    (SELECT kk.min_events_30 FROM k kk)          AS lp_min_events,
    (SELECT kk.min_fills_30 FROM k kk)           AS lp_min_fills,
    (SELECT kk.max_half_width_30 FROM k kk)      AS lp_max_half_width,
    (SELECT kk.max_rel_half_width_30 FROM k kk)  AS lp_max_rel_half_width,
    (SELECT kk.min_arm_employers FROM k kk)      AS lp_min_employers,
    (SELECT kk.max_employer_share FROM k kk)     AS lp_max_employer_share_cap,
    (SELECT kk.layoff_stale_hours_warn FROM k kk) AS lp_stale_hours
  FROM rows_ r
  ORDER BY CASE r.arm_name WHEN 'filed' THEN 0 ELSE 1 END;
$$;

COMMENT ON FUNCTION public.get_layoff_partition() IS
  'The two rows of job_board_layoff_partition (filed first, then control), always both: an unwritten '
  'or stale arm comes back with lp_sufficient_30 false and lp_reason stale; an insufficient one with '
  'the writer''s reason (n, ungated, events, fills, relists, width, precision, arithmetic, employers, '
  'share). '
  'lp_separated says whether the two S(30) intervals overlap and is printed, never gated on. Every '
  'gate threshold rides on the row -- lp_min_n, lp_min_events, lp_min_fills, lp_max_half_width, '
  'lp_max_rel_half_width, lp_min_employers, lp_max_employer_share_cap -- and so do the counts the '
  'positive control is built from: lp_events_30, lp_fills_30, lp_relists_30. '
  'AN ARM WRITTEN BEFORE THE CONTROL EXISTED IS NOT SUFFICIENT (20260925164510): the partition is a '
  'stored table, so after 20260925164237 applies the row already in it was computed by the old '
  'four-term gate and keeps sufficient_30 true until the next refresh runs. events_30 IS NULL on such '
  'a row -- the column did not exist when it was written -- so lp_sufficient_30 requires events_30 to '
  'be present and lp_reason answers uncontrolled when it is not. The page prints the sentence only '
  'when both rows are sufficient, and never a ratio of the arms.';

REVOKE ALL ON FUNCTION public.get_layoff_partition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_layoff_partition() FROM anon;
REVOKE ALL ON FUNCTION public.get_layoff_partition() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_layoff_partition() TO anon, authenticated, service_role;

DO $$
DECLARE cols text; body text;
BEGIN
  SELECT pg_get_function_result(p.oid), pg_get_functiondef(p.oid) INTO cols, body
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_layoff_partition';
  IF cols NOT LIKE '%lp_events_30%' OR cols NOT LIKE '%lp_min_events%'
     OR cols NOT LIKE '%lp_max_rel_half_width%' THEN
    RAISE EXCEPTION 'get_layoff_partition: re-issued without the control it has to publish: %', cols;
  END IF;
  IF body NOT LIKE '%events_30 IS NULL%' THEN
    RAISE EXCEPTION 'get_layoff_partition: re-issued without refusing the row the old gate wrote';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
