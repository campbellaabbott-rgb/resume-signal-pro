-- TWO ARMS SIDE BY SIDE, NEVER A RATIO.
--
-- The writer of job_board_layoff_partition: the day-30 chain of
-- 20260909217500 (get_category_fill_curve) run once more with ONE added
-- partition key and ONE added gate. The key is whether the posting's
-- employer had a qualifying layoff filing dated inside the lookback BEFORE
-- the role was posted (arm 'filed') or not (arm 'control'); the gate, on the
-- filed arm only, is an employer floor and a largest-employer share cap, so
-- one big board cannot wear a market label. Every other clause is the field
-- curve's: the cohort floor at the exits-origin stamp, the observability
-- gate (full_read or lap_proven only -- a windowed board's S(30) is 1 by
-- construction and it is NOT admitted), superseded closures as relists,
-- suspect-or-dark batches censored, lap_backfill closures excluded, the
-- DESC risk set, the ln(0) clamp, the genuine lag, +1.96 as the LOWER bound
-- on S. It runs off the request path (the field curve measures 13.8 to
-- 25.7 s live) and writes two rows, ALWAYS BOTH: an arm the chain produced
-- nothing for is a row with NULL figures, sufficient_30 false and a reason,
-- because the section renders the reason and never an absence.
--
-- WHAT THE KEY IS AND IS NOT. 'filed' means: a layoff_matches row (alias or
-- exact_multitoken -- the column admits nothing else) joined to a filing
-- that is status active, has a source_url, is not dated after our read,
-- and, if a WARN notice, states at least the single-site worker bar; and
-- that filing's event_date (the notice date, or the 8-K's date of report --
-- never the day we read it) falls in (posted_at - lookback, posted_at]. A
-- filing AFTER the posting does not put the role in the filed arm: the
-- question is what the employer had on record when it posted. An 8-K/A is
-- status amendment and never qualifies. posted_at only, never first_seen
-- or effective_posted, exactly as the curves.
--
-- WHAT THE ROW SAYS. R(30) is "taken down for good" -- a takedown is not a
-- hire and the noun is never "filled"; S(30) still advertised at the cap;
-- X(30) re-listed; R + X + S = 1 is CHECKED as sum_check_30. The two arms
-- are printed side by side with their own intervals; no column here is a
-- ratio of the two and the reader computes none. `separated` (the two S(30)
-- intervals do not overlap) is the reader's to compute and print, never to
-- gate on: an overlap is a finding.
--
-- CONSTANTS, named once in k, mirrored by src/config/layoffs.ts
-- (LAYOFF_LOOKBACK_DAYS, LAYOFF_WARN_MIN_WORKERS, LAYOFF_MIN_ARM_EMPLOYERS,
-- LAYOFF_MAX_EMPLOYER_SHARE) and by the same gate the field curve spells
-- (25 at risk, half-width 0.15). The cross-runtime guard reads them from
-- this file by regex. Run scripts/verify-migration-20260918100000.mjs
-- before believing any of this: it seeds two arms with hand-worked truths
-- and a windowed board that must not count.

SET LOCAL statement_timeout = '10min';

CREATE OR REPLACE FUNCTION public.refresh_layoff_partition()
RETURNS TABLE (
  lw_arm                 text,
  lw_sufficient_30       boolean,
  lw_insufficient_reason text,
  lw_n_at_risk_30        int,
  lw_employers_n         int,
  lw_still_open_30       numeric,
  lw_taken_down_30       numeric,
  lw_ms                  int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  v_t0      timestamptz := clock_timestamp();
  v_ms      int := 0;
  v_read_at timestamptz;
  v_newest  date;
  v_lag_p50 numeric;
  v_lag_n   int;
BEGIN
  -- The read stamp and the newest filing held, printed beside the figure.
  SELECT max(f.source_read_at), max(f.event_date)
    INTO v_read_at, v_newest
    FROM public.layoff_filings f
   WHERE f.status = 'active';

  -- The state-side lag the section discloses: median days from a notice's
  -- own date to the day the state's stamp made it public, over the last 90
  -- days of notices that carry a notice date. NULL until there are any.
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (f.public_date - f.event_date)),
         count(*)::int
    INTO v_lag_p50, v_lag_n
    FROM public.layoff_filings f
   WHERE f.source = 'state_warn'
     AND f.event_basis = 'warn_notice_date'
     AND f.event_date >= current_date - 90;

  WITH win AS (
    SELECT 90 AS d
  ),
  k AS (
    SELECT DATE '2026-09-06'  AS exits_origin_stamped_from,
           90                 AS layoff_lookback_days,
           50                 AS layoff_warn_min_workers,
           25                 AS min_n_at_risk_30,
           0.15::numeric      AS max_half_width_30,
           10                 AS min_arm_employers,
           0.40::numeric      AS max_employer_share
  ),
  cohort30 AS (
    SELECT GREATEST((now() - make_interval(days => (SELECT w.d FROM win w)))::date + 1,
                    (SELECT kk.exits_origin_stamped_from FROM k kk) - 30) AS from_d,
           current_date - 30                                              AS to_d
  ),
  obs AS (
    SELECT o.company_token AS tok,
           (o.bucket IN ('full_read', 'lap_proven')) AS admitted
    FROM public.job_board_board_observability o
  ),
  -- The filings that qualify, as (token, event_date) pairs. The same
  -- predicates as the readers, minus the display window: the lookback is
  -- the window here.
  filed AS (
    SELECT m.company_token AS tok, f.event_date
    FROM public.layoff_filings f
    JOIN public.layoff_matches m ON m.filing_id = f.filing_id
    WHERE f.status = 'active'
      AND m.matched_via IN ('exact_multitoken', 'alias')
      AND f.source_url IS NOT NULL
      AND f.event_date <= f.source_read_at::date
      AND f.form IS DISTINCT FROM '8-K/A'
      AND (f.source <> 'state_warn' OR f.workers >= (SELECT kk.layoff_warn_min_workers FROM k kk))
  ),
  filed_by_tok AS (
    SELECT x.tok, array_agg(x.event_date) AS dates FROM filed x GROUP BY x.tok
  ),
  open_now AS (
    SELECT p.company_token AS tok, count(*)::int AS n
    FROM public.job_board_postings p
    WHERE p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token
  ),
  batches AS (
    SELECT
      c.company_token AS tok,
      c.closed_at     AS at,
      date_trunc('day', c.closed_at)::date AS on_day,
      count(*)::int   AS n_removed
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => (SELECT w.d FROM win w))
      AND c.batch_live_before IS NULL
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token, c.closed_at, date_trunc('day', c.closed_at)::date
  ),
  sized AS (
    SELECT b.*,
           (SELECT s.open_roles
              FROM public.job_board_company_snapshots s
             WHERE s.company_token = b.tok
               AND s.snapshot_date <= b.on_day
             ORDER BY s.snapshot_date DESC
             LIMIT 1) AS era_n
    FROM batches b
  ),
  dark AS (
    SELECT z.tok, z.at
    FROM sized z
    LEFT JOIN open_now o ON o.tok = z.tok
    WHERE z.n_removed > CASE
             WHEN z.era_n IS NOT NULL THEN GREATEST(5,  0.30 * z.era_n)
             ELSE GREATEST(25, 0.30 * COALESCE(o.n, 0))
           END
  ),
  bad_batch AS (
    SELECT DISTINCT c.company_token AS tok, c.closed_at AS at
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => (SELECT w.d FROM win w))
      AND COALESCE(c.suspect, false)
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    UNION
    SELECT d.tok, d.at FROM dark d
  ),
  raw AS (
    SELECT
      CASE WHEN c.posted_at IS NOT NULL AND fb.tok IS NOT NULL AND EXISTS (
             SELECT 1 FROM unnest(fb.dates) AS x(event_date)
              WHERE x.event_date >  (c.posted_at - make_interval(days => (SELECT kk.layoff_lookback_days FROM k kk)))::date
                AND x.event_date <= c.posted_at::date)
           THEN 'filed' ELSE 'control' END AS cat,
      c.company_token AS tok,
      CASE WHEN c.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (c.posted_at IS NOT NULL
        AND c.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND c.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
      0 AS is_ageout,
      COALESCE(ob.admitted, false) AS admitted,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL OR c.superseded THEN 0 ELSE 1 END AS is_fill,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL THEN 0
           WHEN c.superseded THEN 1 ELSE 0 END AS is_relist,
      (c.posted_at IS NOT NULL) AS dated
    FROM public.job_board_closures c
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    LEFT JOIN obs ob ON ob.tok = c.company_token
    LEFT JOIN filed_by_tok fb ON fb.tok = c.company_token
    WHERE c.closed_at >= now() - make_interval(days => (SELECT w.d FROM win w))
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'

    UNION ALL

    SELECT
      CASE WHEN e.posted_at IS NOT NULL AND fb.tok IS NOT NULL AND EXISTS (
             SELECT 1 FROM unnest(fb.dates) AS x(event_date)
              WHERE x.event_date >  (e.posted_at - make_interval(days => (SELECT kk.layoff_lookback_days FROM k kk)))::date
                AND x.event_date <= e.posted_at::date)
           THEN 'filed' ELSE 'control' END AS cat,
      e.company_token AS tok,
      CASE WHEN e.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (e.exited_at - e.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (e.posted_at IS NOT NULL
        AND e.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND e.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
      CASE WHEN bb.tok IS NOT NULL THEN 0
           WHEN e.exit_reason = 'aged_out' THEN 1 ELSE 0 END AS is_ageout,
      COALESCE(ob.admitted, false) AS admitted,
      0 AS is_fill,
      0 AS is_relist,
      (e.posted_at IS NOT NULL) AS dated
    FROM public.job_board_exits e
    LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at
    LEFT JOIN obs ob ON ob.tok = e.company_token
    LEFT JOIN filed_by_tok fb ON fb.tok = e.company_token
    WHERE e.exited_at >= now() - make_interval(days => (SELECT w.d FROM win w))
      AND e.exit_reason IN ('aged_out', 'board_dormant', 'untracked')

    UNION ALL

    SELECT
      CASE WHEN p.posted_at IS NOT NULL AND fb.tok IS NOT NULL AND EXISTS (
             SELECT 1 FROM unnest(fb.dates) AS x(event_date)
              WHERE x.event_date >  (p.posted_at - make_interval(days => (SELECT kk.layoff_lookback_days FROM k kk)))::date
                AND x.event_date <= p.posted_at::date)
           THEN 'filed' ELSE 'control' END AS cat,
      p.company_token AS tok,
      CASE WHEN p.posted_at IS NOT NULL
           THEN LEAST(floor(extract(epoch FROM (now() - p.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (p.posted_at IS NOT NULL
        AND p.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND p.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
      0 AS is_ageout,
      COALESCE(ob.admitted, false) AS admitted,
      0 AS is_fill,
      0 AS is_relist,
      (p.posted_at IS NOT NULL) AS dated
    FROM public.job_board_postings p
    LEFT JOIN obs ob ON ob.tok = p.company_token
    LEFT JOIN filed_by_tok fb ON fb.tok = p.company_token
    WHERE p.missing_since IS NULL
  ),
  agg30 AS (
    SELECT
      r.cat,
      r.tt,
      sum(r.is_fill)::int   AS d_fill,
      sum(r.is_relist)::int AS d_relist,
      sum(r.is_ageout)::int AS d_ageout,
      count(*)::int         AS cnt
    FROM raw r
    WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0 AND r.admitted
    GROUP BY r.cat, r.tt
  ),
  curve30 AS (
    SELECT
      a.cat, a.tt, a.d_fill, a.d_relist, a.d_ageout, a.cnt,
      (a.d_fill + a.d_relist) AS d,
      (sum(a.cnt) OVER (
        PARTITION BY a.cat ORDER BY a.tt DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ))::int AS n
    FROM agg30 a
  ),
  surv30 AS (
    SELECT
      c.*,
      exp(sum(ln(GREATEST(1.0 - c.d::numeric / c.n, 1e-12))) OVER (
        PARTITION BY c.cat ORDER BY c.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) AS s,
      sum(c.d::numeric / (c.n::numeric * NULLIF(c.n - c.d, 0))) OVER (
        PARTITION BY c.cat ORDER BY c.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS gw
    FROM curve30 c
  ),
  lagged30 AS (
    SELECT s.*, lag(s.s, 1, 1.0) OVER (PARTITION BY s.cat ORDER BY s.tt) AS s_prev
    FROM surv30 s
  ),
  cum30 AS (
    SELECT
      l.*,
      sum(l.s_prev * l.d_fill::numeric / l.n) OVER (
        PARTITION BY l.cat ORDER BY l.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS r_cif,
      sum(l.s_prev * l.d_relist::numeric / l.n) OVER (
        PARTITION BY l.cat ORDER BY l.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS x_cif
    FROM lagged30 l
  ),
  at_h30 AS (
    SELECT
      c.cat,
      COALESCE(max(c.r_cif) FILTER (WHERE c.tt <= 30), 0) AS r30,
      COALESCE(max(c.x_cif) FILTER (WHERE c.tt <= 30), 0) AS x30,
      COALESCE(min(c.s)     FILTER (WHERE c.tt <= 30), 1) AS s30,
      COALESCE(max(c.gw)    FILTER (WHERE c.tt <= 30), 0) AS gw30,
      COALESCE(sum(c.cnt)      FILTER (WHERE c.tt >= 30), 0)::int AS n30,
      COALESCE(sum(c.d_ageout) FILTER (WHERE c.tt >= 30), 0)::int AS ageouts30
    FROM cum30 c
    GROUP BY c.cat
  ),
  band30 AS (
    SELECT
      a.*,
      CASE WHEN a.s30 >= 1 OR a.s30 <= 0 THEN 0::numeric
           ELSE LEAST(a.gw30 / (ln(a.s30) * ln(a.s30)), 4.0)
      END AS v30
    FROM at_h30 a
  ),
  bounds30 AS (
    SELECT
      b.*,
      CASE WHEN b.v30 <= 0 THEN b.s30 ELSE b.s30 ^ LEAST(exp(1.96 * sqrt(b.v30)), 50.0) END AS s30_lo,
      CASE WHEN b.v30 <= 0 THEN b.s30 ELSE b.s30 ^ GREATEST(exp(-1.96 * sqrt(b.v30)), 0.02) END AS s30_hi
    FROM band30 b
  ),
  gate30 AS (
    SELECT
      r.cat,
      count(*) FILTER (WHERE r.in_cohort30 AND r.dated AND r.admitted)::int AS admitted_dated_n,
      count(*) FILTER (WHERE r.in_cohort30 AND r.dated)::int                AS dated_n30
    FROM raw r
    GROUP BY r.cat
  ),
  -- The employer gate: how many distinct boards the arm's admitted dated
  -- cohort spans, and the share of it held by its largest board.
  emp AS (
    SELECT s.cat,
           count(DISTINCT s.tok)::int          AS employers_n,
           max(s.cnt)::numeric / sum(s.cnt)    AS top_share
    FROM (
      SELECT r.cat, r.tok, count(*) AS cnt
      FROM raw r
      WHERE r.in_cohort30 AND r.dated AND r.admitted
      GROUP BY r.cat, r.tok
    ) s
    GROUP BY s.cat
  ),
  arms AS (
    SELECT 'filed' AS arm UNION ALL SELECT 'control'
  ),
  final AS (
    SELECT
      a.arm,
      round(e30.r30, 4)        AS taken_down_30,
      round(e30.s30, 4)        AS still_open_30,
      round(e30.s30_lo, 4)     AS still_open_30_lo,
      round(e30.s30_hi, 4)     AS still_open_30_hi,
      round((e30.s30_hi - e30.s30_lo) / 2, 4) AS half_width_30,
      round(e30.x30, 4)        AS relist_rate_30,
      e30.n30                  AS n_at_risk_30,
      em.employers_n,
      round(em.top_share, 4)   AS max_employer_share,
      round(g30.admitted_dated_n::numeric / NULLIF(g30.dated_n30, 0), 4) AS gate_share_30,
      round(e30.r30 + e30.x30 + e30.s30, 6) AS sum_check_30,
      (SELECT h.from_d FROM cohort30 h) AS cohort_from,
      (SELECT h.to_d   FROM cohort30 h) AS cohort_to,
      COALESCE(e30.cat IS NOT NULL
         AND COALESCE(e30.n30, 0) >= (SELECT kk.min_n_at_risk_30 FROM k kk)
         AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_half_width_30 FROM k kk)
         AND abs(e30.r30 + e30.x30 + e30.s30 - 1) <= 0.000001
         AND (a.arm = 'control'
              OR (COALESCE(em.employers_n, 0) >= (SELECT kk.min_arm_employers FROM k kk)
                  AND COALESCE(em.top_share, 1) <= (SELECT kk.max_employer_share FROM k kk))), false) AS sufficient_30,
      CASE
        WHEN e30.cat IS NULL OR COALESCE(e30.n30, 0) < (SELECT kk.min_n_at_risk_30 FROM k kk) THEN 'n'
        WHEN (e30.s30_hi - e30.s30_lo) / 2 > (SELECT kk.max_half_width_30 FROM k kk) THEN 'width'
        WHEN abs(e30.r30 + e30.x30 + e30.s30 - 1) > 0.000001 THEN 'arithmetic'
        WHEN a.arm = 'filed' AND COALESCE(em.employers_n, 0) < (SELECT kk.min_arm_employers FROM k kk) THEN 'employers'
        WHEN a.arm = 'filed' AND COALESCE(em.top_share, 1) > (SELECT kk.max_employer_share FROM k kk) THEN 'share'
        ELSE NULL
      END AS insufficient_reason
    FROM arms a
    LEFT JOIN bounds30 e30 ON e30.cat = a.arm
    LEFT JOIN gate30   g30 ON g30.cat = a.arm
    LEFT JOIN emp      em  ON em.cat  = a.arm
  )
  INSERT INTO public.job_board_layoff_partition AS t (
    arm, taken_down_30, still_open_30, still_open_30_lo, still_open_30_hi, half_width_30, relist_rate_30,
    n_at_risk_30, employers_n, max_employer_share, gate_share_30, sum_check_30, cohort_from, cohort_to,
    sufficient_30, insufficient_reason, newest_filing_event_date, warn_lag_p50_days, warn_lag_n,
    computed_at, filings_read_at
  )
  SELECT
    fn.arm, fn.taken_down_30, fn.still_open_30, fn.still_open_30_lo, fn.still_open_30_hi, fn.half_width_30, fn.relist_rate_30,
    fn.n_at_risk_30, fn.employers_n, fn.max_employer_share, fn.gate_share_30, fn.sum_check_30, fn.cohort_from, fn.cohort_to,
    fn.sufficient_30, fn.insufficient_reason, v_newest, round(v_lag_p50, 1), v_lag_n,
    now(), v_read_at
  FROM final fn
  ON CONFLICT (arm) DO UPDATE SET
    taken_down_30            = EXCLUDED.taken_down_30,
    still_open_30            = EXCLUDED.still_open_30,
    still_open_30_lo         = EXCLUDED.still_open_30_lo,
    still_open_30_hi         = EXCLUDED.still_open_30_hi,
    half_width_30            = EXCLUDED.half_width_30,
    relist_rate_30           = EXCLUDED.relist_rate_30,
    n_at_risk_30             = EXCLUDED.n_at_risk_30,
    employers_n              = EXCLUDED.employers_n,
    max_employer_share       = EXCLUDED.max_employer_share,
    gate_share_30            = EXCLUDED.gate_share_30,
    sum_check_30             = EXCLUDED.sum_check_30,
    cohort_from              = EXCLUDED.cohort_from,
    cohort_to                = EXCLUDED.cohort_to,
    sufficient_30            = EXCLUDED.sufficient_30,
    insufficient_reason      = EXCLUDED.insufficient_reason,
    newest_filing_event_date = EXCLUDED.newest_filing_event_date,
    warn_lag_p50_days        = EXCLUDED.warn_lag_p50_days,
    warn_lag_n               = EXCLUDED.warn_lag_n,
    computed_at              = EXCLUDED.computed_at,
    filings_read_at          = EXCLUDED.filings_read_at;

  v_ms := (extract(epoch FROM (clock_timestamp() - v_t0)) * 1000)::int;

  INSERT INTO public.layoff_read_log (kind, fetched, kept, new_rows, ok, ms, note)
  SELECT 'partition',
         (SELECT count(*)::int FROM public.job_board_layoff_partition t),
         (SELECT count(*)::int FROM public.job_board_layoff_partition t WHERE t.sufficient_30),
         2, true, v_ms,
         (SELECT string_agg(format('%s: n=%s employers=%s share=%s sufficient=%s reason=%s',
                                   t.arm, t.n_at_risk_30, t.employers_n, t.max_employer_share, t.sufficient_30, t.insufficient_reason),
                            ' | ' ORDER BY t.arm)
            FROM public.job_board_layoff_partition t);

  RETURN QUERY
    SELECT t.arm, t.sufficient_30, t.insufficient_reason, t.n_at_risk_30, t.employers_n,
           t.still_open_30, t.taken_down_30, v_ms
      FROM public.job_board_layoff_partition t
     ORDER BY t.arm;
END;
$$;

COMMENT ON FUNCTION public.refresh_layoff_partition() IS
  'Writes the two rows of job_board_layoff_partition: the day-30 Aalen-Johansen share (S(30) still '
  'advertised, R(30) taken down for good, X(30) re-listed, R + X + S = 1 checked as sum_check_30) of '
  'dated roles on boards we read to the end, split by whether the employer had a qualifying layoff '
  'filing dated inside the lookback before the role was posted. The chain is the field curve''s '
  '(20260909217500) with the arm as the partition key: same cohort floor, same observability gate, '
  'same batch censoring, same interval (an APPROXIMATION on the complementary log-log scale, exact '
  'only if the fill share is constant in t). sufficient_30 adds, on the filed arm, an employer floor '
  'and a largest-employer share cap; insufficient_reason names the first failed gate (n, width, '
  'arithmetic, employers, share). Both rows always exist. Never a ratio of the arms. service_role only.';

REVOKE ALL ON FUNCTION public.refresh_layoff_partition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_layoff_partition() TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'refresh_layoff_partition'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Seed once, best effort, so the two rows exist from the moment this lands
-- and the section renders its reason rather than nothing. A failure here is
-- logged and the nightly refresh retries; it must not leave the deploy red.
DO $$
BEGIN
  PERFORM public.refresh_layoff_partition();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'refresh_layoff_partition seed failed (the nightly refresh will retry): %', SQLERRM;
END $$;
