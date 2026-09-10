-- A FIELD IS ONLY AS OPEN AS THE BOARDS WE CAN READ.
--
-- The field-grain half of 20260909217000, which explains the measurement in
-- full: S(30), the share of a DATED cohort still advertised when it reached
-- our 30-day cap, from the Aalen-Johansen estimator 20260909200000 already
-- runs, with R(30) taken down for good and X(30) re-listed, R + X + S = 1
-- CHECKED as sum_check_30 rather than asserted. Every existing column of
-- get_category_fill_curve is byte-identical; the day-30 columns are appended.
--
-- THE FIELD-GRAIN PROBLEM IS POOLING. Per employer, an unobservable board can
-- simply be handed a NULL. Pooled into a field it cannot: a board over the
-- page cap with no proven lap has S(30) = 1 by construction (its takedowns are
-- invisible, so every posting ages out), and it drags the field's S(30) toward
-- 1 in proportion to its size -- and the biggest boards are exactly the
-- windowed ones (270 boards at 500+ roles, 36.4% of inventory, per
-- 20260909200000's own header). Measured live on 2026-09-10 from
-- get_closure_population(): boards_full_read 43381 holding 564792 postings,
-- boards_lap_proven 125 holding 61758, boards_lap_pending 378 holding 177013,
-- boards_unprovable 117 holding 126829, boards_unobserved 304. So the day-30
-- risk set here admits ONLY postings on boards whose bucket in
-- job_board_board_observability is full_read or lap_proven, and gate_share_30
-- publishes what share of the field's dated day-30 cohort that was. A field
-- whose big boards are all windowed is being measured on its small ones, and
-- the reader is told so in the same row.
--
-- THE COHORT FLOOR IS THE SAME ONE. job_board_exits.posted_at is stamped only
-- from 2026-09-06 (EXITS_ORIGIN_STAMPED_FROM, a named constant), so the
-- censored arm exists only for cohorts posted on or after 2026-08-07, and the
-- day-30 cohort is floored at GREATEST(the first whole day after the event
-- window opened, that - 30 days) and
-- capped at thirty days ago so every member had the full thirty days to be
-- watched. Both ends are returned as cohort_from / cohort_to. The floor
-- retires itself when the 90-day window passes it.
--
-- WHAT IS PUBLISHED. gate_share_30, still_open_30 with a complementary-log-log
-- interval (still_open_30_lo/hi, in this file's own form), taken_down_30 (a
-- CEILING, for the relist-dedupe reason fill_rate_14 is one), relist_rate_30
-- (the matching FLOOR), n_at_risk_30, ageouts_at_30 (OUR sweep's takedowns at
-- the cap -- our action, never an employer event), sum_check_30, cohort_from,
-- cohort_to and sufficient_30 (n_at_risk_30 >= 25 and half-width <= 0.15 as
-- named constants, identity within 1e-6). All of them are NULL -- not 1.0 --
-- when the gate admitted nothing.
--
-- Live on 2026-09-10, get_category_fill_curve(90, 300) returned 18 rows, all
-- `sufficient`, window_days 58, still_open_14 from 0.7107 (admin) to 0.8031
-- (hospitality_retail), dated_coverage 0.6996 to 0.8420. Those columns do not
-- move here. Nothing extrapolates past the cap (docs/hiring-health-model.md
-- section 10); a closure never means hired; a long-open posting is not proof
-- of anything about the employer beyond the fact stated.
--
-- ONE FUNCTION PER FILE, for the OUT-parameter guard's sake; the table this
-- reads was created in 20260909217000 and is owned by 20260909217800.

SET LOCAL statement_timeout = '5min';

-- THE SHAPE CHANGES, SO THE FUNCTION IS DROPPED FROM THE CATALOGUE FIRST.
-- CREATE OR REPLACE cannot change a RETURNS TABLE; the live database has held
-- overloads no migration file describes, so the drop enumerates pg_proc by
-- name rather than trusting a hand-listed signature. Grants are discarded by
-- the drop and re-issued at the foot of this file.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'get_category_fill_curve'
  LOOP
    RAISE NOTICE 'dropping % ahead of its re-issue with the day-30 columns', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_category_fill_curve(
  p_days  int DEFAULT 90,
  p_min_n int DEFAULT 300
)
RETURNS TABLE (
  category            text,
  n_at_risk_14        int,
  fills_le_14         int,
  fill_rate_14        numeric,
  fill_rate_14_lo     numeric,
  fill_rate_14_hi     numeric,
  relist_rate_14      numeric,
  still_open_14       numeric,
  median_days_to_fill numeric,
  median_censored     boolean,
  dated_coverage      numeric,
  window_days         int,
  sufficient          boolean,
  gate_share_30       numeric,
  still_open_30       numeric,
  still_open_30_lo    numeric,
  still_open_30_hi    numeric,
  taken_down_30       numeric,
  relist_rate_30      numeric,
  n_at_risk_30        int,
  ageouts_at_30       int,
  sum_check_30        numeric,
  cohort_from         date,
  cohort_to           date,
  sufficient_30       boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH win AS (
    -- Capped at 90 days because the exit ledger is pruned at 90; asking for
    -- more would silently thin the censored arm at the far edge and read as a
    -- market that stopped ageing roles out.
    SELECT LEAST(GREATEST(p_days, 7), 90) AS d
  ),
  -- ── day-30 constants, named once ─────────────────────────────────────────
  -- EXITS_ORIGIN_STAMPED_FROM: job_board_exits.posted_at is stamped only from
  -- this date (20260906090000) and the rows before it were hard-deleted, so no
  -- age-out logged earlier carries an origin. A posting that reached the cap
  -- before this date is therefore ABSENT from the censored arm, not censored
  -- in it, and any day-30 cohort that reaches back past (this date - 30) is
  -- missing exactly the observations that did not close. The floor below is
  -- GREATEST(the day after the event window opened, that - 30d): it binds
  -- today and stops binding by itself on the day the window edge passes it,
  -- with no edit.
  -- MIN_N_AT_RISK_30 and MAX_HALF_WIDTH_30 are the day-30 sufficiency gate,
  -- the model's own thresholds at the new horizon (the fills>=5 clause is a
  -- fill-rate condition and S(30) is not a fill rate).
  k AS (
    SELECT DATE '2026-09-06'  AS exits_origin_stamped_from,
           25                 AS min_n_at_risk_30,
           0.15::numeric      AS max_half_width_30
  ),
  -- THE DAY-30 COHORT IS THE SET THAT HAD THIRTY DAYS TO BE WATCHED: stated
  -- posted_at inside [cohort_from, cohort_to] where cohort_to is thirty days
  -- ago. A posting younger than that cannot have reached the cap and would
  -- enter only as an early right-censoring; leaving it out makes S(30) read
  -- as the plain sentence it is rendered as -- the share of THESE roles still
  -- advertised when they reached day 30 -- rather than a projection over a
  -- cohort half of which is still in flight. The day-14 curve keeps its own
  -- 90-day convention untouched.
  --
  -- AND THE COHORT LIVES INSIDE THE EVENT WINDOW. The closure and exit arms
  -- below are cut on closed_at / exited_at >= now() - window_days (p_days,
  -- capped at 90), while the live arm has no window and an age-out lands at
  -- day 30. A cohort that reached back past that edge would therefore keep
  -- its survivors and lose its early takedowns: R(30) undercounted, S(30)
  -- high, with sufficient_30 still true and cohort_from still printed. So
  -- from_d is the first whole day AFTER the window opened -- strictly later
  -- than the timestamp edge, which puts every event of every member inside
  -- it -- floored at the stamping origin. At p_days = 30 the cohort is empty
  -- by construction (a thirty-day window cannot hold a thirty-day cohort) and
  -- every day-30 column is NULL; at 60 and 90 it is the same cohort today.
  cohort30 AS (
    SELECT GREATEST((now() - make_interval(days => (SELECT w.d FROM win w)))::date + 1,
                    (SELECT kk.exits_origin_stamped_from FROM k kk) - 30) AS from_d,
           current_date - 30                                              AS to_d
  ),
  -- THE OBSERVABILITY GATE, AT FIELD GRAIN. A windowed board with no proven
  -- lap has S(30) = 1 BY CONSTRUCTION -- we cannot see its takedowns, so every
  -- posting "ages out" -- and pooled into a field it drags the field's S(30)
  -- toward 1 in proportion to its size, which is largest for exactly the
  -- boards that are windowed. job_board_board_observability is the bucket
  -- refresh_closure_population() already computes, materialised per board;
  -- only full_read and lap_proven can prove an absence, so the day-30 risk set
  -- below admits only postings on those boards and gate_share_30 publishes how
  -- much of the field's dated cohort that was. A board with no row is NOT
  -- admitted, which is the safe direction.
  obs AS (
    SELECT o.company_token AS tok,
           (o.bucket IN ('full_read', 'lap_proven')) AS admitted
    FROM public.job_board_board_observability o
  ),
  -- Served open roles per company. Both serving predicates, so the fallback
  -- denominator of the feed-dark ratio is the same board a reader would see.
  open_now AS (
    SELECT p.company_token AS tok, count(*)::int AS n
    FROM public.job_board_postings p
    WHERE p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token
  ),
  -- Unstamped batches, sized once. The collector writes one closed_at per board
  -- pass, so (company_token, closed_at) is the batch itself rather than a proxy
  -- for one; hour bucketing would merge the several passes the hot lane makes
  -- in an hour and let a run of small legitimate takedowns add up past the
  -- threshold.
  batches AS (
    SELECT
      c.company_token AS tok,
      c.closed_at     AS at,
      date_trunc('day', c.closed_at)::date AS on_day,
      count(*)::int   AS n_removed
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => (SELECT d FROM win))
      AND c.batch_live_before IS NULL
      -- A lap_backfill row cannot size a batch either: it lands with hundreds
      -- of its siblings on one closed_at by construction, which is the exact
      -- shape the feed-dark proxy is built to condemn. Left in, the backlog of
      -- a board's first lap would flag its own arrival as a collection failure
      -- and censor the REAL closures that shared that timestamp.
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token, c.closed_at, date_trunc('day', c.closed_at)::date
  ),
  -- Retroactive feed-dark proxy, per company, applied ONLY to unstamped
  -- history, with the ERA-APPROPRIATE denominator: the newest company snapshot
  -- at or before the batch's day, which is a primary-key seek per batch. Scoring
  -- a 40-day-old batch against today's served count deleted exactly the
  -- employer that filled a hiring class and then shrank. Where no snapshot
  -- survives -- they are pruned at 35 days and the unstamped era is about 54 --
  -- the fallback is today's count with the absolute floor RAISED to 25, because
  -- in that region a wind-down and a dark feed cannot be told apart and
  -- over-deletion removes the employers with the most fills first.
  -- Era board size as a scalar subquery rather than a lateral join: a
  -- primary-key seek per BATCH into a 35-day table. The spelling matters
  -- because the guard on get_actively_hiring_companies forbids the word
  -- that keyword outright -- a per-company lateral counting open roles is what
  -- forced that leaderboard to pre-truncate -- and the guard should keep its
  -- teeth while the query changes its spelling, the same way the COALESCE guard
  -- was handled in 20260906093000.
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
  -- THE TWO LEDGERS SHARE A BATCH KEY EXACTLY (20260909217000 censors the
  -- company curve's age-out arm on this same set): one board pass computes a
  -- single closedAt and writes it as job_board_closures.closed_at on the
  -- takedowns AND as job_board_exits.exited_at on the age-outs of the same
  -- vanished set, so (company_token, exited_at) IS the closure batch key. The
  -- field curve's age-out arm was censored on the retroactive `dark` verdict
  -- alone, so an age-out in a batch the collector itself stamped `suspect`
  -- counted in ageouts_at_30 at field grain and not at employer grain -- one
  -- event, two verdicts. Both grains now censor on suspect UNION dark. What
  -- this cannot see is the same as there: a pass in which every vanished
  -- posting aged out writes no closure row and is not censorable from here.
  bad_batch AS (
    SELECT DISTINCT c.company_token AS tok, c.closed_at AS at
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => (SELECT w.d FROM win w))
      AND COALESCE(c.suspect, false)
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    UNION
    SELECT d.tok, d.at FROM dark d
  ),
  -- THE COHORT IS SELECTED ON ORIGIN, NOT ON EXIT TIME. See the same CTE in
  -- 20260906091000 for the measurement: gathering events over a window of exit
  -- times while taking the live censored arm from a single instant of the board
  -- matches W days of events against one day of still-open observations, and
  -- the resulting R(14) moves with W -- 0.4390 / 0.4138 / 0.3529 at 90 / 60 / 30
  -- on data whose true value was 0.5000. That is fatal for a p_days the caller
  -- can set: two callers passing different windows would get contradictory
  -- probabilities for the same market. in_cohort admits an observation only when
  -- the employer stated a post date AND that date falls inside the window, on
  -- all three arms alike, which makes the answer window-invariant.
  --
  -- A BAD BATCH IS CENSORED, NOT DELETED: a suspect stamp and the retroactive
  -- proxy both identify OUR collection failing, so the postings almost certainly
  -- did not come down. They stay in the risk set as censored observations and
  -- count as neither fill nor relist.
  --
  -- A lap_backfill CLOSURE IS DELETED, NOT CENSORED, AND THAT IS NOT THE SAME
  -- CHOICE AS THE ONE ABOVE -- it is the opposite one, taken because the data to
  -- censor honestly is not in this schema.
  --
  -- The subject vanishes from all three arms: the event arm excludes it by the
  -- predicate below; the still-open arm cannot hold it (its missing_since is
  -- set); the exit arm excludes exit_reason='removed' to avoid double-counting
  -- the closure. So a posting that demonstrably came down contributes neither
  -- exposure nor an event.
  --
  -- THE DIRECTION OF THE RESULTING BIAS IS KNOWN AND IT IS NOT ZERO. The
  -- deletion is not independent of the outcome: on a backfilled board it
  -- removes exactly the postings that CLOSED, while the postings still open on
  -- that same board stay in the live arm with their full exposure. Events fall,
  -- exposure does not, so R(14) and the fill median are biased DOWNWARD for any
  -- category whose backfill is concentrated in a few large boards.
  --
  -- CENSORING IT PROPERLY WOULD NEED A LAST-KNOWN-OPEN INSTANT, and
  -- job_board_closures does not carry one. It stores first_seen, posted_at and
  -- closed_at; the collector knows missing_since at write time and does not
  -- persist it. Censoring at closed_at would be censoring at a date the column's
  -- own COMMENT calls inadmissible, and censoring at any other stored column
  -- would be inventing the observation -- which is the failure every other rule
  -- in this file exists to prevent. Deleting the subject is the smaller error of
  -- the two available, and it is stated rather than absorbed.
  --
  -- WHAT MAKES THE GAP VISIBLE: get_closure_population().closures_lap_backfill
  -- counts these rows. dated_coverage (the `cov` CTE, also over `raw`) CANNOT
  -- see it -- it reports coverage of the population that survived this
  -- predicate, so it reads full while the subjects are already gone. Any
  -- renderer's 0.60/0.30 coverage bands are therefore blind to this
  -- specifically, and a caveat for it must come from the disclosure function,
  -- not from cov. Nothing is wrong TODAY: deepCursor.laps is 0, so no
  -- lap_backfill row exists yet. This comment is for the first proven lap.
  raw AS (
    SELECT
      c.category AS cat,
      CASE WHEN c.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (c.posted_at IS NOT NULL
        AND c.posted_at >= now() - make_interval(days => (SELECT d FROM win))) AS in_cohort,
      (c.posted_at IS NOT NULL
        AND c.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND c.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
      0 AS is_ageout,
      COALESCE(ob.admitted, false) AS admitted,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL OR c.superseded THEN 0 ELSE 1 END AS is_fill,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL THEN 0
           WHEN c.superseded THEN 1 ELSE 0 END AS is_relist,
      true AS in_cov,
      (c.posted_at IS NOT NULL) AS dated
    FROM public.job_board_closures c
    -- `dark` is one row per (tok, closed_at) by construction, so this cannot
    -- multiply rows; dk.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    LEFT JOIN obs ob ON ob.tok = c.company_token
    WHERE c.closed_at >= now() - make_interval(days => (SELECT d FROM win))
      AND c.category <> ''
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'

    UNION ALL

    -- Censored: still advertised at our cap, or a board we stopped fetching.
    -- 'removed' mirrors every closure row and would double-count each fill;
    -- 'backdated' postings are left-truncated and would inflate the risk set
    -- with observations that cannot produce an event inside the horizon.
    SELECT
      e.category AS cat,
      CASE WHEN e.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (e.exited_at - e.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (e.posted_at IS NOT NULL
        AND e.posted_at >= now() - make_interval(days => (SELECT d FROM win))) AS in_cohort,
      (e.posted_at IS NOT NULL
        AND e.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND e.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
      -- CENSORED ON THE SAME BATCH VERDICT AS THE COMPANY CURVE'S AGE-OUT ARM
      -- (suspect UNION dark, bad_batch above); it is a COUNT here, never an
      -- event in the product.
      CASE WHEN bb.tok IS NOT NULL THEN 0
           WHEN e.exit_reason = 'aged_out' THEN 1 ELSE 0 END AS is_ageout,
      COALESCE(ob.admitted, false) AS admitted,
      0 AS is_fill,
      0 AS is_relist,
      true AS in_cov,
      (e.posted_at IS NOT NULL) AS dated
    FROM public.job_board_exits e
    -- bad_batch is DISTINCT on (tok, at) by construction, so this cannot
    -- multiply rows; bb.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at
    LEFT JOIN obs ob ON ob.tok = e.company_token
    WHERE e.exited_at >= now() - make_interval(days => (SELECT d FROM win))
      AND e.category <> ''
      AND e.exit_reason IN ('aged_out', 'board_dormant', 'untracked')

    UNION ALL

    -- Censored: still live. These are the observations whose ABSENCE turned
    -- censoring into truncation and produced the flat fifteen.
    SELECT
      p.category AS cat,
      CASE WHEN p.posted_at IS NOT NULL
           THEN LEAST(floor(extract(epoch FROM (now() - p.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (p.posted_at IS NOT NULL
        AND p.posted_at >= now() - make_interval(days => (SELECT d FROM win))) AS in_cohort,
      (p.posted_at IS NOT NULL
        AND p.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND p.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
      0 AS is_ageout,
      COALESCE(ob.admitted, false) AS admitted,
      0 AS is_fill,
      0 AS is_relist,
      true AS in_cov,
      (p.posted_at IS NOT NULL) AS dated
    FROM public.job_board_postings p
    LEFT JOIN obs ob ON ob.tok = p.company_token
    WHERE p.missing_since IS NULL
      AND p.category <> ''
  ),
  -- Coverage over the WHOLE risk-set population, exit-ledger rows included.
  -- job_board_exits.posted_at is stamped only from 2026-09-06 and cannot be
  -- backfilled (the postings were hard-deleted), so for the next ~90 days the
  -- entire age-out arm has no origin and falls out of the cohort. Excluding
  -- those rows from the ratio -- which an earlier draft did, reasoning that our
  -- schema gap should not read as an employer failing to publish dates -- made
  -- dated_coverage report 1.0000 while the roles that demonstrably did not fill
  -- were missing from the risk set, so the renderer showed an inflated rate
  -- plain. The column exists so the RENDERER acts. It now measures the share of
  -- the risk set carrying a usable origin, which is what the caller's
  -- 0.60/0.30 bands are actually about.
  cov AS (
    SELECT
      r.cat,
      count(*) FILTER (WHERE r.in_cov AND r.dated)::int     AS d_n,
      count(*) FILTER (WHERE r.in_cov AND NOT r.dated)::int AS u_n
    FROM raw r
    GROUP BY r.cat
  ),
  agg AS (
    SELECT
      r.cat, r.tt,
      sum(r.is_fill)::int   AS d_fill,
      sum(r.is_relist)::int AS d_relist,
      count(*)::int         AS cnt
    FROM raw r
    WHERE r.in_cohort AND r.tt IS NOT NULL AND r.tt >= 0
    GROUP BY r.cat, r.tt
  ),
  -- n_j = observations with t >= t_j; censored-at-t_j count as at risk.
  curve AS (
    SELECT
      a.cat, a.tt, a.d_fill, a.d_relist, a.cnt,
      (a.d_fill + a.d_relist) AS d,
      (sum(a.cnt) OVER (
        PARTITION BY a.cat ORDER BY a.tt DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ))::int AS n
    FROM agg a
  ),
  -- THE GREATEST CLAMP IS LOAD-BEARING. When d_j = n_j the factor is zero,
  -- ln(0) is -Infinity, and the entire category's row returns NULL -- silently,
  -- as an absence rather than an error. Clamping the factor at 1e-12 keeps S
  -- finite and negligible; the only cost is that R + X + S is off by
  -- S_prev * 1e-12 in that degenerate case. Greenwood's summand is NULL there
  -- (it divides by n_j - d_j) and sum() skips NULLs, so the variance is
  -- understated in exactly the case where S is already ~0.
  surv AS (
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
    FROM curve c
  ),
  lagged AS (
    SELECT s.*, lag(s.s, 1, 1.0) OVER (PARTITION BY s.cat ORDER BY s.tt) AS s_prev
    FROM surv s
  ),
  cum AS (
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
    FROM lagged l
  ),
  -- R and X are non-decreasing and S is non-increasing, so max/min over
  -- t <= 14 all read the same row: the last observation day at or before 14.
  -- The three published values are therefore mutually consistent and their
  -- identity survives the aggregation.
  --
  -- THE MEDIAN IS min{t <= 30 : R(t) >= 0.5}, the median of the FILL cumulative
  -- incidence, not of all-cause survival. The frozen contract specified the
  -- survival form; it is wrong, because S falls on relists as well as fills and
  -- so a relist-heavy category would publish a short "fill median" beside a low
  -- fill rate -- the manufactured median this function exists to delete, rebuilt
  -- one layer up. Under the CIF form the median is NULL far more often. That is
  -- the honest outcome and is exactly what median_censored is for.
  at_h AS (
    SELECT
      c.cat,
      COALESCE(max(c.r_cif) FILTER (WHERE c.tt <= 14), 0) AS r14,
      COALESCE(max(c.x_cif) FILTER (WHERE c.tt <= 14), 0) AS x14,
      COALESCE(min(c.s)     FILTER (WHERE c.tt <= 14), 1) AS s14,
      COALESCE(max(c.gw)    FILTER (WHERE c.tt <= 14), 0) AS gw14,
      COALESCE(sum(c.d_fill)   FILTER (WHERE c.tt <= 14), 0)::int AS fills14,
      COALESCE(sum(c.d_relist) FILTER (WHERE c.tt <= 14), 0)::int AS relists14,
      COALESCE(sum(c.cnt)      FILTER (WHERE c.tt >= 14), 0)::int AS n14,
      COALESCE(sum(c.cnt), 0)::int AS obs_n,
      min(c.tt) FILTER (WHERE c.tt <= 30 AND c.r_cif >= 0.5) AS med
    FROM cum c
    GROUP BY c.cat
  ),
  -- Greenwood on the complementary log-log scale. S^a is DECREASING in a for
  -- 0 < S < 1, so the +1.96 branch is the LOWER bound; the other spelling gives
  -- an inverted interval that still looks plausible. v and the exponent are
  -- clamped: past those bounds the interval is wider than the parameter's own
  -- range, `sufficient` has already failed, and an unclamped numeric power can
  -- overflow.
  band AS (
    SELECT
      a.*,
      CASE WHEN a.s14 >= 1 OR a.s14 <= 0 THEN 0::numeric
           ELSE LEAST(a.gw14 / (ln(a.s14) * ln(a.s14)), 4.0)
      END AS v
    FROM at_h a
  ),
  ci AS (
    SELECT
      b.*,
      CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ LEAST(exp(1.96 * sqrt(b.v)), 50.0) END AS s_lo,
      CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ GREATEST(exp(-1.96 * sqrt(b.v)), 0.02) END AS s_hi
    FROM band b
  ),
  -- Clamped to [0,1] HERE, not after a join: LEAST and GREATEST IGNORE NULL
  -- arguments, so LEAST(NULL, 1) is 1 and clamping downstream of an outer join
  -- would turn "no observations" into a confident interval of [1, 1].
  bounds AS (
    SELECT
      e.*,
      COALESCE(e.fills14::numeric / NULLIF(e.fills14 + e.relists14, 0), 0) AS fshare,
      GREATEST(LEAST(
        COALESCE(e.fills14::numeric / NULLIF(e.fills14 + e.relists14, 0), 0) * (1 - e.s_hi), 1), 0) AS r_lo,
      GREATEST(LEAST(
        COALESCE(e.fills14::numeric / NULLIF(e.fills14 + e.relists14, 0), 0) * (1 - e.s_lo), 1), 0) AS r_hi
    FROM ci e
  ),
  -- The window we actually have, not the window that was asked for: the log is
  -- about 54 days old, and reporting 90 would describe a history we do not hold.
  -- ── the day-30 chain ─────────────────────────────────────────────────────
  -- The same Aalen-Johansen estimator as above, run over the day-30 cohort
  -- alone. It is a second chain and not a second FILTER on the first because
  -- the risk set is different: the cohort floor and (at field grain) the
  -- observability gate both change n_j at every day, and a survival product
  -- cannot be re-cut after the fact. Every clause is spelled as the mirror
  -- guard expects -- the DESC risk set, the ln(0) clamp, the genuine lag, and
  -- +1.96 as the LOWER bound on S -- so the-estimator-that-must-agree-with-
  -- arithmetic keeps its teeth over this chain as well as the first.
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
  -- S, R and X at the cap all read the last observation day at or before 30
  -- (S non-increasing, R and X non-decreasing), so the three are one row's
  -- values and R + X + S = 1 is a property of that row -- CHECKED below as
  -- sum_check_30 and inside sufficient_30, not asserted. n30 is everything
  -- still at risk at day 30, the observations that reached the cap; the
  -- ageouts among them are the ones our own sweep took down.
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
      COALESCE(sum(c.d_ageout) FILTER (WHERE c.tt >= 30), 0)::int AS ageouts30
    FROM cum30 c
    GROUP BY c.cat
  ),
  -- Greenwood on the complementary log-log scale, in this file's own form:
  -- v clamped at 4, the exponent at [1/50, 50], +1.96 the LOWER bound.
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
  -- How much of the field's dated day-30 cohort the gate let through. It is
  -- published beside the figure because a field whose big boards are all
  -- windowed is measured on its small ones, and the reader must be told so.
  gate30 AS (
    SELECT
      r.cat,
      count(*) FILTER (WHERE r.in_cohort30 AND r.dated AND r.admitted)::int AS admitted_dated_n,
      count(*) FILTER (WHERE r.in_cohort30 AND r.dated)::int                AS dated_n30
    FROM raw r
    GROUP BY r.cat
  ),
  depth AS (
    SELECT LEAST(
      (SELECT d FROM win),
      GREATEST(1, ceil(extract(epoch FROM (now() - min(c.closed_at))) / 86400.0)::int)
    ) AS d
    FROM public.job_board_closures c
    WHERE c.absence_basis IS DISTINCT FROM 'lap_backfill'
  )
  SELECT
    b.cat                    AS category,
    b.n14                    AS n_at_risk_14,
    b.fills14                AS fills_le_14,
    round(b.r14, 4)          AS fill_rate_14,
    round(b.r_lo, 4)         AS fill_rate_14_lo,
    round(b.r_hi, 4)         AS fill_rate_14_hi,
    round(b.x14, 4)          AS relist_rate_14,
    round(b.s14, 4)          AS still_open_14,
    b.med::numeric           AS median_days_to_fill,
    (b.med IS NULL)          AS median_censored,
    round(cv.d_n::numeric / NULLIF(cv.d_n + cv.u_n, 0), 4) AS dated_coverage,
    (SELECT d FROM depth)    AS window_days,
    -- The contract's three conditions plus a fourth: observed relists at or
    -- before day 14 must not outnumber the fills there. The collector logs one
    -- superseded closure per title per 24h and DELETES the deduped postings, so
    -- those competing events are absent from the risk set rather than counted
    -- in it and fill_rate_14 is an UPPER BOUND wherever relisting happens. This
    -- is a partial guard, not a fix -- the mass we cannot see is exactly the
    -- mass concentrated in few titles, which is what the dedupe collapses.
    (b.n14 >= 25 AND b.fills14 >= 5 AND (b.r_hi - b.r_lo) / 2 <= 0.15
       AND b.relists14 <= b.fills14) AS sufficient,
    -- ── still advertised at day 30 ───────────────────────────────────────────
    -- Over admitted boards only (agg30), and NULL rather than 1.0 when the
    -- gate admitted nothing: the LEFT JOIN below is the NULL.
    round(g30.admitted_dated_n::numeric / NULLIF(g30.dated_n30, 0), 4) AS gate_share_30,
    round(e30.s30, 4)        AS still_open_30,
    round(e30.s30_lo, 4)     AS still_open_30_lo,
    round(e30.s30_hi, 4)     AS still_open_30_hi,
    round(e30.r30, 4)        AS taken_down_30,
    round(e30.x30, 4)        AS relist_rate_30,
    e30.n30                  AS n_at_risk_30,
    e30.ageouts30            AS ageouts_at_30,
    round(e30.r30 + e30.x30 + e30.s30, 6) AS sum_check_30,
    (SELECT h.from_d FROM cohort30 h) AS cohort_from,
    (SELECT h.to_d   FROM cohort30 h) AS cohort_to,
    COALESCE(e30.cat IS NOT NULL
       AND COALESCE(e30.n30, 0) >= (SELECT kk.min_n_at_risk_30 FROM k kk)
       AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_half_width_30 FROM k kk)
       AND abs(e30.r30 + e30.x30 + e30.s30 - 1) <= 0.000001, false) AS sufficient_30
  FROM bounds b
  JOIN cov cv ON cv.cat = b.cat
  LEFT JOIN bounds30 e30 ON e30.cat = b.cat
  LEFT JOIN gate30   g30 ON g30.cat = b.cat
  WHERE b.obs_n >= GREATEST(p_min_n, 25)
  ORDER BY b.r14 DESC, b.cat ASC;
$$;
COMMENT ON FUNCTION public.get_category_fill_curve(int, int) IS
  'Per-category Aalen-Johansen cumulative incidence of FILL, with RELIST as a '
  'competing event and age-outs plus still-live roles as right-censored '
  'observations. It replaces a median that could not exist: the function it '
  'supersedes reported 14.9 to 16.3 days across all eighteen categories because '
  'its observable support was one week to one month by construction, so it was '
  'publishing the midpoint of our own retention cap. COHORT: all three arms are '
  'restricted to postings whose stated posted_at falls inside the window, so the '
  'answer does not move with p_days -- selecting events on their exit time while '
  'taking live roles from one instant of the board returned 0.4390 / 0.4138 / '
  '0.3529 at p_days 90 / 60 / 30 on data whose true rate was 0.5000. DATE BASIS: '
  'every duration is measured from the employer''s stated posted_at ALONE, never '
  'coalesced with our first_seen; undated postings contribute to counts only and '
  'their share is published as dated_coverage, which is deliberately NOT part of '
  '`sufficient` -- the caller renders plain at 0.60 and above, qualified between '
  '0.30 and 0.60, and suppressed below. dated_coverage spans the WHOLE risk-set '
  'population, exit-ledger rows included, so the age-out arm''s missing origins '
  '(job_board_exits.posted_at is stamped only from 2026-09-06 and cannot be '
  'backfilled) read as low coverage and the renderer suppresses, instead of '
  'hiding behind a coverage of 1.0000 while the hazard runs high. WINDOW: '
  'window_days is the shorter of p_days (capped at 90, the exit ledger''s '
  'retention) and the age of the closure log itself. fill_rate_14 IS AN UPPER '
  'BOUND, not a point estimate, wherever relisting happens: the collector logs '
  'one superseded closure per title per 24h and DELETES the deduped postings, so '
  'those competing events are absent from the risk set rather than counted in '
  'it. relist_rate_14 is the matching FLOOR and renders with an "at least" '
  'qualifier. fill_rate_14_lo/hi ARE AN APPROXIMATION, not an exact interval: '
  'Greenwood complementary log-log bounds on S carried across to R by the '
  'observed fill share, exact only if that share is constant over t. '
  'median_days_to_fill is min{t <= 30 : R(t) >= 0.5} -- the median of the FILL '
  'cumulative incidence, NOT of all-cause survival, a deliberate departure from '
  'the frozen contract because S falls on relists as well as fills and the '
  'survival form publishes a short fill median beside a low fill rate. It is '
  'NULL with median_censored TRUE whenever the fill incidence has not reached '
  'one half inside 30 days; render "more than 30 days", never a number, and '
  'render the number itself as "half of these roles are FILLED by day N". '
  'FEED-DARK GUARD: the PER-COMPANY form ran, not the authorised '
  'absolute-threshold fallback. A batch is flagged when it removed more than '
  'max(5, 0.30 x that company''s board size AT THE TIME, taken from the newest '
  'company snapshot at or before the batch''s day), keyed on (company_token, '
  'closed_at); where no snapshot survives the fallback is today''s served count '
  'with the absolute floor RAISED TO 25. A flagged batch is CENSORED, not '
  'deleted -- it is our collection failing, not the employer. If the guard ever '
  'exceeds the timeout, the absolute fallback must be written and this sentence '
  'changed in the same commit. `sufficient` is the model''s three thresholds (25 '
  'at risk, 5 observed fills, interval half-width within 15 points) plus a '
  'fourth, that observed relists at or before day 14 do not outnumber the fills '
  'there. p_min_n gates which categories are RETURNED; `sufficient` gates '
  'whether a returned row may be published.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'It is excluded from all three places this function reads the log: the '
  'risk set, the feed-dark batch sizing (where a backlog''s several hundred '
  'rows on one closed_at would otherwise flag their own arrival as a '
  'collection failure and censor the real closures beside them), and the '
  'window_days depth. '
  'IN THE RISK SET THAT EXCLUSION IS A DELETION, NOT A CENSORING, and it is '
  'the one place in this function where those differ. The subject leaves all '
  'three arms at once (the event arm by predicate, the live arm because its '
  'missing_since is set, the exit arm because ''removed'' is excluded to '
  'avoid double-counting), so it contributes neither exposure nor an event. '
  'The deletion is NOT independent of the outcome -- on a backfilled board it '
  'removes exactly the postings that closed while the still-open ones keep '
  'their exposure -- so fill_rate_14 and median_days_to_fill are biased '
  'DOWNWARD for any category whose backfill concentrates in a few large '
  'boards. Censoring instead would need a last-known-open instant, and this '
  'table does not store one: censoring at closed_at would use the very date '
  'ruled inadmissible, and any other stored column would be inventing the '
  'observation. dated_coverage CANNOT surface this -- it is computed over the '
  'population that survived the predicate, so it reads full while the '
  'subjects are gone. A caveat for it must come from '
  'get_closure_population().closures_lap_backfill, which is the only place '
  'the size of the gap is visible.'
  ' STILL ADVERTISED AT DAY 30 (still_open_30 and its siblings, added '
  '20260909217500). S(30) from the same Aalen-Johansen estimator over a SECOND '
  'cohort: postings with a stated posted_at in [cohort_from, cohort_to], where '
  'cohort_to is thirty days ago (so every member had the full thirty days to '
  'be watched) and cohort_from is GREATEST(the first whole day after now() - '
  'window_days, 2026-08-07). The cohort lives inside the same event window '
  'as the closure and exit arms, so no member can have a takedown the window '
  'cannot see; at p_days 30 it is empty and every day-30 column is NULL. '
  'The 2026-08-07 floor: '
  'job_board_exits.posted_at is stamped only from 2026-09-06, so no age-out '
  'logged earlier carries an origin and cohorts posted before 2026-08-07 are '
  'missing exactly the roles that did not close. The floor retires itself. '
  'still_open_30 is the share of that cohort still advertised when it reached '
  'our 30-day cap; taken_down_30 is the share taken down for good (R(30), a '
  'CEILING for the same relist-dedupe reason as fill_rate_14); '
  'relist_rate_30 is the share re-listed (a FLOOR). sum_check_30 is R + X + S '
  'and is published so the identity is checked rather than asserted; '
  'sufficient_30 requires it within 1e-6, n_at_risk_30 >= 25 and a '
  'complementary-log-log half-width on S within 0.15. ageouts_at_30 counts, '
  'among the observations at risk at day 30, the ones OUR sweep took down at '
  'the cap -- our action, never an employer event -- censored on the same '
  'suspect-or-dark batch verdict the company curve uses, so one age-out gets '
  'one verdict at both grains. '
  'OBSERVABILITY GATE: the day-30 risk set admits only postings on boards '
  'whose bucket in job_board_board_observability is full_read or lap_proven, '
  'as refresh_closure_population() last wrote it; gate_share_30 is the share '
  'of the field''s dated day-30 cohort that admitted, and the day-30 columns '
  'are NULL -- not 1.0 -- when it admitted nothing. A windowed board with no '
  'proven lap has S(30) = 1 by construction, because its takedowns are '
  'invisible and every posting ages out. '
  'A closure never means hired; a role still advertised at day 30 is not '
  'proof of anything about the employer beyond the fact stated; nothing here '
  'extrapolates past the cap (docs/hiring-health-model.md section 10).';
GRANT EXECUTE ON FUNCTION public.get_category_fill_curve(int, int) TO anon, authenticated, service_role;

-- Self-verifying: exactly one definition must remain and it must carry the
-- new columns; a migration whose purpose is a new shape must not be able to
-- report success with the old one still standing beside it.
DO $$
DECLARE n int; cols text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_category_fill_curve';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_category_fill_curve: expected exactly one definition, found %', n;
  END IF;
  SELECT pg_get_function_result(p.oid) INTO cols
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_category_fill_curve';
  IF cols NOT LIKE '%still_open_30%' OR cols NOT LIKE '%cohort_from%' THEN
    RAISE EXCEPTION 'get_category_fill_curve: re-issued without the day-30 columns: %', cols;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
