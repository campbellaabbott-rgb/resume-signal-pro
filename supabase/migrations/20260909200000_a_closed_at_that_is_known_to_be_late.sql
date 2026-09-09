-- A CLOSED_AT THAT IS KNOWN TO BE LATE IS NOT A DATE, AND SIXTEEN FUNCTIONS
-- WERE ABOUT TO READ IT AS ONE.
--
-- 20260909010000 gave job_board_closures an absence_basis column and wrote the
-- rule into the column's own COMMENT: a 'lap_backfill' row is a takedown from
-- a big board's FIRST observable laps -- the backlog that piled up while the
-- page cap made the board unobservable, up to thirty days of it, landing at
-- once with a closed_at of the day we could finally see it. That closed_at is
-- "KNOWN TO BE LATE, by an unknown amount up to the freshness window, so it is
-- not admissible in ANY duration, tenure or fill-speed statistic".
--
-- Nothing read the column. Not one of the functions that computes a duration,
-- a rate or a tenure from that table filtered on it; get_category_fill_curve,
-- named in that migration's own follow-up sentence, has zero references to it.
-- Both R(14) and the median read closed_at.
--
-- NOTHING IS WRONG TODAY, AND THAT IS THE ONLY REASON THIS IS A DESIGN CHANGE
-- RATHER THAN AN INCIDENT. deepCursor.laps is 0: no board has completed a
-- proven lap, so no lap_backfill row exists yet and every statistic below is
-- currently drawn from full_read and NULL rows alone. The first proven lap
-- starts writing them within days, and on the day it does, the biggest boards
-- on the site -- 270 boards at 500+ roles, 36.4% of inventory -- deliver up to
-- a month of accumulated takedowns stamped with a single day's closed_at.
-- Under the old bodies that arrival reads as:
--   * a fill that took one day (closed_at - posted_at, on a role that in fact
--     stood for weeks) in every curve, median and benchmark;
--   * several hundred takedowns "today" in get_takedowns_today, one week's
--     `closed` spike in get_hiring_trends, one window's outflow in
--     get_board_flow;
--   * a tracking_days of 1 for an employer we have watched for months,
--     because its first closure is suddenly today's.
-- Every one of those is our own observability catching up, published as an
-- employer's behaviour. It is the 2.8-day-median incident with a new cause.
--
-- WHAT THIS MIGRATION DOES. Every function that reads job_board_closures.
-- closed_at now excludes lap_backfill, and every one of them says in its
-- COMMENT which bases it admits. The predicate is spelled
-- `absence_basis IS DISTINCT FROM 'lap_backfill'` and never `<> 'lap_backfill'`:
-- the column is nullable, every pre-2026-09-08 row is NULL, and `<>` would
-- silently delete the entire history this board has.
--
-- THREE THINGS THIS DELIBERATELY DOES NOT DO.
--
-- 1. It does not stop LOGGING lap_backfill rows, and it does not delete them.
--    The closure log is the one asset here that cannot be re-derived, and a
--    lap_backfill row is a true statement that a posting came down -- it is the
--    DATE that is unusable, not the event. get_closure_population() counts them
--    (closures_lap_backfill) so the excluded mass is published rather than
--    hidden, and job_board_closure_rollup gains a backfill_n column below so
--    the count survives the prune that deletes the rows.
--
-- 2. It does not filter the row out of get_application_lifecycle. That function
--    answers "what happened to the job I applied to", per posting: dropping the
--    row would turn a real takedown into 'not_observed', which is a worse lie
--    than a late date. The row stays, the outcome stays, and days_standing
--    alone goes NULL -- the duration is the only part that was never knowable.
--
-- 3. It does not touch first_closed_at / last_closed_at in the rollup. Those
--    bound the OBSERVATION span of an archived month, which is exactly what a
--    lap_backfill row's closed_at honestly is.
--
-- ONE TRAP, RECORDED BECAUSE IT NEARLY SHIPPED. get_hiring_trends,
-- get_trending_categories and get_takedowns_today are written SECURITY INVOKER
-- in their source migrations and were switched to DEFINER later, by
-- `ALTER FUNCTION ... SECURITY DEFINER` in 20260820174500 -- after the lockdown
-- of job_board_closures made all three return EMPTY AGGREGATES with a 200 and
-- /hiring-trends published "no roles filled or closed" as a fact about the
-- labour market for two days. A CREATE OR REPLACE that copied the old body
-- forward would have reset all three to INVOKER and re-run that outage, with
-- anon-facing-closure-readers-must-be-definer.test.ts still green, because that
-- guard also reads the old ALTER. All three are re-issued below with
-- SECURITY DEFINER spelled in the body.
--
-- No index is added and no table is rewritten. The predicate rides on scans
-- these functions already perform.

--
-- WHY THIS IS TWO MIGRATIONS AND NOT ONE. The two Aalen-Johansen curves live
-- here alone; the other fourteen functions are in 20260909201000, which applies
-- immediately after. The split is not cosmetic. the-estimator-that-must-agree-
-- with-arithmetic.test.ts mirrors the reference estimator against the migration
-- FILE that last defines each curve, and it re-pins to this file -- so that file
-- must contain the curves and nothing whose spelling the mirror would read as a
-- violation. get_application_lifecycle, three sections into the sibling file,
-- carries the schema's one sanctioned COALESCE(posted_at, first_seen); pooled
-- into one file it would have read as the estimator having grown a coalesced
-- origin. Keeping the guard able to see the live body was worth one extra file.
--
-- ORDER MATTERS AND IS THE FILENAME ORDER: get_actively_hiring_companies, in
-- the sibling, calls get_company_fill_curve, which is defined here.

SET LOCAL statement_timeout = '5min';

-- ── 1. the category curve ───────────────────────────────────────────────────
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
  sufficient          boolean
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
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL OR c.superseded THEN 0 ELSE 1 END AS is_fill,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL THEN 0
           WHEN c.superseded THEN 1 ELSE 0 END AS is_relist,
      true AS in_cov,
      (c.posted_at IS NOT NULL) AS dated
    FROM public.job_board_closures c
    -- `dark` is one row per (tok, closed_at) by construction, so this cannot
    -- multiply rows; dk.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
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
      0 AS is_fill,
      0 AS is_relist,
      true AS in_cov,
      (e.posted_at IS NOT NULL) AS dated
    FROM public.job_board_exits e
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
      0 AS is_fill,
      0 AS is_relist,
      true AS in_cov,
      (p.posted_at IS NOT NULL) AS dated
    FROM public.job_board_postings p
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
       AND b.relists14 <= b.fills14) AS sufficient
  FROM bounds b
  JOIN cov cv ON cv.cat = b.cat
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
  'the size of the gap is visible.';
GRANT EXECUTE ON FUNCTION public.get_category_fill_curve(int, int) TO anon, authenticated, service_role;

-- ── 2. the per-employer curve ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_company_fill_curve(p_tokens text[])
RETURNS TABLE (
  company_token       text,
  n_at_risk_14        int,
  fills_le_14         int,
  fill_rate_14        numeric,
  fill_rate_14_lo     numeric,
  fill_rate_14_hi     numeric,
  relist_rate_14      numeric,
  still_open_14       numeric,
  fill_rate_7         numeric,
  fill_rate_30        numeric,
  median_days_to_fill numeric,
  median_censored     boolean,
  dated_coverage      numeric,
  dated_n             int,
  undated_n           int,
  open_roles          int,
  fills_90d           int,
  relists_90d         int,
  ageouts_90d         int,
  fill_through        numeric,
  churn               numeric,
  absorption          numeric,
  tracking_days       int,
  sufficient          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH toks AS (
    SELECT DISTINCT unnest(p_tokens) AS tok
  ),
  -- Served open roles. BOTH serving predicates, so this matches
  -- /jobs/company/{token} exactly; a count that applied only one of them stated
  -- a bigger number than the board it links to.
  open_now AS (
    SELECT p.company_token AS tok, count(*)::int AS n
    FROM public.job_board_postings p
    JOIN toks ON toks.tok = p.company_token
    WHERE p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token
  ),
  -- Unstamped batches, sized once. The collector writes one closed_at per board
  -- pass, so (company_token, closed_at) is the batch key itself rather than a
  -- proxy for one.
  batches AS (
    SELECT
      c.company_token AS tok,
      c.closed_at     AS at,
      date_trunc('day', c.closed_at)::date AS on_day,
      count(*)::int   AS n_removed
    FROM public.job_board_closures c
    JOIN toks ON toks.tok = c.company_token
    WHERE c.closed_at >= now() - interval '90 days'
      AND c.batch_live_before IS NULL
      -- See the same line in get_category_fill_curve: a first lap's backlog
      -- arrives as one enormous batch and would condemn itself.
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token, c.closed_at, date_trunc('day', c.closed_at)::date
  ),
  -- Retroactive feed-dark proxy, applied ONLY to unstamped history.
  --
  -- THE DENOMINATOR IS THE BOARD AS IT WAS, NOT AS IT IS. Scoring a 40-day-old
  -- batch against today's served count deletes exactly the employer that filled
  -- a hiring class and then wound its board down: 120 real fills judged against
  -- the 8 roles it serves now clears max(5, 0.30 x 8) and the whole batch
  -- disappears. job_board_company_snapshots holds (company_token, snapshot_date,
  -- open_roles) on a primary key, so the most recent snapshot at or before the
  -- batch's day is a single index seek per batch and is the contemporaneous
  -- board size.
  --
  -- Snapshots are pruned at 35 days and the unstamped era is about 54 days, so
  -- the oldest fifth of it has no snapshot to stand on. There the fallback is
  -- today's count with the absolute floor RAISED to 25: in that region we cannot
  -- tell a wind-down from a dark feed, and with the floor at 5 a twelve-role
  -- employer closing six roles in one legitimate pass lost all six. Under-
  -- catching a small dark batch biases one employer's rate up; over-deleting
  -- biases every wind-down to zero and removes the best-evidenced employers
  -- first. The floor is stated in the COMMENT ON, not implied.
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
  -- THE SAME VERDICT, REACHABLE FROM THE EXIT LEDGER.
  --
  -- The closure arm below reads two feed-dark signals: the collector's own
  -- `suspect` stamp, and the retroactive `dark` proxy over unstamped history.
  -- The exit-ledger arm read NEITHER, because job_board_exits carries no
  -- suspect column and no batch alibi -- so ageouts_90d was an uncensored
  -- numerator over a partly censored denominator, and every caller dividing
  -- one by the other published a share inflated toward the accusation. On a
  -- worked example (100 fills, 60 relists, 40 age-outs, one batch censoring 50
  -- fills and 30 relists) the published share was 33% where the true figure is
  -- 20%.
  --
  -- THE TWO LEDGERS SHARE A BATCH KEY EXACTLY, which is what makes this
  -- possible rather than approximate. One board pass computes a single
  -- `closedAt` and writes it as job_board_closures.closed_at on the takedowns
  -- AND as job_board_exits.exited_at on the age-outs of that same `vanished`
  -- set (job-board/index.ts, the aged-exit and closure-row mappers). So
  -- (company_token, exited_at) IS the closure batch key, not a proxy for one.
  --
  -- WHAT IT CANNOT SEE, STATED: a pass in which EVERY vanished posting aged
  -- out writes no closure row, so it has no suspect stamp and no batch to size,
  -- and its age-outs are not censorable from here. That direction over-counts
  -- age-outs, which is the accusing direction -- it is bounded by how rarely a
  -- whole pass is age-outs alone, and it is named here rather than implied.
  bad_batch AS (
    SELECT DISTINCT c.company_token AS tok, c.closed_at AS at
    FROM public.job_board_closures c
    JOIN toks ON toks.tok = c.company_token
    WHERE c.closed_at >= now() - interval '90 days'
      AND COALESCE(c.suspect, false)
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    UNION
    SELECT d.tok, d.at FROM dark d
  ),
  -- One pass that produces every observation in the risk set, plus the flags
  -- the counts need.
  --
  -- THE COHORT IS SELECTED ON ORIGIN, NOT ON EXIT TIME. This is the correction
  -- that makes the number mean what it says. Gathering fills, relists and
  -- age-outs over a 90-day window of EXIT times while the live censored arm is
  -- one instant of the board matches 90 days of events against a single day's
  -- worth of still-open observations, so every day of the window contributes
  -- its events but only 1/W of the roles that were still open. Measured in
  -- pglite on noise-free steady-state data whose true R(14) was exactly 0.5000,
  -- the exit-windowed form returned 0.4390 with a published 95% interval of
  -- [0.4093, 0.4700] -- the truth outside its own band, `sufficient` true -- and
  -- 0.4390 / 0.4138 / 0.3529 as the window moved 90 / 60 / 30. A function whose
  -- whole purpose is to stop publishing an artefact of our own window cannot
  -- have a window-dependent answer.
  --
  -- in_cohort therefore admits an observation only when the employer stated a
  -- post date AND that date falls inside the window, on all three arms alike.
  -- One posting that filled on day 5 and one still live on day 40 then each
  -- contribute exactly one observation, and R(14) is window-invariant.
  --
  -- COUNTS ARE DELIBERATELY NOT COHORT-SCOPED: fills_90d, relists_90d and
  -- ageouts_90d are named for a window of events and stay a window of events.
  --
  -- tt is clamped at 31. Nothing at or past day 31 is ever published (the
  -- horizons are 7, 14 and 30), and a censored row parked at 31 is at risk on
  -- every published day exactly as it would be at 400. The clamp bounds each
  -- employer's window to at most 32 rows, which is what keeps 200 tokens inside
  -- the budget.
  --
  -- A BAD BATCH IS CENSORED, NOT DELETED. Both the collector's own `suspect`
  -- stamp and the retroactive proxy above identify a COLLECTION failure: the
  -- postings almost certainly did not come down, we simply stopped being able
  -- to see them. Dropping those rows from `raw` would be the same
  -- truncation-as-censoring this migration exists to remove, applied to our own
  -- outage. They stay in the risk set as censored observations at tt, count in
  -- dated_coverage, and contribute to neither fills_90d nor relists_90d. A
  -- false positive then costs one observation's worth of information rather
  -- than an employer's entire fill record.
  raw AS (
    SELECT
      c.company_token AS tok,
      CASE WHEN c.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (c.posted_at IS NOT NULL AND c.posted_at >= now() - interval '90 days') AS in_cohort,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL OR c.superseded THEN 0 ELSE 1 END AS is_fill,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL THEN 0
           WHEN c.superseded THEN 1 ELSE 0 END AS is_relist,
      0 AS is_ageout,
      0 AS is_live,
      0 AS is_lstar,
      true AS in_cov,
      (c.posted_at IS NOT NULL) AS dated
    FROM public.job_board_closures c
    JOIN toks ON toks.tok = c.company_token
    -- `dark` is one row per (tok, closed_at) by construction, so this cannot
    -- multiply rows; dk.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    WHERE c.closed_at >= now() - interval '90 days'
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'

    UNION ALL

    SELECT
      e.company_token AS tok,
      CASE WHEN e.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (e.exited_at - e.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (e.posted_at IS NOT NULL AND e.posted_at >= now() - interval '90 days') AS in_cohort,
      0 AS is_fill,
      0 AS is_relist,
      -- CENSORED ON THE SAME BATCH VERDICT AS THE CLOSURE ARM, and censored
      -- rather than deleted for the same reason: the row stays in the risk set
      -- at tt and counts in dated_coverage, it simply stops being an EVENT.
      -- Without this, ageouts_90d was the only count in the function not
      -- subject to the feed-dark policy the others are, and the share a caller
      -- builds from the three was a ratio of two populations.
      CASE WHEN bb.tok IS NOT NULL THEN 0
           WHEN e.exit_reason = 'aged_out' THEN 1 ELSE 0 END AS is_ageout,
      0 AS is_live,
      0 AS is_lstar,
      true AS in_cov,
      (e.posted_at IS NOT NULL) AS dated
    FROM public.job_board_exits e
    JOIN toks ON toks.tok = e.company_token
    -- bad_batch is DISTINCT on (tok, at) by construction, so this cannot
    -- multiply rows; bb.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at
    WHERE e.exited_at >= now() - interval '90 days'
      AND e.exit_reason IN ('aged_out', 'board_dormant', 'untracked')

    UNION ALL

    SELECT
      p.company_token AS tok,
      CASE WHEN p.posted_at IS NOT NULL
           THEN LEAST(floor(extract(epoch FROM (now() - p.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (p.posted_at IS NOT NULL AND p.posted_at >= now() - interval '90 days') AS in_cohort,
      0 AS is_fill,
      0 AS is_relist,
      0 AS is_ageout,
      1 AS is_live,
      -- L* is a MEMBERSHIP test ("has this role been up a fortnight?"), never a
      -- published duration, so it may use effective_posted where a duration may
      -- not. Deriving it from tt instead scored every undated live role as zero,
      -- which put undated rows in fill_through's numerator (via fills_90d) and
      -- nowhere in its denominator: an employer publishing no dates at all
      -- returned fill_through = 1.0000 on 30 closures beside 400 live roles.
      CASE WHEN p.effective_posted <= now() - interval '14 days' THEN 1 ELSE 0 END AS is_lstar,
      true AS in_cov,
      (p.posted_at IS NOT NULL) AS dated
    FROM public.job_board_postings p
    JOIN toks ON toks.tok = p.company_token
    WHERE p.missing_since IS NULL
  ),
  -- Counts over the 90-day activity window, including undated rows.
  --
  -- dated_coverage is measured over the WHOLE risk-set population, exit-ledger
  -- rows included. An earlier draft excluded them, on the reasoning that
  -- job_board_exits.posted_at is a column we only started stamping on
  -- 2026-09-06 and folding our own schema gap into a coverage figure reads as
  -- an employer failing to publish dates. That reasoning is right about the
  -- cause and wrong about the consequence: every exit row written before today
  -- has posted_at NULL, so the entire age-out arm falls out of the risk set for
  -- the next ~90 days, which removes exactly the roles that demonstrably did
  -- NOT fill and raises the hazard at every day. Hiding that behind
  -- dated_coverage = 1.0000 made the renderer show the inflated rate plain.
  -- The column exists so the RENDERER acts, not so the reader forgives us; it
  -- now measures the share of the risk set that carries a usable origin, which
  -- is the quantity the caller's 0.60/0.30 bands are actually about.
  counts AS (
    SELECT
      r.tok,
      sum(r.is_fill)::int   AS f90,
      sum(r.is_relist)::int AS r90,
      sum(r.is_ageout)::int AS a90,
      count(*) FILTER (WHERE r.in_cov AND r.dated)::int      AS d_n,
      count(*) FILTER (WHERE r.in_cov AND NOT r.dated)::int  AS u_n,
      COALESCE(sum(r.is_lstar), 0)::int AS lstar
    FROM raw r
    GROUP BY r.tok
  ),
  -- Distinct observation days over the ORIGIN cohort. Everything downstream
  -- runs over at most 32 rows per employer.
  agg AS (
    SELECT
      r.tok,
      r.tt,
      sum(r.is_fill)::int   AS d_fill,
      sum(r.is_relist)::int AS d_relist,
      count(*)::int         AS cnt
    FROM raw r
    WHERE r.in_cohort AND r.tt IS NOT NULL AND r.tt >= 0
    GROUP BY r.tok, r.tt
  ),
  -- n_j = observations with t >= t_j. Censored-at-t_j count as at risk, which
  -- is the convention the survival product assumes.
  curve AS (
    SELECT
      a.tok, a.tt, a.d_fill, a.d_relist, a.cnt,
      (a.d_fill + a.d_relist) AS d,
      (sum(a.cnt) OVER (
        PARTITION BY a.tok ORDER BY a.tt DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ))::int AS n
    FROM agg a
  ),
  -- S as exp(sum(ln(...))) so it can be a running window function.
  --
  -- THE GREATEST CLAMP IS LOAD-BEARING. When every remaining observation has an
  -- event on the same day, d_j = n_j, the factor is 0, ln(0) is -Infinity, and
  -- the whole employer's row comes back NULL -- silently, as an absence rather
  -- than an error. Clamping the factor at 1e-12 keeps S finite and negligible.
  -- Its only cost is that the R + X + S identity is off by S_{j-1} * 1e-12 in
  -- that degenerate case.
  --
  -- Greenwood's summand is NULL at d_j = n_j (division by n_j - d_j) and sum()
  -- skips NULLs, so the variance is under-stated in exactly that case; S is
  -- then ~0 and the interval collapses. That case cannot pass the sufficiency
  -- gate on any real sample.
  surv AS (
    SELECT
      c.*,
      exp(sum(ln(GREATEST(1.0 - c.d::numeric / c.n, 1e-12))) OVER (
        PARTITION BY c.tok ORDER BY c.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )) AS s,
      sum(c.d::numeric / (c.n::numeric * NULLIF(c.n - c.d, 0))) OVER (
        PARTITION BY c.tok ORDER BY c.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS gw
    FROM curve c
  ),
  -- S(t_{j-1}); 1.0 before the first observation day.
  lagged AS (
    SELECT
      s.*,
      lag(s.s, 1, 1.0) OVER (PARTITION BY s.tok ORDER BY s.tt) AS s_prev
    FROM surv s
  ),
  cum AS (
    SELECT
      l.*,
      sum(l.s_prev * l.d_fill::numeric / l.n) OVER (
        PARTITION BY l.tok ORDER BY l.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS r_cif,
      sum(l.s_prev * l.d_relist::numeric / l.n) OVER (
        PARTITION BY l.tok ORDER BY l.tt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS x_cif
    FROM lagged l
  ),
  -- R and X are non-decreasing in t and S is non-increasing, so max/min over
  -- t <= h all read the SAME row -- the last observation day at or before h.
  -- The three published values at day 14 are therefore mutually consistent and
  -- their identity survives the aggregation.
  --
  -- THE MEDIAN IS THE MEDIAN OF THE FILL CIF, min{t <= 30 : R(t) >= 0.5}, and
  -- NOT min{t <= 30 : S(t) <= 0.5}. This is a deliberate departure from the
  -- frozen contract, which specified the survival form; the contract is wrong
  -- here and the column name is what proves it. S falls on relists as well as
  -- fills, so under the survival form an employer with 55 relisted closures on
  -- day 4, 10 fills on day 10 and 35 live roles returns median_days_to_fill = 4
  -- with median_censored = false beside fill_rate_14 = 0.10 -- a four-day fill
  -- median published for an employer that filled a tenth of its board. That is
  -- the manufactured median this whole change exists to delete, rebuilt in a new
  -- place, and it is systematic rather than extremal: S falls faster than R by
  -- exactly the relist increments, so every published median is pulled below the
  -- fill median whenever any relist exists. Under the CIF form the median is
  -- NULL far more often, because R rarely reaches one half inside 30 days. That
  -- is the honest outcome and it is what median_censored is for.
  at_h AS (
    SELECT
      c.tok,
      COALESCE(max(c.r_cif) FILTER (WHERE c.tt <= 14), 0) AS r14,
      COALESCE(max(c.x_cif) FILTER (WHERE c.tt <= 14), 0) AS x14,
      COALESCE(min(c.s)     FILTER (WHERE c.tt <= 14), 1) AS s14,
      COALESCE(max(c.gw)    FILTER (WHERE c.tt <= 14), 0) AS gw14,
      COALESCE(max(c.r_cif) FILTER (WHERE c.tt <= 7),  0) AS r7,
      COALESCE(max(c.r_cif) FILTER (WHERE c.tt <= 30), 0) AS r30,
      COALESCE(sum(c.d_fill)   FILTER (WHERE c.tt <= 14), 0)::int AS fills14,
      COALESCE(sum(c.d_relist) FILTER (WHERE c.tt <= 14), 0)::int AS relists14,
      COALESCE(sum(c.cnt)      FILTER (WHERE c.tt >= 14), 0)::int AS n14,
      min(c.tt) FILTER (WHERE c.tt <= 30 AND c.r_cif >= 0.5) AS med
    FROM cum c
    GROUP BY c.tok
  ),
  -- Greenwood on the complementary log-log scale. S^a is DECREASING in a for
  -- 0 < S < 1, so the +1.96 branch is the LOWER bound; writing it the other way
  -- round produces an interval that is inverted and still plausible-looking.
  -- v is clamped at 4 and the exponent at [1/50, 50]: past that the interval is
  -- wider than the parameter's own range, the sufficiency gate has already
  -- failed, and an unclamped numeric power can overflow.
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
      CASE WHEN b.v <= 0 THEN b.s14
           ELSE b.s14 ^ LEAST(exp(1.96 * sqrt(b.v)), 50.0)
      END AS s_lo,
      CASE WHEN b.v <= 0 THEN b.s14
           ELSE b.s14 ^ GREATEST(exp(-1.96 * sqrt(b.v)), 0.02)
      END AS s_hi
    FROM band b
  ),
  -- The observed fill share carries the interval from S across to R.
  est AS (
    SELECT
      c.*,
      COALESCE(c.fills14::numeric / NULLIF(c.fills14 + c.relists14, 0), 0) AS fshare
    FROM ci c
  ),
  -- Clamped to [0,1] HERE rather than in the final projection, because LEAST
  -- and GREATEST IGNORE NULL arguments: LEAST(NULL, 1) is 1, so clamping after
  -- the outer LEFT JOIN turned "this employer has no observations" into a
  -- confident interval of [1, 1]. Measured in pglite against an unknown token
  -- before this CTE existed. Inside here every input is non-NULL by
  -- construction, and the join below is what introduces absence.
  bounds AS (
    SELECT
      e.*,
      GREATEST(LEAST(e.fshare * (1 - e.s_hi), 1), 0) AS r_lo,
      GREATEST(LEAST(e.fshare * (1 - e.s_lo), 1), 0) AS r_hi
    FROM est e
  ),
  -- Per-employer tracking span: its own first closure, falling back to when we
  -- first saw its board. It was once the age of the entire closure log, which
  -- made every newly-carried board report a long window with no fills, and
  -- silence read as a verdict.
  span AS (
    SELECT
      t.tok,
      LEAST(GREATEST(COALESCE(
        EXTRACT(DAY FROM now() - (SELECT min(c.closed_at) FROM public.job_board_closures c
           WHERE c.company_token = t.tok AND c.absence_basis IS DISTINCT FROM 'lap_backfill'))::int,
        EXTRACT(DAY FROM now() - (SELECT min(p.first_seen) FROM public.job_board_postings p WHERE p.company_token = t.tok))::int,
        0), 0), 90) AS days
    FROM toks t
  ),
  -- L0 for absorption. Openings observed in the window are not logged anywhere
  -- we can read: exit-ledger rows carry no first_seen, so counting arrivals
  -- would undercount by exactly the roles that left. The identity
  -- (O - F - R - A) = (live now - live then) makes the snapshot difference the
  -- same quantity without inventing a number. Snapshots are pruned at 35 days,
  -- so the basis is the earliest snapshot still held inside the window, which
  -- is shorter than 90 days in practice; that is stated in the COMMENT ON and
  -- must be stated wherever absorption is rendered. NULL where no snapshot
  -- exists, never a guess.
  base AS (
    SELECT DISTINCT ON (s.company_token)
      s.company_token AS tok, s.open_roles AS l0
    FROM public.job_board_company_snapshots s
    JOIN toks ON toks.tok = s.company_token
    WHERE s.snapshot_date >= (now() - interval '90 days')::date
    ORDER BY s.company_token, s.snapshot_date ASC
  )
  SELECT
    t.tok                                        AS company_token,
    COALESCE(e.n14, 0)                           AS n_at_risk_14,
    COALESCE(e.fills14, 0)                       AS fills_le_14,
    round(e.r14, 4)                              AS fill_rate_14,
    round(e.r_lo, 4)                             AS fill_rate_14_lo,
    round(e.r_hi, 4)                             AS fill_rate_14_hi,
    round(e.x14, 4)                              AS relist_rate_14,
    round(e.s14, 4)                              AS still_open_14,
    round(e.r7, 4)                               AS fill_rate_7,
    round(e.r30, 4)                              AS fill_rate_30,
    e.med::numeric                               AS median_days_to_fill,
    (e.med IS NULL)                              AS median_censored,
    round(c.d_n::numeric / NULLIF(c.d_n + c.u_n, 0), 4) AS dated_coverage,
    COALESCE(c.d_n, 0)                           AS dated_n,
    COALESCE(c.u_n, 0)                           AS undated_n,
    COALESCE(o.n, 0)                             AS open_roles,
    COALESCE(c.f90, 0)                           AS fills_90d,
    COALESCE(c.r90, 0)                           AS relists_90d,
    COALESCE(c.a90, 0)                           AS ageouts_90d,
    round(c.f90::numeric / NULLIF(c.f90 + c.r90 + c.a90 + c.lstar, 0), 4) AS fill_through,
    round(c.r90::numeric / NULLIF(c.f90 + c.r90, 0), 4) AS churn,
    round((COALESCE(o.n, 0) - b.l0)::numeric / GREATEST(b.l0, 1), 4) AS absorption,
    sp.days                                      AS tracking_days,
    -- The contract's three conditions, plus one it did not have. The extra
    -- clause -- observed relists at or before day 14 must not outnumber the
    -- fills there -- is a PARTIAL guard against the collector's relist dedupe
    -- (see the header), measured on the same counts the estimate is built from:
    -- a
    -- deduped relist is deleted from job_board_postings with no closure row and
    -- no exit row, so it leaves the risk set entirely instead of accruing as a
    -- competing event, which biases fill_rate_14 UP. It is a partial guard and
    -- not a fix: the suppressed rows are exactly the ones we cannot see, so an
    -- employer whose relists are concentrated in a few titles passes this test
    -- while hiding the most mass. It catches the cases where the floor we CAN
    -- see is already damning, and the honest repair is upstream in the
    -- collector.
    (COALESCE(e.n14, 0) >= 25
       AND COALESCE(e.fills14, 0) >= 5
       AND (e.r_hi - e.r_lo) / 2 <= 0.15
       AND COALESCE(e.relists14, 0) <= COALESCE(e.fills14, 0)) AS sufficient
  FROM toks t
  LEFT JOIN bounds   e  ON e.tok  = t.tok
  LEFT JOIN counts   c  ON c.tok  = t.tok
  LEFT JOIN open_now o  ON o.tok  = t.tok
  LEFT JOIN span     sp ON sp.tok = t.tok
  LEFT JOIN base     b  ON b.tok  = t.tok;
$$;
COMMENT ON FUNCTION public.get_company_fill_curve(text[]) IS
  'Per-employer Aalen-Johansen cumulative incidence of FILL, with RELIST as a '
  'competing event and age-outs plus still-live roles as right-censored '
  'observations. COHORT: the risk set is selected on ORIGIN -- a posting is an '
  'observation when the employer stated a post date and that date falls inside '
  'the trailing 90 days -- so all three arms draw from one population and '
  'R(14) does not move with the length of the window. Selecting fills on their '
  'exit time while taking live roles from a single instant of the board matched '
  '90 days of events against one day of still-open observations and returned '
  '0.4390 on data whose true rate was 0.5000, with the truth outside its own '
  'published interval. The _90d COUNT columns are deliberately NOT cohort-'
  'scoped; they are named for a window of events and remain one. DATE BASIS: '
  'every duration is measured from the employer''s stated posted_at ALONE, '
  'never coalesced with our first_seen; undated postings contribute to counts '
  'only and their share is published as dated_coverage (deliberately NOT part '
  'of `sufficient` -- the caller renders plain at 0.60 and above, with a '
  'coverage qualifier between 0.30 and 0.60, and suppresses below 0.30). '
  'dated_coverage is measured over the WHOLE risk-set population including '
  'exit-ledger rows, so the age-out arm''s missing origins (job_board_exits.'
  'posted_at is stamped only from 2026-09-06 and cannot be backfilled -- the '
  'postings were hard-deleted) show up as LOW COVERAGE and the renderer '
  'suppresses, instead of hiding behind a coverage of 1.0000 while the hazard '
  'runs high. fill_rate_14 IS AN UPPER BOUND, not a point estimate, on any '
  'employer that relists: the collector logs one superseded closure per title '
  'per 24h and DELETES the deduped postings outright, so those competing events '
  'are absent from the risk set rather than counted in it. relist_rate_14, '
  'relists_90d and churn are the matching FLOORS and must render with an "at '
  'least" qualifier. fill_rate_14_lo/hi ARE AN APPROXIMATION, not an exact '
  'interval: Greenwood complementary log-log bounds on S are carried across to '
  'R by the observed fill share, which is exact only if that share is constant '
  'over t. median_days_to_fill is min{t <= 30 : R(t) >= 0.5} -- the median of '
  'the FILL cumulative incidence, NOT of all-cause survival, which is a '
  'deliberate departure from the frozen contract because S falls on relists as '
  'well as fills and the survival form published a 4-day "fill median" beside a '
  '10 per cent fill rate. It is NULL with median_censored TRUE whenever the fill '
  'incidence has not reached one half inside 30 days, which is most employers; '
  'render that as "more than 30 days" and never as a number, and render the '
  'number itself as "half of these roles are FILLED by day N". CENSORING SET: '
  'exit_reason aged_out, board_dormant and untracked; ''removed'' is excluded '
  'because it mirrors every closure row and would double-count each fill, and '
  '''backdated'' is excluded because those postings are left-truncated and would '
  'inflate the risk set with observations that cannot produce an event. '
  'ageouts_90d counts ''aged_out'' alone. FEED-DARK: a batch the collector '
  'stamped suspect, and any unstamped (company_token, closed_at) batch that '
  'removed more than max(5, 0.30 x the board size AT THE TIME, from the newest '
  'company snapshot at or before that day), is CENSORED rather than deleted -- '
  'it is our collection failing, not the employer, so the observations stay in '
  'the risk set and count in NONE of fills_90d, relists_90d or ageouts_90d. '
  'THE AGE-OUT ARM IS CENSORED ON THE SAME VERDICT AS OF 2026-09-08, and was '
  'not before: job_board_exits carries no suspect column and no batch alibi, so '
  'ageouts_90d was the one count in this function outside the feed-dark policy, '
  'and any caller dividing it by the three together published a share inflated '
  'toward the accusation (33% where the truth was 20% on the worked example in '
  'that migration''s header). It is reachable exactly, not approximately: one '
  'board pass writes a single instant as closed_at on its takedowns and as '
  'exited_at on its age-outs, so (company_token, exited_at) IS the closure '
  'batch key. A pass whose vanished set is age-outs ALONE writes no closure row '
  'and cannot be judged from here; that residual over-counts age-outs. Where no '
  'snapshot survives (they are pruned at 35 days, the unstamped era is about 54) '
  'the fallback is today''s served count with the absolute floor RAISED TO 25, '
  'because in that region a wind-down and a dark feed are indistinguishable and '
  'over-deleting removes the best-evidenced employers first. `sufficient` is the '
  'contract''s three conditions plus a fourth: observed relists at or before day '
  '14 must not outnumber observed fills there. absorption is the change in served open roles since '
  'the earliest company snapshot inside the window -- algebraically the same as '
  'openings minus fills, relists and age-outs, but computable, because arrivals '
  'are not logged; snapshots are pruned at 35 days, so its basis is shorter than '
  '90 days and NULL where no snapshot survives. fill_through''s L* term counts '
  'live roles at least 14 days old by effective_posted, a MEMBERSHIP test rather '
  'than a published duration, so that its numerator and denominator come from '
  'one sample. SECURITY DEFINER is not decoration: job_board_closures lost its '
  'public SELECT policy and job_board_exits never had one, so an INVOKER version '
  'would answer 200 with empty aggregates and publish silence as a fact.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'It is excluded from the risk set, from both feed-dark verdicts (the '
  'batch sizer and bad_batch, which the age-out arm censors on), and from '
  'tracking_days -- where admitting it would hand an employer we have '
  'watched for months a span of one day, its board''s first lap having '
  'produced its first logged closure this morning.';
GRANT EXECUTE ON FUNCTION public.get_company_fill_curve(text[]) TO anon, authenticated, service_role;

