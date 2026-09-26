-- THE THIRD COPY OF THE DAY-30 ESTIMATOR HAD NO POSITIVE CONTROL EITHER.
--
-- 20260925163517 and 20260925163842 gave the per-employer and per-field day-30
-- gates a positive control: a sufficiency test made of a risk-set floor, an
-- interval half-width, and the R + X + S identity passes VACUOUSLY on a cohort
-- that produced no events, because no events means no Greenwood variance and S
-- is exactly one. refresh_layoff_partition (20260918100700) is the THIRD chain
-- that publishes S(30) from this codebase, and it was left with the four
-- original terms: its risk set was cut on the observability bucket alone, and
-- nothing anywhere in it required a board's cohort to have been seen produce a
-- takedown or a re-listing.
--
-- WHY THAT MATTERED MORE THAN THE OTHER TWO, AND WHY IT COULD NOT WAIT FOR ITS
-- OWN PASS. The two arms this function writes are rendered by
-- LayoffPartitionSection on the board's public index page -- the SAME PAGE as the field
-- table the other two migrations fixed. After that change the page would have
-- printed a field table computed over boards whose own cohorts produced events,
-- beside a layoff sentence computed over boards that had not: two day-30 shares
-- on one page, drawn from different populations, read side by side by the same
-- reader. That is the error feedback_measure_like_with_like exists to stop, and
-- it is worse here than a wrong number would be, because the whole point of the
-- section is the COMPARISON of its two arms.
--
-- MEASURED, one basis: live anon read of get_layoff_partition at
-- 2026-09-25T21:47Z. The control arm published still_open_30 = 0.5466,
-- taken_down_30 = 0.3726, half_width_30 = 0.0010 over n_at_risk_30 = 387,957
-- across 30,867 boards, with sufficient_30 true and no reason. The full
-- catalogue walk taken the same evening (2026-09-25T21:40:43Z to 21:44:27Z, all
-- 44,379 tokens, zero failed chunks) puts 10.59% of the day-30 risk mass on
-- boards whose cohort produced ZERO events and a further 5.00% on boards with
-- between one and four. That mass sat in BOTH arms of this function and had just
-- been removed from the field table. Bounding the movement the way the field
-- curve's header does -- removing a share z of the risk set that contributes no
-- events multiplies every hazard by at most 1/(1 - z) -- the control arm's
-- 0.5466 could be as low as 0.4921 once those boards leave, which is more than
-- five points and larger than the gap between the two arms that the section
-- exists to talk about (the filed arm published 0.4916).
--
-- WHAT THIS FILE CHANGES, AND NOTHING ELSE. The seven-term gate the other two
-- grains now carry, re-issued here with the same thresholds and the same
-- spellings:
--   * board30, the per-board event count, grouped by (board, ARM) rather than
--     by board -- for the reason the field curve groups by (board, field). A
--     board contributes to both arms here, because whether a role is `filed` or
--     `control` depends on whether a qualifying filing preceded THAT role's
--     own posting date, so the two are different populations of one board's
--     postings and the control has to be counted in each.
--   * gated, the day-30 risk set cut by EQUALITY on both tests at once. All
--     four day-30 consumers -- the estimator chain, the coverage share, the
--     employer floor and the concentration cap -- now read it, so all four
--     describe one admission.
--   * min_events_30, min_fills_30 and max_rel_half_width_30 in sufficient_30,
--     and 'ungated', 'events', 'fills', 'relists' and 'precision' arms in
--     insufficient_reason -- 'ungated' because an arm the two admission tests
--     emptied is not an arm with too few roles, and the old CASE reported both
--     as 'n'. The fill terms are here for the same reason they are
--     in the other two: taken_down_30 is a FILL rate published under the same
--     boolean as S(30), and a cohort whose only events are relists prints
--     taken_down_30 = 0.0000 as a measured figure.
--   * events_30, fills_30 and relists_30 stored on the row, so the gate can be
--     checked rather than trusted. 20260925164510 re-issues get_layoff_partition
--     to publish them and the two new bars.
--
-- Every other term, every other column and every other line is the text
-- 20260918100700 shipped. MIGRATIONS ARE IMMUTABLE, so that file is untouched
-- and this one re-issues the function. One function per file, for the
-- OUT-parameter guard's sake; the table DDL below is an ALTER on the table this
-- function writes and carries no second function with it.
--
-- THE ARM VALUES ARE NOT A CATEGORY LIST. insufficient_reason has a CHECK
-- constraint naming the reasons the table accepts, and four new ones cannot be
-- written under the old constraint -- the INSERT would fail and the refresh
-- would report an error rather than an insufficiency. The constraint is
-- replaced, not dropped.

SET LOCAL statement_timeout = '10min';

-- ── the partition table gains the counts the new gate reads ──────────────
--
-- 20260918100000 owns this table. Three columns and one constraint are added
-- here because this function writes them; nothing else about the table moves,
-- and every statement is idempotent so a database built from any subset of the
-- migration set still satisfies the CREATE-time validation of the body below.
ALTER TABLE public.job_board_layoff_partition
  ADD COLUMN IF NOT EXISTS events_30   int,
  ADD COLUMN IF NOT EXISTS fills_30    int,
  ADD COLUMN IF NOT EXISTS relists_30  int;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.job_board_layoff_partition'::regclass
       AND conname = 'job_board_layoff_partition_insufficient_reason_check'
  ) THEN
    ALTER TABLE public.job_board_layoff_partition
      DROP CONSTRAINT job_board_layoff_partition_insufficient_reason_check;
  END IF;
  ALTER TABLE public.job_board_layoff_partition
    ADD CONSTRAINT job_board_layoff_partition_insufficient_reason_check
    CHECK (insufficient_reason IS NULL OR insufficient_reason IN
      ('n', 'ungated', 'events', 'fills', 'relists', 'width', 'precision', 'arithmetic', 'employers', 'share'));
END $$;

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
           5                  AS min_events_30,
           5                  AS min_fills_30,
           0.15::numeric      AS max_half_width_30,
           0.50::numeric      AS max_rel_half_width_30,
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
  -- THE POSITIVE CONTROL, AT BOARD GRAIN, BEFORE EITHER ARM IS POOLED. The
  -- events of a board's own day-30 cohort WITHIN THE ARM it falls in: fills and
  -- relists, the two that move S, at days at or before the cap. Both counters
  -- are already zero on a suspect or feed-dark batch, so a collection failure
  -- cannot buy a board its way in, and our own sweep's takedowns at the cap are
  -- not here -- they are the age-out arm, our action rather than the employer's.
  --
  -- THE GROUPING CARRIES THE ARM for the reason the field curve's carries the
  -- category (20260925163842): a control counted per board and applied per
  -- board-and-arm would admit a board into an arm on events it produced in the
  -- other one. A board can contribute to both arms here -- whether a role is
  -- `filed` or `control` depends on whether a qualifying filing preceded THAT
  -- role's posting date -- so the two are genuinely different populations of
  -- the same board's postings, and the control has to be counted in each.
  board30 AS (
    SELECT
      r.tok,
      r.cat,
      sum(r.is_fill + r.is_relist)::int AS events30
    FROM raw r
    WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0 AND r.tt <= 30
    GROUP BY r.tok, r.cat
  ),
  -- THE DAY-30 RISK SET, GATED BY EQUALITY ON BOTH TESTS AT ONCE, exactly as
  -- the field curve gates its own: a posting is admitted when its board sits in
  -- an observability bucket that can prove an absence AND that board's own
  -- cohort proved it by producing events in this arm. Every day-30 consumer
  -- below -- the estimator chain, the coverage share, and the employer floor
  -- and concentration cap -- reads THIS, so all four describe one admission.
  -- Before this gate existed, the field table on that same page was computed
  -- over boards that had shown us events and the layoff sentence beneath it
  -- over boards that had not: two day-30 shares on one page over different
  -- populations, which is the error feedback_measure_like_with_like exists to
  -- stop.
  gated AS (
    SELECT
      r.cat, r.tok, r.tt, r.dated, r.in_cohort30, r.is_fill, r.is_relist, r.is_ageout,
      (r.admitted AND COALESCE(b.events30, 0) >= (SELECT kk.min_events_30 FROM k kk)) AS admitted
    FROM raw r
    LEFT JOIN board30 b ON b.tok = r.tok AND b.cat = r.cat
    WHERE r.in_cohort30
  ),
  agg30 AS (
    SELECT
      r.cat,
      r.tt,
      sum(r.is_fill)::int   AS d_fill,
      sum(r.is_relist)::int AS d_relist,
      sum(r.is_ageout)::int AS d_ageout,
      count(*)::int         AS cnt
    FROM gated r
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
      COALESCE(sum(c.d_fill)   FILTER (WHERE c.tt <= 30), 0)::int AS fills30,
      COALESCE(sum(c.d_relist) FILTER (WHERE c.tt <= 30), 0)::int AS relists30,
      COALESCE(sum(c.d_fill + c.d_relist) FILTER (WHERE c.tt <= 30), 0)::int AS events30,
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
    FROM gated r
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
      FROM gated r
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
      -- COALESCED TO ZERO ON PURPOSE. A written row must always carry a
      -- number here: zero means the arm's admitted cohort produced no events,
      -- which is a finding, and NULL must be reserved for the one thing the
      -- reader cannot otherwise detect -- a row written before this column
      -- existed, by the gate this file replaces. Leaving the LEFT JOIN's NULL
      -- through would make those two states one value and the reader would
      -- report the wrong one, which is the defect this whole change exists to
      -- stop, pointed at our own new column.
      COALESCE(e30.events30, 0)  AS events_30,
      COALESCE(e30.fills30, 0)   AS fills_30,
      COALESCE(e30.relists30, 0) AS relists_30,
      em.employers_n,
      round(em.top_share, 4)   AS max_employer_share,
      round(g30.admitted_dated_n::numeric / NULLIF(g30.dated_n30, 0), 4) AS gate_share_30,
      round(e30.r30 + e30.x30 + e30.s30, 6) AS sum_check_30,
      (SELECT h.from_d FROM cohort30 h) AS cohort_from,
      (SELECT h.to_d   FROM cohort30 h) AS cohort_to,
      COALESCE(e30.cat IS NOT NULL
         AND COALESCE(e30.n30, 0) >= (SELECT kk.min_n_at_risk_30 FROM k kk)
         AND COALESCE(e30.events30, 0) >= (SELECT kk.min_events_30 FROM k kk)
         AND COALESCE(e30.fills30, 0) >= (SELECT kk.min_fills_30 FROM k kk)
         AND COALESCE(e30.relists30, 0) <= COALESCE(e30.fills30, 0)
         AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_half_width_30 FROM k kk)
         AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_rel_half_width_30 FROM k kk) * (1 - e30.s30)
         AND abs(e30.r30 + e30.x30 + e30.s30 - 1) <= 0.000001
         AND (a.arm = 'control'
              OR (COALESCE(em.employers_n, 0) >= (SELECT kk.min_arm_employers FROM k kk)
                  AND COALESCE(em.top_share, 1) <= (SELECT kk.max_employer_share FROM k kk))), false) AS sufficient_30,
      CASE
        -- WHICH ABSENCE IT IS. An arm with no estimator row has two causes and
        -- they are different sentences: nothing dated reached the cap in this
        -- arm at all, or things did and the two admission tests removed all of
        -- them. gate_share_30's denominator separates them, and reporting the
        -- first for both would tell a reader the arm was too small when it was
        -- in fact emptied by a gate.
        WHEN e30.cat IS NULL AND COALESCE(g30.dated_n30, 0) > 0 THEN 'ungated'
        WHEN e30.cat IS NULL OR COALESCE(e30.n30, 0) < (SELECT kk.min_n_at_risk_30 FROM k kk) THEN 'n'
        WHEN COALESCE(e30.events30, 0) < (SELECT kk.min_events_30 FROM k kk) THEN 'events'
        WHEN COALESCE(e30.fills30, 0) < (SELECT kk.min_fills_30 FROM k kk) THEN 'fills'
        WHEN COALESCE(e30.relists30, 0) > COALESCE(e30.fills30, 0) THEN 'relists'
        WHEN (e30.s30_hi - e30.s30_lo) / 2 > (SELECT kk.max_half_width_30 FROM k kk) THEN 'width'
        WHEN (e30.s30_hi - e30.s30_lo) / 2 > (SELECT kk.max_rel_half_width_30 FROM k kk) * (1 - e30.s30) THEN 'precision'
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
    n_at_risk_30, events_30, fills_30, relists_30,
    employers_n, max_employer_share, gate_share_30, sum_check_30, cohort_from, cohort_to,
    sufficient_30, insufficient_reason, newest_filing_event_date, warn_lag_p50_days, warn_lag_n,
    computed_at, filings_read_at
  )
  SELECT
    fn.arm, fn.taken_down_30, fn.still_open_30, fn.still_open_30_lo, fn.still_open_30_hi, fn.half_width_30, fn.relist_rate_30,
    fn.n_at_risk_30, fn.events_30, fn.fills_30, fn.relists_30,
    fn.employers_n, fn.max_employer_share, fn.gate_share_30, fn.sum_check_30, fn.cohort_from, fn.cohort_to,
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
    events_30                = EXCLUDED.events_30,
    fills_30                 = EXCLUDED.fills_30,
    relists_30               = EXCLUDED.relists_30,
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
  'Writes the two rows of job_board_layoff_partition: the day-30 share (S(30), '
  'R(30), X(30)) of dated roles, partitioned by whether the employer had a '
  'qualifying layoff filing in the lookback before the role was posted (arm '
  'filed) or not (arm control). NEVER A RATIO OF THE TWO ARMS: the section '
  'prints two sentences side by side, or one reason per arm, and the page may '
  'not divide one by the other. '
  'POSITIVE CONTROL (20260925164237): the day-30 risk set admits a posting only '
  'when its board sits in an observability bucket that can prove an absence AND '
  'that board''s own day-30 cohort produced at least five events -- fills plus '
  'relists, the two that move S -- INSIDE THE SAME ARM. The count is taken per '
  '(board, arm) and joined on both keys, because a board contributes to both '
  'arms (an arm is decided per POSTING, by whether a filing preceded that '
  'posting''s own date) and a control counted per board alone would admit a '
  'board into one arm on events it produced in the other. sufficient_30 then '
  'requires seven terms, the same seven get_company_fill_curve and '
  'get_category_fill_curve apply: the risk-set floor, the events floor, a floor '
  'on FILLS alone, relists not outnumbering fills, the absolute half-width '
  'ceiling, a ceiling on the half-width relative to the complement '
  '(1 - still_open_30) the sentence asserts, and the identity -- plus, on the '
  'filed arm only, the employer floor and the largest-employer share cap. '
  'insufficient_reason names the FIRST term that failed, in the order they are '
  'checked -- including ungated, when the arm had dated roles reach the cap and '
  'the two admission tests removed all of them, which the old CASE reported as '
  'n (too few roles) about an arm a gate had emptied. events_30, fills_30 and '
  'relists_30 are COALESCED TO ZERO on every written row, so NULL there means '
  'one thing only: a row written before this control existed. events_30, fills_30 and relists_30 are stored so the gate can be '
  'checked rather than trusted. WHY EACH ADDED TERM: without the events floor '
  'the test was four terms that all pass VACUOUSLY on a cohort with no events '
  '(no events means no Greenwood variance, so the half-width is exactly zero, '
  'and S is exactly one so the identity is 0 + 0 + 1). Without the relative '
  'ceiling it passed one batch above that -- a 20,000-observation cohort with '
  'five events publishes 0.9998 with a half-width of 0.00025. Without the fill '
  'terms a cohort whose only events are relists publishes taken_down_30 = '
  '0.0000 as a measured figure. MEASURED: at 2026-09-25T21:47Z this arm pair '
  'published control S(30) = 0.5466 over 387,957 observations on 30,867 boards '
  'with sufficient_30 true, while 10.59% of the day-30 risk mass sat on boards '
  'whose cohort produced zero events and a further 5.00% on boards with one to '
  'four (full catalogue walk, 2026-09-25T21:40:43Z to 21:44:27Z, all 44,379 '
  'tokens). Bounding it at 1/(1 - z) on ln S, the control arm could move to '
  '0.4921 -- more than the gap between the two arms. THIS GATE IS NOT '
  'INHERITED, IT IS DUPLICATED: the thresholds are spelled here and a guard '
  'compares them against the field curve''s, because the previous comment '
  'claimed inheritance and the two had silently diverged by a whole term. '
  'A closure never means hired; a role still advertised at day 30 is not proof '
  'of anything about the employer beyond the fact stated.';

-- The definer set is stated, not inherited: CREATE OR REPLACE keeps the old
-- grants, but a re-issue may not depend on that.
REVOKE ALL ON FUNCTION public.refresh_layoff_partition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_layoff_partition() TO service_role;

-- Self-verifying: one definition, and it must carry all three new terms. A
-- migration whose purpose is a gate change must not be able to report success
-- with the old gate still standing.
DO $$
DECLARE n int; body text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'refresh_layoff_partition';
  IF n <> 1 THEN
    RAISE EXCEPTION 'refresh_layoff_partition: expected exactly one definition, found %', n;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO body
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'refresh_layoff_partition';
  IF body NOT LIKE '%min_events_30%' OR body NOT LIKE '%min_fills_30%'
     OR body NOT LIKE '%max_rel_half_width_30%' THEN
    RAISE EXCEPTION 'refresh_layoff_partition: re-issued with the day-30 gate still made of width alone';
  END IF;
  -- The control must be counted at the grain the figure is pooled at, or a
  -- board is admitted into one arm on the other arm's events.
  IF body NOT LIKE '%GROUP BY r.tok, r.cat%' THEN
    RAISE EXCEPTION 'refresh_layoff_partition: the per-board event count is not taken per arm';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
