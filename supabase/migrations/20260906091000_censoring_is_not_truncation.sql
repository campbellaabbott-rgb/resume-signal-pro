-- CENSORING IS NOT TRUNCATION, AND A RELIST IS NOT A CENSORED OBSERVATION.
--
-- Live proof of the defect this replaces, measured 2026-09-06:
-- get_company_hiring_health('gici~wd5~Careers') returns closed_90d = 41 next to
-- median_days_to_close = null. The count and the median are computed over
-- different populations inside one CTE and rendered side by side as one fact.
-- Across all eighteen categories the published median sits between 14.9 and
-- 16.3 days, which is not a property of the labour market; it is the midpoint
-- of the only window the old query could see.
--
-- Two structural mistakes produced that number, and both are fixed here.
--
-- FIRST: roles that never closed were ABSENT from the estimator rather than
-- censored in it. A posting that crosses our 30-day serving cap goes to the
-- exit ledger, which no published statistic read. A posting still live is not in
-- the closure log at all. Long-running roles are exactly the ones most likely to
-- be in those two states, so dropping them does not merely lose precision -- it
-- deletes the right tail, which is truncation, and truncation biases the centre
-- of the distribution downward without widening any interval to warn you.
--
-- SECOND: relists were treated as ordinary closures. A relisted posting is
-- evidence that the role did NOT fill. Censoring it asserts that it would have
-- filled at the same rate as everything still at risk, which is precisely
-- backwards. Here it is a COMPETING EVENT: it removes the posting from the risk
-- set and accrues to its own cumulative incidence.
--
-- The estimator is Aalen-Johansen cumulative incidence with two competing
-- causes. At each distinct observation day t_j, with d_fill and d_relist events
-- and n_j observations still at risk (censored-at-t_j count as at risk):
--
--   S(t) = product over t_j <= t of (1 - (d_fill_j + d_relist_j) / n_j)
--   R(t) = sum     over t_j <= t of S(t_{j-1}) * d_fill_j   / n_j
--   X(t) = sum     over t_j <= t of S(t_{j-1}) * d_relist_j / n_j
--
-- and R(t) + X(t) + S(t) = 1 at every t, which is the property the old model
-- lacked in every direction at once. The identity is not asserted here, it is
-- computed: S_j = S_{j-1} * (1 - d_j/n_j) gives S_{j-1} - S_j = S_{j-1}*d_j/n_j,
-- so the running sum R + X telescopes to S(0) - S(t) = 1 - S(t).
--
-- ORIGIN IS THE EMPLOYER'S STATED posted_at, ALONE. Never the coalesce with our
-- first_seen. A role that was up for sixty days before we found it would read as
-- newborn, and the resulting number would describe our crawler rather than the
-- employer. Undated postings contribute to COUNTS only, and their share is
-- published as dated_coverage so the reader can see how much of the employer's
-- board the durations actually cover.
--
-- WHAT IS CENSORED, AND WHAT IS THROWN AWAY.
--
-- The brief specified CAP = every exit-ledger row except exit_reason 'removed'.
-- That is not implemented literally, and the deviation is deliberate. The live
-- vocabulary is ('removed','aged_out','backdated','board_dormant','untracked').
--
--   removed      EXCLUDED. Every closure row is mirrored into the exit ledger
--                with this reason, so admitting them double-counts every fill.
--   backdated    EXCLUDED. A posting whose employer date precedes our first
--                sighting by more than the serving window: measured median
--                tenure 174 days, oldest 8.7 years (20260728130000). Those are
--                LEFT-truncated -- they were never at risk from t = 0 -- and
--                admitting them adds tens of thousands of observations that
--                inflate n_j at every day inside our horizon while being unable
--                to produce an event there. That depresses the hazard and pulls
--                the fill rate DOWN. It is the same truncation-as-censoring
--                mistake this whole change exists to delete, rebuilt in a new
--                place.
--   aged_out     CENSORED. Still advertised when it crossed our serving cap.
--   board_dormant, untracked
--                CENSORED. These are our fetch failing and our dropping a
--                board, not the employer stopping. Their fate is genuinely
--                unknown after that date, which is what censoring means. Note
--                the departure from docs/hiring-health-model.md 3, which files
--                only 'aged_out' under CAP: excluding them would delete
--                observations rather than censor them, which is the bias above.
--                They are excluded from ageouts_90d, which counts 'aged_out'
--                alone, because that column is published as an age-out count.
--
-- FEED-DARK EXCLUSION. A batch the collector marked suspect is dropped. For
-- rows written before the collector stamped its batch -- exactly the rows with
-- batch_live_before NULL -- the read-time proxy applies instead: the collector
-- computes one closed_at per board pass, so (company_token, closed_at) is an
-- exact batch key, and a bucket removing more than max(5, 0.30 x that company's
-- current open roles) is dropped whole. The proxy retires itself as stamped
-- history accumulates.
--
-- THE CONFIDENCE INTERVAL IS AN APPROXIMATION AND SAYS SO. The Aalen-Johansen
-- variance is impractical here; the design called for a nightly bootstrap into
-- a rollup table. That rollup is not built and is no longer wanted. Instead the
-- interval on S is Greenwood on the complementary log-log scale, which stays
-- inside [0,1] at small n, and the interval on R(14) is carried across by the
-- observed fill share f = fills / (fills + relists):
--     R_lo = f * (1 - S_hi),  R_hi = f * (1 - S_lo)
-- exact only when the fill share is constant in t, approximate otherwise. It is
-- labelled an approximation in the COMMENT ON, in docs 4, and it must be
-- labelled wherever it is rendered.
--
-- RELIST FIGURES ARE FLOORS, AND THAT MAKES fill_rate_14 A CEILING.
--
-- The collector logs only the first superseded closure per normalised title per
-- 24h per employer (one live board collapsed the same title 89 times in a day
-- into one row). relist_rate_14, relists_90d and churn are therefore lower
-- bounds and must render with an "at least" qualifier. That much was already
-- known. What was NOT said, and is the more important half: the deduped
-- postings are not merely unlogged, they are DELETED. job-board/index.ts filters
-- `rows` before both the closure insert and the 'removed' exit mirror, and then
-- deletes the unfiltered `chunk` from job_board_postings. A deduped relist
-- therefore leaves no closure row, no exit row and no posting row -- it is
-- absent from the risk set rather than present in it as a competing event,
-- which is exactly the failure mode this whole change exists to delete, one
-- table upstream of the SQL.
--
-- The direction of the resulting error is knowable even though its size is not:
-- removing observations that did NOT fill raises d_j/n_j at every day, so
-- fill_rate_14 is an UPPER BOUND on any employer that relists, and the more it
-- relists the looser the bound. Worked example: 1000 dated postings, 100 real
-- fills at day 5, 800 same-title relists at day 5 across 30 titles (770 of them
-- deduped away), 100 still live. `raw` sees 230 observations and reports
-- R(5) = 0.435 with a half-width of 0.05; the true 14-day fill rate is 0.10.
--
-- Nothing in this file can recover the deleted rows. Two things are done here
-- instead. The COMMENT ON states the ceiling, so no caller can render the
-- number as a point estimate in good faith. And `sufficient` gains a fourth
-- condition -- observed relists must not outnumber observed fills -- which is a
-- partial guard, not a fix: it catches employers whose VISIBLE relist floor is
-- already damning and cannot catch the ones hiding the most mass, because that
-- mass is concentrated in few titles and few titles is precisely what the
-- dedupe collapses. The real repair is in the collector: either stop dropping
-- deduped rows from the ledger, log one row carrying a repeat count, or emit an
-- exit-ledger row for each. Until one of those ships this ceiling stands.
--
-- The R + X + S identity holds arithmetically over the events we LOGGED; it is
-- not evidence that the taxonomy is complete.
--
-- THE COHORT IS SELECTED ON ORIGIN, NOT ON EXIT TIME, AND THE MEDIAN IS THE
-- MEDIAN OF THE FILL CIF. Both corrections are explained at the CTEs that carry
-- them (`raw` and `at_h`). The second is a deliberate departure from the frozen
-- RPC contract, which specified min{t : S(t) <= 0.5}: S falls on relists too, so
-- that form publishes a fill median set by relists next to a near-zero fill
-- rate. The column keeps its name and its type; what changes is that the name is
-- now true. Every renderer of median_days_to_fill must say "half of the roles
-- are FILLED by day N", not "half are off the board by day N", and any API field
-- that mirrors it must move with it.
--
-- WHAT THIS CANNOT FIX. Total lifecycle history is about 54 days, and the
-- serving cap means nothing about lifetimes past 30 days is measurable from
-- this data at any sample size. median_days_to_fill is therefore NULL and
-- median_censored TRUE for most employers today. That is the honest outcome,
-- not a defect: the correct rendering is "more than 30 days", never a number.

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

    UNION ALL

    SELECT
      e.company_token AS tok,
      CASE WHEN e.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (e.exited_at - e.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (e.posted_at IS NOT NULL AND e.posted_at >= now() - interval '90 days') AS in_cohort,
      0 AS is_fill,
      0 AS is_relist,
      CASE WHEN e.exit_reason = 'aged_out' THEN 1 ELSE 0 END AS is_ageout,
      0 AS is_live,
      0 AS is_lstar,
      true AS in_cov,
      (e.posted_at IS NOT NULL) AS dated
    FROM public.job_board_exits e
    JOIN toks ON toks.tok = e.company_token
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
        EXTRACT(DAY FROM now() - (SELECT min(c.closed_at) FROM public.job_board_closures c WHERE c.company_token = t.tok))::int,
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
  'the risk set and count in neither fills_90d nor relists_90d. Where no '
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
  'would answer 200 with empty aggregates and publish silence as a fact.';

-- Anon-facing, so it is granted and NOT revoked from PUBLIC. On a function
-- meant to be public, PUBLIC holding EXECUTE is the same reach anon already
-- has, and a lone REVOKE ... FROM PUBLIC would be security theatre: this
-- database grants EXECUTE to `anon` by name on fresh creations, so revoking
-- the PUBLIC pseudo-role removes nothing a named grant holds. That half-
-- measure is exactly what leaked get_top_search_misses on 2026-08-21, and
-- the guard that records it treats a PUBLIC-only revoke as a claim to have
-- closed something. Nothing here is being closed; every anon-facing RPC in
-- this tree carries the plain GRANT.
GRANT EXECUTE ON FUNCTION public.get_company_fill_curve(text[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
