-- A GATE MADE OF WIDTH ALONE ADMITS A BOARD THAT SHOWED US NOTHING.
--
-- 20260909217000 published S(30) -- the share of a dated cohort still
-- advertised when it reached our 30-day cap -- behind a sufficiency test made
-- of four terms: a floor on the risk set, a ceiling on the interval's
-- half-width, the R + X + S identity, and an admitted observability bucket.
-- Every one of those terms passes VACUOUSLY on a board whose cohort produced
-- no events at all. A curve with no events has zero Greenwood variance, so the
-- half-width is exactly zero; S is exactly one, so the identity is 0 + 0 + 1;
-- and the risk set is the whole cohort, so the floor is cleared by the boards
-- that clear it by the widest margin. The test has no POSITIVE CONTROL: no
-- term requires the estimator to have seen anything happen.
--
-- REPRODUCED LIVE 2026-09-25T21:40:43Z to 21:44:27Z, anon key, every one of
-- the 44,379 catalogue tokens walked through this function in chunks of 200,
-- zero failed chunks. That walk is the single basis for every count in this
-- file and in its COMMENT ON; an earlier survey reported 73 boards and a
-- third reading 30,182 postings, and neither is quoted here, because a figure
-- stored in a function's contract is the one that gets quoted back and it may
-- have exactly one basis (project_stat_provenance):
--
--   dominos                  S30=1.000 CI[1,1] R30=0 n_at_risk_30=21,710
--                            ageouts_at_30=21,710 fills_90d=0 sufficient=FALSE
--                            sufficient_30=TRUE  bucket=lap_proven
--   oreillyauto~wd1~oreilly  S30=1.000 CI[1,1] R30=0 n_at_risk_30=3,983
--                            sufficient_30=TRUE  bucket=lap_proven
--   dollartree~wd5~dollartreeus
--                            S30=1.000 CI[1,1] R30=0 n_at_risk_30=3,619
--                            sufficient_30=TRUE  bucket=lap_proven
--   workday~wd5~Workday      S30=0.550 CI[0.496,0.601] R30=0.421 n=115  -- fine
--
-- 71 boards holding 33,460 live postings printed still_open_30 = 1.0000 with
-- a zero-width interval and sufficient_30 true, out of 30,879 boards carrying
-- a day-30 figure at all and 2,730 whose sufficient_30 was true.
-- EVERY ONE OF THEM had exactly zero events inside the day-30 cohort: a
-- zero-width interval is only reachable when S is exactly 1, and S is exactly
-- 1 only when no fill and no relist landed at any day at or before the cap.
-- 67 of the 71 sit in the full_read bucket and 4 in lap_proven, so the
-- observability gate is not the leak -- it answers a different question (can
-- this board's takedowns be seen AT ALL) from the one the figure needs
-- answered (did this cohort's takedowns get seen).
--
-- WHY THE HALF-WIDTH TERM CANNOT BE THE POSITIVE CONTROL, in one line of
-- algebra. For a cohort of N with D events, Greenwood's v on the
-- complementary log-log scale is about 1/D -- N cancels -- so the interval's
-- RELATIVE precision is 1/sqrt(D), while its ABSOLUTE half-width is about
-- (1 - S) * sinh(1.96 / sqrt(D)) and collapses to zero as S approaches 1 no
-- matter how few events produced it. Worked on the shape this defect lives in:
-- a 21,710-observation cohort with ONE event publishes 0.99995 with a
-- half-width of 0.0002; with five events, 0.99977 and 0.0002. An absolute
-- width test is blind in exactly the corner where the sentence it licenses is
-- most damning, which is why the day-14 gate beside it carries a floor on
-- OBSERVED FILLS and this one had nothing.
--
-- THE FIX: THE COHORT'S OWN EVENTS. sufficient_30 now also requires the
-- day-30 cohort to have produced at least five events of the kind that MOVE
-- the published figure -- fills and relists together, since S falls on both --
-- counted inside the same cohort the figure reports on, at days at or before
-- the cap. The count is published as events_30 so the gate can be checked
-- rather than trusted, exactly as sum_check_30 publishes the identity.
--
-- WHAT IS DELIBERATELY NOT IN THE COUNT.
--   * AGE-OUTS. Our own sweep's takedown at the cap is OUR action, never an
--     employer event -- this file has said so since it was written, and
--     ageouts_at_30 exists to keep them separate. Counting them would rebuild
--     the tautology one level down: Domino's would clear a five-event floor
--     with 21,710 of them.
--   * EVENTS FROM A SUSPECT OR FEED-DARK BATCH. They are already censored out
--     of the fill and relist counters upstream, so a collection failure cannot
--     buy a board its way through this gate.
--   * THE 90-DAY EVENT COUNTS. fills_90d and relists_90d are named for a
--     WINDOW OF EVENTS and are a different population from the day-30 cohort;
--     substituting one for the other is the error feedback_measure_like_with_
--     like exists to stop. Measured, not argued: 42 of the 71 offenders have
--     events in the 90-day window and none in the cohort. aresmgmt~wd1~External
--     has 171 fills and 25 relists in 90 days and produced NOTHING inside the
--     cohort; a 90-day floor would have waved it through printing 100%.
--   * A REQUIREMENT THAT taken_down_30 BE POSITIVE. That is a tautology, not a
--     control: S = 1 implies R = 0, so it refuses only the exactly-degenerate
--     board and says nothing about the one with a single event in 20,000.
--
-- THE FLOOR IS A FLOOR AND NOT THE CONTROL. An ABSOLUTE count moves the
-- threshold from zero events to five and leaves the mechanism the paragraph
-- above diagnoses fully open, because the defect is RELATIVE: the same algebra
-- that refuses the width term refuses a flat count. A cohort of 20,000 with
-- five events publishes 0.9998 with a half-width of 0.00025, which the
-- renderer rounds to a hundred per cent with an interval of zero points --
-- the sentence this file exists to stop, one batch deeper. So the gate
-- carries a SECOND term, on the precision the sentence actually claims:
--
--   the published half-width, divided by the complement the sentence is
--   about, must not exceed a named ratio.
--
-- The complement is what the sentence asserts -- at most this share came down
-- -- so a half-width of the same size as it says nothing about it. The ratio
-- is about 1/sqrt(D) in the regime where S is near one, which is precisely
-- the quantity the absolute width cannot see.
--
-- CALIBRATED AGAINST THE LIVE DISTRIBUTION, not chosen. On the same
-- 2026-09-25T21:40Z walk, over the 2,659 boards whose sufficient_30 was true
-- and whose S was below one, that ratio runs p50 0.3281, p75 0.5611, p90
-- 0.9165, p95 1.2789, max 3.3952 -- and the maximum is the one-event limit,
-- approached by boards with a single observed event. The eighteen live fields
-- on 2026-09-25T21:33Z run 0.0045 (other) to 0.0295 (design), so the field
-- grain clears the bar chosen below by a factor of about seventeen at its
-- worst. The bar is set at one half: it pins the complement to within roughly
-- a factor of two, it refuses the five-events-in-twenty-thousand shape (0.993)
-- and the single-requisition shape (0.98), and it admits the healthy board in
-- the fixtures (0.282). Posting-weighted, it keeps 79.91% of the live postings
-- and 76.74% of the day-30 risk mass that sufficient_30 admits today.
--
-- WHAT THE TWO TERMS DO SEPARATELY, stated because they are not the same
-- test wearing two hats. In combination with the half-width ceiling already
-- here, the ratio bar cannot be cleared below about fifteen events at any
-- cohort size, so the events floor is NOT the binding term for PUBLISHING a
-- figure. Its job is the other one: it is the per-board admission test the
-- field grain applies before pooling (20260925163842), where the question is
-- not how precise this board's own estimate is but whether this board has
-- shown us anything at all in the field its mass is about to join. Both are
-- kept, and the file says which does which rather than leaving a reader to
-- assume a floor is load-bearing where it is not.
--
-- AND THE COHORT'S EVENTS ARE SPLIT, NOT POOLED, in what is published. S(30)
-- falls on a fill and on a relist alike, so the events count that gates it is
-- their sum. taken_down_30 and relist_rate_30 are NOT that quantity: they are
-- a fill rate and a relist rate, published from the same row under the same
-- boolean, and a cohort whose only events are relists prints taken_down_30 =
-- 0.0000 as a measured figure while nothing was ever seen to come down for
-- good. The day-14 gate beside this one refuses that shape twice over, with a
-- floor on fills alone and a ceiling on relists against fills; the day-30 gate
-- had neither. Both are added here, counted on the day-30 cohort, and the
-- counts are published separately as fills_30 and relists_30 so a reader can
-- see which of them carried the gate. A single requisition relisted five times
-- -- exactly what the collector's one-superseded-closure-per-title-per-24h
-- rule emits -- is five events, zero fills, and is now refused.

-- EVERY OTHER TERM AND EVERY OTHER COLUMN IS UNCHANGED, byte for byte: this is
-- a gate change, not a rewrite. The cohort floor, the observability gate, the
-- estimator chains, the day-14 figures and the 90-day counts are the text
-- 20260909217000 shipped. MIGRATIONS ARE IMMUTABLE, so that file is untouched
-- and this one re-issues the function; the guards that pin the live definition
-- follow the function here.
--
-- One function per file, for the OUT-parameter guard's sake. The observability
-- table's DDL is repeated below in the same IF NOT EXISTS form for the same
-- reason it is repeated in 20260909217000: a LANGUAGE sql body is validated at
-- CREATE time, so the table this function reads must exist when it runs.
-- 20260925163842 carries the field grain. No index is added and no existing
-- table is rewritten.

SET LOCAL statement_timeout = '5min';

-- ── the observability table, created here because the function below reads it ──
--
-- 20260909217800 owns this table -- its COMMENT, its grants' rationale and the
-- refresh that writes it -- and this file sorts AFTER it, so on a database
-- built from the whole migration set the block below is a no-op. It is
-- repeated anyway, in the identical IF NOT EXISTS form, because a LANGUAGE
-- sql body is validated at CREATE time and this file is also applied against
-- SUBSETS of the set: every guard in src/test that boots this function in
-- pglite loads it without 217800, and a re-issue that cannot be loaded alone
-- is a re-issue nothing can test. Until 217800's refresh has run the table is
-- empty, and an empty table admits nothing: every day-30 column is NULL,
-- which is the safe direction.
CREATE TABLE IF NOT EXISTS public.job_board_board_observability (
  company_token text PRIMARY KEY,
  bucket        text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
  lap_w0        timestamptz,
  as_of         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_board_board_observability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_board_board_observability FROM anon, authenticated;
GRANT ALL ON public.job_board_board_observability TO service_role;

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
       AND p.proname = 'get_company_fill_curve'
  LOOP
    RAISE NOTICE 'dropping % ahead of its re-issue with the day-30 columns', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

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
  sufficient          boolean,
  observability_bucket text,
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
  relists_30          int
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
  -- ── day-30 constants, named once ─────────────────────────────────────────
  -- EXITS_ORIGIN_STAMPED_FROM: job_board_exits.posted_at is stamped only from
  -- this date (20260906090000) and the rows before it were hard-deleted, so no
  -- age-out logged earlier carries an origin. A posting that reached the cap
  -- before this date is therefore ABSENT from the censored arm, not censored
  -- in it, and any day-30 cohort that reaches back past (this date - 30) is
  -- missing exactly the observations that did not close. The floor below is
  -- GREATEST(the day after the 90-day window opened, that - 30d): it binds
  -- today and stops binding by itself on the day the window edge passes it,
  -- with no edit.
  -- THE DAY-30 SUFFICIENCY GATE, NAMED ONCE. The risk-set floor and the
  -- absolute half-width ceiling are the model's own thresholds at this
  -- horizon. The three added by 20260925163517 are the positive control: a
  -- floor on the cohort's own events, a floor on its FILLS alone (S falls on a
  -- relist too, but taken_down_30 is a fill rate and is published under the
  -- same boolean), and a ceiling on the half-width RELATIVE to the complement
  -- the sentence asserts -- the term the absolute ceiling cannot express,
  -- because absolute width collapses as S approaches one however few events
  -- produced it. The relist-against-fill balance is the day-14 gate's fourth
  -- term, re-counted here; it needs no threshold of its own.
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
  -- AND THE COHORT LIVES INSIDE THE EVENT WINDOW: the closure and exit arms
  -- are cut on closed_at / exited_at >= now() - 90 days, so from_d is the
  -- first whole day AFTER that edge (strictly later than the timestamp, which
  -- puts every event of every member inside the window). The field curve
  -- (20260909217500) derives the same edge from its p_days, so the two grains
  -- print the same cohort_from for the same day.
  cohort30 AS (
    SELECT GREATEST((now() - interval '90 days')::date + 1,
                    (SELECT kk.exits_origin_stamped_from FROM k kk) - 30) AS from_d,
           current_date - 30                                              AS to_d
  ),
  -- THE OBSERVABILITY GATE. A windowed board with no proven lap has S(30) = 1
  -- BY CONSTRUCTION: we cannot see its takedowns, so every posting "ages out"
  -- and the estimator reports an employer that never takes anything down.
  -- job_board_board_observability is the bucket refresh_closure_population()
  -- already computes, materialised per board; only full_read and lap_proven
  -- can prove an absence, so only those may carry a day-30 figure. No row
  -- (a board not observed in the last seven days, or the table not yet
  -- refreshed) is NOT admitted, which is the safe direction.
  obs AS (
    SELECT o.company_token AS tok,
           o.bucket,
           (o.bucket IN ('full_read', 'lap_proven')) AS admitted
    FROM public.job_board_board_observability o
    JOIN toks ON toks.tok = o.company_token
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
      (c.posted_at IS NOT NULL
        AND c.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND c.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
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
      (e.posted_at IS NOT NULL
        AND e.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND e.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
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
      (p.posted_at IS NOT NULL
        AND p.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND p.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
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
      r.tok,
      r.tt,
      sum(r.is_fill)::int   AS d_fill,
      sum(r.is_relist)::int AS d_relist,
      sum(r.is_ageout)::int AS d_ageout,
      count(*)::int         AS cnt
    FROM raw r
    WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0
    GROUP BY r.tok, r.tt
  ),
  curve30 AS (
    SELECT
      a.tok, a.tt, a.d_fill, a.d_relist, a.d_ageout, a.cnt,
      (a.d_fill + a.d_relist) AS d,
      (sum(a.cnt) OVER (
        PARTITION BY a.tok ORDER BY a.tt DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ))::int AS n
    FROM agg30 a
  ),
  surv30 AS (
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
    FROM curve30 c
  ),
  lagged30 AS (
    SELECT s.*, lag(s.s, 1, 1.0) OVER (PARTITION BY s.tok ORDER BY s.tt) AS s_prev
    FROM surv30 s
  ),
  cum30 AS (
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
      c.tok,
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
    GROUP BY c.tok
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
       AND COALESCE(e.relists14, 0) <= COALESCE(e.fills14, 0)) AS sufficient,
    -- ── still advertised at day 30 ───────────────────────────────────────────
    -- NULL, NOT 1.0, OFF AN ADMITTED BUCKET. Every figure here is an honest
    -- answer only where absence is observable; elsewhere the absence of a
    -- number is the answer. observability_bucket says which case this is.
    ob.bucket                                            AS observability_bucket,
    CASE WHEN ob.admitted THEN round(e30.s30, 4)    END  AS still_open_30,
    CASE WHEN ob.admitted THEN round(e30.s30_lo, 4) END  AS still_open_30_lo,
    CASE WHEN ob.admitted THEN round(e30.s30_hi, 4) END  AS still_open_30_hi,
    CASE WHEN ob.admitted THEN round(e30.r30, 4)    END  AS taken_down_30,
    CASE WHEN ob.admitted THEN round(e30.x30, 4)    END  AS relist_rate_30,
    CASE WHEN ob.admitted THEN e30.n30              END  AS n_at_risk_30,
    CASE WHEN ob.admitted THEN e30.ageouts30        END  AS ageouts_at_30,
    CASE WHEN ob.admitted THEN round(e30.r30 + e30.x30 + e30.s30, 6) END AS sum_check_30,
    (SELECT h.from_d FROM cohort30 h)                    AS cohort_from,
    (SELECT h.to_d   FROM cohort30 h)                    AS cohort_to,
    -- THE POSITIVE CONTROL SITS INSIDE THE SAME BOOLEAN AS THE TERMS IT
    -- REPAIRS, so no caller can read a gate that is missing one of them. The
    -- relative term divides by the complement, which is zero exactly when S is
    -- one; that case is already refused by the events floor above it (S is one
    -- only when no fill and no relist landed at or before the cap, so the
    -- cohort produced nothing), and the two terms are written in that order so
    -- the division is never the thing doing the refusing.
    COALESCE(ob.admitted
       AND COALESCE(e30.n30, 0) >= (SELECT kk.min_n_at_risk_30 FROM k kk)
       AND COALESCE(e30.events30, 0) >= (SELECT kk.min_events_30 FROM k kk)
       AND COALESCE(e30.fills30, 0) >= (SELECT kk.min_fills_30 FROM k kk)
       AND COALESCE(e30.relists30, 0) <= COALESCE(e30.fills30, 0)
       AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_half_width_30 FROM k kk)
       AND (e30.s30_hi - e30.s30_lo) / 2 <= (SELECT kk.max_rel_half_width_30 FROM k kk) * (1 - e30.s30)
       AND abs(e30.r30 + e30.x30 + e30.s30 - 1) <= 0.000001, false) AS sufficient_30,
    -- THE COUNT THE POSITIVE CONTROL IS BUILT FROM, PUBLISHED. sum_check_30 is
    -- here because an identity asserted is an identity nobody checked; the same
    -- reasoning applies to a gate. A reader -- or a verifier walking the
    -- catalogue with the anon key -- can now see how many events of the
    -- employer's own the estimate rests on instead of inferring it from the
    -- risk set and the share, which is what this defect cost one measurement.
    -- Our sweep's takedowns at the cap are NOT in it; they are ageouts_at_30.
    CASE WHEN ob.admitted THEN e30.events30 END           AS events_30,
    -- SPLIT, because the two are not interchangeable in what they license. A
    -- cohort whose events are all relists publishes taken_down_30 = 0.0000,
    -- and a reader handed only their sum cannot tell that from a cohort that
    -- genuinely saw nothing come down for good.
    CASE WHEN ob.admitted THEN e30.fills30   END           AS fills_30,
    CASE WHEN ob.admitted THEN e30.relists30 END           AS relists_30
  FROM toks t
  LEFT JOIN bounds   e  ON e.tok  = t.tok
  LEFT JOIN counts   c  ON c.tok  = t.tok
  LEFT JOIN open_now o  ON o.tok  = t.tok
  LEFT JOIN span     sp ON sp.tok = t.tok
  LEFT JOIN base     b  ON b.tok  = t.tok
  LEFT JOIN bounds30 e30 ON e30.tok = t.tok
  LEFT JOIN obs      ob ON ob.tok  = t.tok;
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
  'produced its first logged closure this morning.'
  ' STILL ADVERTISED AT DAY 30 (still_open_30 and its siblings, added '
  '20260909217000). S(30) from the same Aalen-Johansen estimator over a SECOND '
  'cohort: postings with a stated posted_at in [cohort_from, cohort_to], where '
  'cohort_to is thirty days ago (so every member had the full thirty days to '
  'be watched) and cohort_from is GREATEST(the first whole day after now() - '
  '90 days, 2026-08-07) -- inside the same event window as the closure and '
  'exit arms, so no member can have a takedown the window cannot see. The '
  '2026-08-07 floor: '
  'job_board_exits.posted_at is stamped only from 2026-09-06, so no age-out '
  'logged earlier carries an origin and cohorts posted before 2026-08-07 are '
  'missing exactly the roles that did not close. The floor retires itself. '
  'still_open_30 is the share of that cohort still advertised when it reached '
  'our 30-day cap; taken_down_30 is the share taken down for good (R(30), a '
  'CEILING for the same relist-dedupe reason as fill_rate_14 and NOT '
  'fill_rate_30, which runs over the day-14 cohort and no gate); '
  'relist_rate_30 is the share re-listed (a FLOOR). sum_check_30 is R + X + S '
  'and is published so the identity is checked rather than asserted; '
  'sufficient_30 requires it within 1e-6, n_at_risk_30 >= 25 and a '
  'complementary-log-log half-width on S within 0.15. ageouts_at_30 counts, '
  'among the observations at risk at day 30, the ones OUR sweep took down at '
  'the cap -- our action, never an employer event. '
  'OBSERVABILITY GATE: every day-30 column is NULL -- not 1.0 -- unless '
  'observability_bucket is full_read or lap_proven, read from '
  'job_board_board_observability as refresh_closure_population() last wrote '
  'it. A windowed board with no proven lap has S(30) = 1 by construction, '
  'because its takedowns are invisible and every posting ages out. '
  'POSITIVE CONTROL (20260925163517): sufficient_30 carries THREE terms the '
  'original gate did not. (1) The day-30 cohort must have produced at least '
  'five events of its own -- fills plus relists, the events that move S -- '
  'published as events_30. (2) It must have produced at least five FILLS, and '
  'its relists must not outnumber them, published as fills_30 and relists_30: '
  'taken_down_30 and relist_rate_30 are a fill rate and a relist rate issued '
  'under this same boolean, and a cohort whose only events are relists prints '
  'taken_down_30 = 0.0000 as a measured figure. These are the day-14 gate''s '
  'own two terms, re-counted on this cohort. (3) The half-width must not exceed '
  'half of the complement (1 - still_open_30) the sentence asserts. Without (1) '
  'the test was four terms that all pass VACUOUSLY on a cohort with no events: '
  'zero Greenwood variance makes the half-width exactly zero, S is exactly one '
  'so the identity is 0 + 0 + 1, and the risk-set floor is cleared most easily '
  'by the boards that never lose an observation. Without (3) it passed one '
  'batch above that: a 20,000-observation cohort with five events publishes '
  '0.9998 with a half-width of 0.00025, which renders as a hundred per cent '
  'with an interval of zero points. Greenwood v on the complementary log-log '
  'scale is about 1/D, so precision is RELATIVE (1/sqrt(D)) while the published '
  'width is ABSOLUTE and collapses as S approaches one -- which is why no '
  'absolute bar and no flat count can do (3)''s job. MEASURED, one walk, one '
  'basis: 2026-09-25T21:40:43Z to 21:44:27Z, all 44,379 catalogue tokens, zero '
  'failed chunks -- 30,879 boards carried a day-30 figure, 2,730 had '
  'sufficient_30 true, and 71 of those (33,460 live postings; 67 full_read, 4 '
  'lap_proven) published still_open_30 = 1.0000 with a zero-width interval. '
  'The relative bar was calibrated on that walk: over the 2,659 gated boards '
  'with S below one the ratio runs p50 0.3281, p75 0.5611, p90 0.9165, max '
  '3.3952 (the one-event limit), and half keeps 79.91% of the live postings '
  'sufficient_30 admits today. The eighteen live fields ran 0.0045 to 0.0295 '
  'the same day, clearing it by about seventeen times. AGE-OUTS ARE NOT EVENTS '
  'HERE and must never be counted as them: they are our own sweep at the cap '
  '(ageouts_at_30), and admitting them would clear the floor 21,710 times over '
  'on the largest offender. NEITHER ARE fills_90d AND relists_90d: those are a '
  'WINDOW OF EVENTS and the cohort is a different population -- 42 of the 71 '
  'offenders have events in the 90-day window and none inside the cohort, one '
  'of them 171 fills and 25 relists. Events from a suspect or feed-dark batch '
  'are already censored out of both counters upstream, so a collection failure '
  'cannot buy a board through this gate. In combination with the absolute '
  'half-width ceiling the relative bar cannot be cleared below about fifteen '
  'events at any cohort size, so the events floor is not the binding term for '
  'publishing; its load-bearing use is the per-board admission test the field '
  'grain applies before pooling (20260925163842). '
  'A closure never means hired; a role still advertised at day 30 is not '
  'proof of anything about the employer beyond the fact stated; nothing here '
  'extrapolates past the cap (docs/hiring-health-model.md section 10).';
-- THE REACHABLE SET IS STATED, NOT INHERITED. The catalogue drop above
-- discarded every grant, and a freshly created function carries EXECUTE TO
-- PUBLIC by default -- so a bare GRANT names three roles on top of everyone.
-- That is the defect project_definer_exposure records: 107 of 121 definer
-- functions were anon-callable because a GRANT reads like a restriction and is
-- not one. This function is deliberately anon-callable; PUBLIC is still not
-- the same set as anon, and the difference is spelled out rather than assumed.
REVOKE ALL ON FUNCTION public.get_company_fill_curve(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_fill_curve(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_company_fill_curve(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_fill_curve(text[]) TO anon, authenticated, service_role;

-- Self-verifying: exactly one definition must remain and it must carry the
-- new columns; a migration whose purpose is a new shape must not be able to
-- report success with the old one still standing beside it.
DO $$
DECLARE n int; cols text; body text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_company_fill_curve';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_company_fill_curve: expected exactly one definition, found %', n;
  END IF;
  SELECT pg_get_function_result(p.oid) INTO cols
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_company_fill_curve';
  IF cols NOT LIKE '%still_open_30%' OR cols NOT LIKE '%cohort_from%' THEN
    RAISE EXCEPTION 'get_company_fill_curve: re-issued without the day-30 columns: %', cols;
  END IF;
  IF cols NOT LIKE '%events_30%' OR cols NOT LIKE '%fills_30%' OR cols NOT LIKE '%relists_30%' THEN
    RAISE EXCEPTION 'get_company_fill_curve: re-issued without the counts the gate is built from: %', cols;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO body
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_company_fill_curve';
  IF body NOT LIKE '%min_events_30%' OR body NOT LIKE '%min_fills_30%' THEN
    RAISE EXCEPTION 'get_company_fill_curve: re-issued with the day-30 gate still made of width alone';
  END IF;
  -- The relative term is the one an absolute bar cannot express, so it is
  -- checked by name too: a re-issue that keeps the counts and drops it is the
  -- exact regression this file was written against.
  IF body NOT LIKE '%max_rel_half_width_30%' THEN
    RAISE EXCEPTION 'get_company_fill_curve: re-issued with no bar on precision relative to the complement';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
