SET LOCAL statement_timeout = '1min';

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
  lp_max_half_width           numeric,
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
           0.15::numeric AS max_half_width_30,
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
       AND COALESCE(r.sufficient_30, false)) AS lp_sufficient_30,
    CASE
      WHEN r.computed_at IS NULL
        OR r.computed_at < now() - make_interval(hours => (SELECT kk.layoff_stale_hours_warn FROM k kk)) THEN 'stale'
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
    (SELECT kk.max_half_width_30 FROM k kk)      AS lp_max_half_width,
    (SELECT kk.min_arm_employers FROM k kk)      AS lp_min_employers,
    (SELECT kk.max_employer_share FROM k kk)     AS lp_max_employer_share_cap,
    (SELECT kk.layoff_stale_hours_warn FROM k kk) AS lp_stale_hours
  FROM rows_ r
  ORDER BY CASE r.arm_name WHEN 'filed' THEN 0 ELSE 1 END;
$$;

COMMENT ON FUNCTION public.get_layoff_partition() IS
  'The two rows of job_board_layoff_partition (filed first, then control), always both: an unwritten '
  'or stale arm comes back with lp_sufficient_30 false and lp_reason stale; an insufficient one with '
  'the writer''s reason (n, width, arithmetic, employers, share). lp_separated says whether the two '
  'S(30) intervals overlap and is printed, never gated on. Every gate threshold rides on the row. '
  'The page prints the sentence only when both rows are sufficient, and never a ratio of the arms.';

GRANT EXECUTE ON FUNCTION public.get_layoff_partition() TO anon, authenticated, service_role;