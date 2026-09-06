-- A MEDIAN FROM A WINDOW THAT CANNOT HOLD ONE.
--
-- Measured live 2026-09-06 over ~600k closures: eighteen categories, from
-- nursing to securities law to retail to ML research, all report a median
-- time-to-fill between 14.9 and 16.3 days. Healthcare 14.9 on 101,638 closures.
-- Finance 15.2 on 39,850. Design 15.2 on 3,775. Legal 15.8. Engineering 16.2.
-- Sales 16.3. At those sample sizes the standard error on each median is well
-- under a day, so eighteen labour markets agreeing to within 1.4 days is not
-- sampling noise -- it is a property of the query, not of the world.
--
-- The support is one week to one month BY CONSTRUCTION. The ingest ages a
-- posting out at a 30-day cap, so nothing can be observed to close later than
-- about 30 days after its stated post date; the read path then deleted every
-- closure that happened in under a week. A median drawn from that interval
-- lands near fifteen days whatever employers do, and the only thing the
-- eighteen numbers have in common is our own retention policy. We published
-- half of our own cap and called it time-to-fill.
--
-- This function replaces it with the same competing-risks estimator the
-- per-employer curve uses -- see the header of 20260906091000 for the
-- derivation, the event taxonomy, why 'backdated' and 'removed' exit rows are
-- thrown away rather than censored, and why the R(14) interval is an
-- approximation. Everything stated there applies here unchanged.
--
-- THE FEED-DARK GUARD RAN IN ITS PER-COMPANY FORM, NOT THE FALLBACK.
--
-- The brief authorised degrading to an absolute bucket threshold in this
-- function if the per-company form could not meet the timeout, on condition
-- that the degradation be stated rather than made quietly. It was not needed
-- and it is not used: the threshold here is per company and per batch, keyed on
-- (company_token, closed_at), which is the collector's real batch key.
--
-- ITS DENOMINATOR IS THE BOARD AS IT WAS, NOT AS IT IS. An earlier draft scored
-- a historic batch against the company's CURRENTLY-served open roles, which
-- deletes exactly the employer that filled a hiring class and then wound its
-- board down: 120 genuine fills logged in one pass 40 days ago, judged against
-- the 8 roles it serves today, clears max(5, 0.30 x 8) and the entire batch is
-- thrown away. job_board_company_snapshots is keyed (company_token,
-- snapshot_date), so the newest snapshot at or before the batch's day is one
-- index seek per BATCH -- not per row -- and it is the contemporaneous board
-- size. Snapshots are pruned at 35 days while the unstamped era runs to about
-- 54, so the oldest part of it has nothing to stand on; there the fallback is
-- today's count with the absolute floor RAISED TO 25. In that region a
-- wind-down and a dark feed are indistinguishable, and with the floor at 5 the
-- 0.30 term only binds above ~17 served roles, so a twelve-role employer
-- closing six in one legitimate pass lost all six.
--
-- AND A FLAGGED BATCH IS CENSORED, NOT DELETED. Both the collector's `suspect`
-- stamp and this proxy identify OUR collection failing rather than the
-- employer's roles ending, so the postings almost certainly did not come down.
-- Removing them from `raw` outright would be the same truncation-as-censoring
-- this function exists to delete, applied to our own outage; instead they stay
-- in the risk set as censored observations and count as neither fill nor
-- relist, so a false positive costs one observation rather than a category's
-- fill record.
--
-- What makes all of this affordable is that the open-roles side is a grouped
-- count served index-only by job_board_postings_token_serving_idx, and that the
-- guard only has to look at rows with batch_live_before NULL -- the collector
-- stamps its own batch now, so the retroactive proxy covers a fixed ~54 days of
-- history and shrinks from here.
--
-- If it ever does miss the budget, the honest repair is to write the fallback
-- AND change this paragraph in the same commit. A documented fallback is fine;
-- a silent one is the defect.
--
-- THE COHORT IS SELECTED ON ORIGIN, WHICH IS WHAT MAKES p_days SAFE TO EXPOSE.
--
-- Gathering fills, relists and age-outs over a window of EXIT times while the
-- live censored arm is a single instant of the board matches p_days worth of
-- events against one day's worth of still-open observations. Measured in pglite
-- on noise-free steady-state data whose true R(14) was exactly 0.5000, that form
-- returned 0.4390 at p_days 90, 0.4138 at 60 and 0.3529 at 30, all with
-- `sufficient` true. A probability that a role is taken down within 14 days of
-- being posted cannot depend on how far back the caller looks, and a function
-- whose whole purpose is to stop publishing an artefact of our own window
-- certainly cannot. Every arm is therefore restricted to postings whose stated
-- posted_at falls inside the window, so one role filled on day 5 and one still
-- live on day 40 each contribute exactly one observation and the answer is
-- window-invariant.
--
-- THE LIVE ARM DOES NOT ASSERT posted_at IS NOT NULL, and must not. It admits
-- undated serving rows so u_n and dated_coverage can be computed, handling the
-- NULL inside the CASE and inside in_cohort. That is why
-- job_board_postings_dated_live_cat_idx is partial on `missing_since IS NULL`
-- ALONE (20260906090000): a partial index is usable only when the query's
-- restrictions IMPLY its predicate, so the earlier `AND posted_at IS NOT NULL`
-- form could never be chosen and this arm full-scanned ~593k serving rows inside
-- the 60s budget while the index charged write amplification for nothing.
--
-- WHY THE SHAPE IS CHEAP. Every observation day is bucketed into [0, 31] before
-- any window function runs -- day 31 means "beyond the published horizon", and
-- since the published horizons are 7, 14 and 30, a censored row parked at 31 is
-- at risk on every day we report exactly as it would be at 400. So each
-- category's window functions run over at most 32 rows, and the cost is the
-- three scans that build them, not the estimator.
--
-- p_min_n GATES WHICH CATEGORIES ARE RETURNED, not whether a returned row is
-- publishable. `sufficient` is the honesty gate from the model and keeps its
-- own thresholds (25 at risk, 5 observed fills, interval half-width within 15
-- points). dated_coverage is returned SEPARATELY and is deliberately NOT part
-- of `sufficient`: the caller renders plain at 0.60 and above, adds the
-- coverage qualifier between 0.30 and 0.60, and suppresses below 0.30.
--
-- THIS NAME HAS EXACTLY ONE ARITY AND MUST KEEP IT. Both parameters have
-- defaults, so a second overload makes every no-argument call an ambiguous
-- PGRST203 -- which is precisely how the old fill-speed RPC went dark on
-- eighteen landing pages on 2026-07-29. Never add a second signature.

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
  'whether a returned row may be published.';

-- Anon-facing: granted, not revoked from PUBLIC. See the note in
-- 20260906091000 -- a PUBLIC-only revoke on a deliberately public function
-- closes nothing and reads as though it had.
GRANT EXECUTE ON FUNCTION public.get_category_fill_curve(int, int) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
