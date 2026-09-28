-- A TIMEOUT THAT BLANKS A SECTION IS RAISED WHERE THE CRON PAYS FOR IT.
--
-- get_category_fill_curve(90, 300) is the field table on the lifecycle data
-- page and the field lifecycle sentence on /jobs. Its own header capped it at sixty
-- seconds, and the catalogue has outgrown that cap: scripts/verify-deploy.sh
-- section 4e timed the same anon call at 34s on 2026-09-25, 47s at 14:xx on
-- 2026-09-27, and at 18:xx and 23:xx the same day it answered HTTP 500 after
-- the full minute with NO rows (SQLSTATE 57014, canceling statement due to
-- statement timeout). Re-measured once for this file, anon key, single probe:
-- started 2026-09-27T23:48:22Z, ended 23:49:23Z, 60.63s wall, 57014, zero
-- rows. Both pages call it live inside a caught Promise.all, so the cap does
-- not degrade the section -- it deletes it for that visitor, silently.
--
-- THE FIX IS IN TWO HALVES AND THIS FILE IS THE SMALLER ONE. The companion
-- migration (20260928004823) makes the hourly stats cache compute these rows
-- as its eighth part, and the pages move onto that cache; after that deploy
-- nothing on a visitor's critical path calls this function. What remains is
-- the cron path, which can afford minutes. So this file re-issues the
-- function with ITS OWN header raised from sixty seconds to five minutes and
-- changes nothing else: the signature, the thirty columns, every CTE and every
-- gate are the 20260925163842 text byte for byte, and a guard proves it by
-- comparing the comment-stripped definitions with the one header line masked
-- (src/test/a-timeout-that-blanks-a-section-is-raised-where-the-cron-pays-for-it.test.ts).
-- The predecessor's own header said this was the response once the wall time
-- passed roughly forty-five seconds; it has.
--
-- WHY FIVE MINUTES AND NOT LESS. The last completed reading was 47s and the
-- next two did not complete, so the true figure is now somewhere past sixty
-- and unknown. Two minutes would be a second guess against a number that has
-- doubled in two days. Five is a bound the cron can pay for, checked against
-- both callers by derivation from the source rather than from prose:
--   * refresh_explore_cache (minute 7, fifteen-minute header) already calls
--     this function once; its callee ceilings sum to 335s today and 575s with
--     this change, under 900s (explore-claims derives this).
--   * refresh_stats_cache (minute 27 from 20260928011742; minute 12 before
--     it, five minutes behind explore's start) gains the call in the companion file,
--     whose header rises to ten minutes: its callees sum to 185s today by the
--     same derivation (60 + 20 + 20 + 20 + 20 + 20 + 25 -- the index-stats
--     and date-coverage headers are 60s and 20s in their live definitions, not the
--     20s and 5s the 20260909228000 header quoted) and 485s with this change.
--
-- WHAT THIS DOES NOT CHANGE, SAID PLAINLY. The function stays callable by anon
-- and authenticated, because the verifier keeps one live observation of it
-- and the pages still call it until the companion deploy lands. That means an
-- anonymous caller can now hold a connection for five minutes instead of one
-- on a query anyone can invoke; the pages moving off it removes the legitimate
-- traffic, and a follow-up may revoke the anon and authenticated grants once
-- the verifier's live probe is rewritten to expect a permission error. The
-- reachable set is restated at the foot by name rather than inherited, per
-- project_definer_exposure. The COMMENT ON from 20260925163842 does not mention
-- the timeout and survives CREATE OR REPLACE unchanged, so it is not restated.
--
-- THE SHAPE DOES NOT CHANGE, SO NOTHING IS DROPPED. CREATE OR REPLACE keeps
-- the oid, the grants and the comment; the one-function-one-signature guard
-- sees the same (integer, integer) it saw before. MIGRATIONS ARE IMMUTABLE:
-- 20260925163842 is untouched and the guards that pin the live definition
-- follow the function here.

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
  sufficient_30       boolean,
  events_30           int,
  fills_30            int,
  relists_30          int,
  top_board_share_30  numeric,
  dated_cohort_n_30   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
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
  -- THE DAY-30 SUFFICIENCY GATE, NAMED ONCE AND IDENTICAL TO 20260925163517's.
  -- The risk-set floor and the absolute half-width ceiling are the model's own
  -- thresholds at this horizon. MIN_EVENTS_30 is used TWICE here and the two
  -- uses answer different questions: at BOARD grain it is the admission test
  -- for a board's mass entering a field's pool (has this board shown us
  -- anything in THIS field), and at FIELD grain it is a floor under the pooled
  -- figure. MIN_FILLS_30 and the relist-against-fill balance are the day-14
  -- gate's two terms re-counted on this cohort, because taken_down_30 and
  -- relist_rate_30 are a fill rate and a relist rate published under this same
  -- boolean. MAX_REL_HALF_WIDTH_30 bars a half-width larger than that share of
  -- the complement the sentence asserts -- the term an absolute ceiling cannot
  -- express, since absolute width collapses as S approaches one however few
  -- events produced it. Every threshold is the same number the company grain
  -- uses, and a guard compares the two files rather than trusting that.
  k AS (
    SELECT DATE '2026-09-06'  AS exits_origin_stamped_from,
           25                 AS min_n_at_risk_30,
           5                  AS min_events_30,
           5                  AS min_fills_30,
           0.15::numeric      AS max_half_width_30,
           0.50::numeric      AS max_rel_half_width_30
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
      c.company_token AS tok,
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
      e.company_token AS tok,
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
      p.company_token AS tok,
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
  -- THE POSITIVE CONTROL, AT THE GRAIN THE FIGURE IS POOLED AT, BEFORE
  -- ANYTHING IS POOLED. The events of a board's OWN day-30 cohort IN ONE
  -- FIELD: fills and relists, the two that move S, at days at or before the
  -- cap. Both counters are already zero on a suspect or feed-dark batch, so a
  -- collection failure cannot buy a board its way in. Our sweep's takedowns at
  -- the cap are NOT here -- they are the age-out arm, our action rather than
  -- the employer's, and counting them would rebuild the tautology this file
  -- exists to remove one level down.
  --
  -- THE GROUPING CARRIES THE CATEGORY, AND THAT IS THE WHOLE POINT. A control
  -- counted per board and applied per board-and-field would admit a board into
  -- EVERY field it touches on events it produced in a DIFFERENT one: a board
  -- with five engineering fills and twenty thousand eventless customer roles
  -- censored at the cap would re-enter the customer pool on the strength of
  -- the engineering fills, and its mass would hold customer's S(30) up on
  -- every day of the curve while contributing no event to any of them. That is
  -- the mechanism this file's own title names, one grain finer. So the count is
  -- taken per (board, field) and the join below matches on both keys: a board
  -- is admitted into a field only on that field's own events.
  --
  -- THE COUNT IS OVER CATEGORISED ROWS ONLY, deliberately and by construction:
  -- every arm of `raw` requires a non-empty category, so a closure the
  -- collector left uncategorised is in neither the pool nor the count. The
  -- company grain (20260925163517) counts a board's cohort events regardless of
  -- category, so a board with two uncategorised events among five publishes
  -- there and is excluded here. That makes this grain the STRICTER of the two
  -- -- nothing is over-published as a result -- and the difference is stated
  -- rather than left to be discovered: the field pool is a claim about
  -- categorised roles, and its control is counted on the same rows.
  board30 AS (
    SELECT
      r.tok,
      r.cat,
      sum(r.is_fill + r.is_relist)::int AS events30
    FROM raw r
    WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0 AND r.tt <= 30
    GROUP BY r.tok, r.cat
  ),
  -- THE DAY-30 RISK SET, GATED BY EQUALITY ON BOTH TESTS AT ONCE. A posting is
  -- admitted when its board sits in an observability bucket that can prove an
  -- absence AND that board's own cohort proved it by producing events. The two
  -- consumers below -- the estimator chain and the coverage share it publishes
  -- -- both read THIS, so the share always describes the same admission the
  -- figure was computed under. A board with no row in either table is not
  -- admitted, which is the safe direction.
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
      COALESCE(sum(c.d_fill + c.d_relist) FILTER (WHERE c.tt <= 30), 0)::int AS events30,
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
  -- How much of the field's dated day-30 cohort the gate let through, and how
  -- much of what it let through is ONE BOARD. The first is published because a
  -- field whose big boards are all windowed is measured on its small ones. The
  -- second is published because of a residual this change does NOT close: the
  -- pooled S(30) is a mass-weighted average over admitted boards, so a large
  -- board that cleared the events floor with a handful of events of its own
  -- still carries its whole censored mass into the pool and pulls the field
  -- toward one in proportion to its size. The events floor refuses a board that
  -- showed us NOTHING; it does not refuse a board that showed us very little
  -- relative to how much of it we are counting.
  --
  -- WHY IT IS DISCLOSED AND NOT GATED. A cap would need a threshold, and a
  -- threshold here would have to be calibrated against the share of each
  -- field's day-30 risk set held by its largest board -- which cannot be read
  -- with the anon key today: the board's companies facet is BOARD-WIDE and
  -- ignores the category filter, and the field totals beside it are capped at
  -- 10,000, so every ratio available from outside compares two different
  -- populations (feedback_measure_like_with_like). An uncalibrated cap could
  -- withhold most of the table on a number nobody measured, which is the error
  -- this whole change exists to stop, pointed the other way. So the quantity is
  -- PUBLISHED, the page prints it, and scripts/verify-deploy.sh records it per
  -- field from the first live read after this applies -- which is the
  -- measurement a cap would need, taken with the reads a cap would be set from.
  --
  -- THE ROLLUP IS TWO LEVELS OVER ONE SCAN, not a second pass over `gated`:
  -- the per-board counts are grouped once and the field totals are summed from
  -- them, so the added cost is a grouping over an intermediate that is already
  -- orders of magnitude smaller than the risk set.
  board_share30 AS (
    SELECT
      r.cat,
      r.tok,
      count(*) FILTER (WHERE r.in_cohort30 AND r.dated AND r.admitted)::int AS admitted_dated_n,
      count(*) FILTER (WHERE r.in_cohort30 AND r.dated)::int                AS dated_n30
    FROM gated r
    GROUP BY r.cat, r.tok
  ),
  gate30 AS (
    SELECT
      b.cat,
      sum(b.admitted_dated_n)::int AS admitted_dated_n,
      sum(b.dated_n30)::int        AS dated_n30,
      max(b.admitted_dated_n)::int AS top_board_admitted_n
    FROM board_share30 b
    GROUP BY b.cat
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
    -- THE SAME SEVEN TERMS AS THE COMPANY GRAIN, over the pooled field. The
    -- relative term divides by the complement, which is zero exactly when S is
    -- one; that case is already refused by the events floor above it, and the
    -- terms are ordered so the division is never the thing doing the refusing.
    COALESCE(e30.cat IS NOT NULL
       AND COALESCE(e30.n30, 0) >= (SELECT kk.min_n_at_risk_30 FROM k kk)
       AND COALESCE(e30.events30, 0) >= (SELECT kk.min_events_30 FROM k kk)
       AND COALESCE(e30.fills30, 0) >= (SELECT kk.min_fills_30 FROM k kk)
       AND COALESCE(e30.relists30, 0) <= COALESCE(e30.fills30, 0)
       AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_half_width_30 FROM k kk)
       AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_rel_half_width_30 FROM k kk) * (1 - e30.s30)
       AND abs(e30.r30 + e30.x30 + e30.s30 - 1) <= 0.000001, false) AS sufficient_30,
    -- THE COUNT THE POSITIVE CONTROL IS BUILT FROM, PUBLISHED, for the reason
    -- sum_check_30 is published: a gate asserted is a gate nobody checked.
    -- Pooled over the boards the row was computed on, so it is the field's own
    -- events and never a window of them.
    e30.events30            AS events_30,
    -- SPLIT, because the two license different sentences: a pool whose events
    -- are all relists publishes taken_down_30 = 0.0000, and their sum alone
    -- cannot tell a reader that from a pool that saw nothing come down.
    e30.fills30             AS fills_30,
    e30.relists30           AS relists_30,
    -- THE RESIDUAL, MEASURED IN THE SAME ROW AS THE FIGURE IT QUALIFIES: the
    -- share of the field's ADMITTED dated day-30 cohort held by its single
    -- largest board. A field this reads near one is one board's answer wearing
    -- a field's name, whatever the interval says.
    round(g30.top_board_admitted_n::numeric / NULLIF(g30.admitted_dated_n, 0), 4) AS top_board_share_30,
    -- THE DENOMINATOR OF gate_share_30, PUBLISHED, so a NULL reading can say
    -- WHICH absence it is. Without it the two causes of a NULL -- no dated role
    -- of this field reached the cap at all, versus dated roles reached it and
    -- none of them was on a board that cleared both tests -- are one value, and
    -- the page printed the first sentence for both. A refusal printed under the
    -- wrong reason is a second false statement beside the one it replaced.
    g30.dated_n30            AS dated_cohort_n_30
  FROM bounds b
  JOIN cov cv ON cv.cat = b.cat
  LEFT JOIN bounds30 e30 ON e30.cat = b.cat
  LEFT JOIN gate30   g30 ON g30.cat = b.cat
  WHERE b.obs_n >= GREATEST(p_min_n, 25)
  ORDER BY b.r14 DESC, b.cat ASC;
$$;

-- THE REACHABLE SET, STATED NOT INHERITED. Unchanged from 20260925163842: the
-- function is deliberately anon-callable; PUBLIC is still not the same set as
-- anon, so all three are named.
REVOKE ALL ON FUNCTION public.get_category_fill_curve(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_fill_curve(int, int) TO anon, authenticated, service_role;

-- Self-verifying: exactly one definition must remain, it must carry the raised
-- header in its own proconfig, and it must still publish the thirty columns --
-- a re-issue whose purpose is one header line must not be able to report
-- success having changed the shape or having left the old header standing.
DO $$
DECLARE n int; cfg text[]; cols text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_category_fill_curve';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_category_fill_curve: expected exactly one definition, found %', n;
  END IF;
  SELECT p.proconfig INTO cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_category_fill_curve';
  IF cfg IS NULL OR NOT ('statement_timeout=5min' = ANY(cfg)) THEN
    RAISE EXCEPTION 'get_category_fill_curve: re-issued without the five-minute header: %', cfg;
  END IF;
  SELECT pg_get_function_result(p.oid) INTO cols
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_category_fill_curve';
  IF cols NOT LIKE '%dated_cohort_n_30%' OR cols NOT LIKE '%top_board_share_30%' THEN
    RAISE EXCEPTION 'get_category_fill_curve: a header-only re-issue changed the result shape: %', cols;
  END IF;
END $$;
