-- A FILL SHARE COUNTS ONLY ROLES THE BOARD WAS WATCHED FOR (accuracy spec Track 1, A4).
--
-- get_company_fill_curve, re-issued from its live text (20261008110000) with
-- four changes and nothing else:
--
-- 1. DELAYED ENTRY ON BOTH CHAINS. The 14-day chain counted every row as at
--    risk from age 0, so a role first seen at day 9 was credited nine days it
--    never showed us. Simulated on a flat hazard (accuracy spec, 2026-10-11),
--    boards first watched 21, 30, 45 and 60 days ago printed 0.57, 0.65, 0.73
--    and 0.79 of the true 14-day share; 208 of the 337 top boards that passed
--    canStateFillRate had under 60 days of tracking. Now both chains read
--    only rows posted after the board's watch floor, and a row is at risk at
--    day t_j only when it entered before it (entry = its age on the later of
--    its first sighting and the day after the floor):
--    n_j = #{tt >= t_j} - #{entry >= t_j}. The day-30 chain already clipped
--    on the floor; it gets the same entry rule for a late first sighting.
-- 2. THE INTERVAL CONTAINS ITS OWN SHARE, and S(14) = 1 cannot divide by
--    zero: a numeric division by zero raises, and a 25-token batch holding
--    one board with no takedowns (Taco Bell's Paylocity board, Bluelight)
--    would have failed every board in it.
-- 3. HONEST SUFFICIENCY: `sufficient` needs tracking_days >= 21 (28 on a
--    lap_proven board), the floor the page and the shared gate apply.
-- 4. EIGHT COLUMNS, appended so no positional reader moves:
--    multi_site_title_share and multi_site_n (the A2 rule's input, from
--    20261012120000's helper), feed_total, feed_read_at, feed_state and
--    feed_capped (the A3 rule: the newest complete read that states a total,
--    never the day's latest row and never a per-visit stamp),
--    late_sighted_30 (reported only) and undated_open.
--
-- The client reads every new column fail-closed: an absent column is a
-- refusal (src/lib/hiring-record-gate.ts reads multi_site_title_share; the
-- company page reads the feed columns).
--
-- WHO CALLS IT, AND WHY ANON KEEPS EXECUTE: /jobs and /jobs/company/:token
-- call it from the browser as anon for every visible employer (26 tokens a
-- batch), and the Explore employer check does too; get_actively_hiring_companies
-- calls it inside the hourly cache. It is SECURITY DEFINER because
-- job_board_closures and job_board_exits are not client-readable, with
-- search_path pinned. Its census entry ('public.get_company_fill_curve(text[])'
-- on the anon list, 20261012110100) names this same signature.
--
-- Safe to run twice; ends with a self-check that raises.

SET LOCAL statement_timeout = '5min';

-- The tables the body reads, in their owners' IF NOT EXISTS form, so this
-- file loads alone onto the pglite schemas the guards build (a LANGUAGE sql
-- body is validated at CREATE time). On a database built from the whole set
-- each is a no-op, and no owner's grant or row-security line is repeated
-- (an ALTER would take ACCESS EXCLUSIVE on a table the ingest writes).
CREATE TABLE IF NOT EXISTS public.job_board_board_observability (
  company_token text PRIMARY KEY,
  bucket        text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
  lap_w0        timestamptz,
  as_of         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.job_board_board_watch (
  company_token        text PRIMARY KEY,
  first_observed_on    date NOT NULL,
  first_observed_basis text NOT NULL,
  is_censored          boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.job_board_board_state (
  company_token text NOT NULL,
  observed_on   date NOT NULL DEFAULT current_date,
  source        text NOT NULL DEFAULT '',
  observed_at   timestamptz NOT NULL DEFAULT now(),
  live_count    integer,
  stored_count  integer,
  feed_total    integer,
  state         text NOT NULL DEFAULT 'ok',
  PRIMARY KEY (company_token, observed_on)
);

-- THE SHAPE CHANGES, SO THE FUNCTION IS DROPPED FROM THE CATALOGUE FIRST, by
-- enumeration (the live database has held overloads no migration describes).
-- The drop discards the grants; they are re-issued below.
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
    RAISE NOTICE 'dropping % ahead of its re-issue with delayed entry and the feed columns', r.sig;
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
  relists_30          int,
  watched_from        date,
  insufficient_reason_30 text,
  filled_roles_90d    int,
  relisted_roles_90d  int,
  multi_site_title_share numeric,
  multi_site_n        int,
  feed_total          int,
  feed_read_at        timestamptz,
  feed_state          text,
  feed_capped         boolean,
  late_sighted_30     int,
  undated_open        int
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
  --
  -- THE WATCH FLOOR, NAMED ONCE PER BOARD (20261002121417). watched_from is
  -- the last UTC day on which this board's takedowns were NOT yet observable
  -- to us; a role belongs to the day-30 chain only if it was posted on a later
  -- day, so that its whole thirty days were watched. For a full_read board it
  -- is the later of the day we first observed the board at all and the last
  -- day a read of it was cut short. GREATEST ignores the NULL a board with no
  -- truncated read produces, so such a board's floor is its first observed
  -- day. Everything else is NULL and refuses the row:
  --   * lap_proven, because a lap certifies a takedown one to three laps late
  --     and the sweep logs a still-stamped posting that reaches the cap as an
  --     age-out, so a lap board inflates S(30) however long it was watched;
  --   * a full_read board with no watch row, which we cannot date;
  --   * every bucket the gate above already refuses.
  -- The lookup is one seek per board: job_board_board_watch is keyed on the
  -- token and job_board_board_state on (token, day).
  obs AS (
    SELECT o.company_token AS tok,
           o.bucket,
           (o.bucket IN ('full_read', 'lap_proven')) AS admitted,
           CASE WHEN o.bucket = 'full_read' AND bw.first_observed_on IS NOT NULL
                THEN GREATEST(bw.first_observed_on,
                              (SELECT max(bs.observed_on)
                                 FROM public.job_board_board_state bs
                                WHERE bs.company_token = o.company_token
                                  AND bs.state = 'truncated'))
           END AS watched_from
    FROM public.job_board_board_observability o
    JOIN toks ON toks.tok = o.company_token
    LEFT JOIN public.job_board_board_watch bw ON bw.company_token = o.company_token
  ),
  -- Served open roles. BOTH serving predicates, so this matches
  -- /jobs/company/{token} exactly; a count that applied only one of them stated
  -- a bigger number than the board it links to.
  open_now AS (
    SELECT p.company_token AS tok, count(*)::int AS n,
           count(*) FILTER (WHERE p.posted_at IS NULL)::int AS undated
    FROM public.job_board_postings p
    JOIN toks ON toks.tok = p.company_token
    WHERE p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token
  ),
  -- THE BOARD'S OWN TOTAL, FROM THE LAST COMPLETE READ (20261012121000).
  -- job_board_board_state is upserted once per board per day, so the day's
  -- last visit wins: a mid-feed Workday or Oracle visit and an error visit
  -- write feed_total NULL over the total the day's first page stated (540 of
  -- 689 Workday tenants state it only at offset 0). So the total is the newest
  -- row in the last seven days that STATES one and was a complete read (state
  -- ok, or empty for a board whose roles are all older than our window), with
  -- that row's own read time. job_board_verifications.feed_total is never
  -- used: its verified_at moves on every visit, so the pair would print a
  -- weeks-old total as read minutes ago. One index seek per board on the
  -- (token, day) key.
  feed AS (
    SELECT DISTINCT ON (bs.company_token)
           bs.company_token AS tok, bs.feed_total, bs.observed_at, bs.state, bs.source
    FROM public.job_board_board_state bs
    JOIN toks ON toks.tok = bs.company_token
    WHERE bs.observed_on >= current_date - 7
      AND bs.feed_total IS NOT NULL
      AND bs.state IN ('ok', 'empty')
    ORDER BY bs.company_token, bs.observed_on DESC
  ),
  -- THE BOARD'S READ CADENCE, for the late-sighting count only: the median gap
  -- in days between the days we read it over the last thirty (at least one).
  cadence AS (
    SELECT g.tok, GREATEST(percentile_disc(0.5) WITHIN GROUP (ORDER BY g.gap), 1) AS gap_days
    FROM (
      SELECT bs.company_token AS tok,
             bs.observed_on - lag(bs.observed_on) OVER (PARTITION BY bs.company_token ORDER BY bs.observed_on) AS gap
      FROM public.job_board_board_state bs
      JOIN toks ON toks.tok = bs.company_token
      WHERE bs.observed_on >= current_date - 30
    ) g
    WHERE g.gap IS NOT NULL
    GROUP BY g.tok
  ),
  -- How many live rows carry a title that is live at another location on the
  -- same board (20261012120000's helper, the A2 rule's input).
  ms AS (
    SELECT s.company_token AS tok, s.multi_site_title_share, s.multi_site_n
    FROM public.board_multi_site_title_share(p_tokens) s
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
  --
  -- arms IS THAT PASS, HELD ONCE, plus three columns and the rows only the
  -- seen-again test reads (20261008110000): seen_at is the row's instant (a
  -- served role's is its first_seen); kept is false on a lap_backfill closure
  -- and on a backdated exit, which are observations of their posting and
  -- never statistics; bad marks a doubted row. A 'removed' exit is not read:
  -- the collector writes it only beside a closure at the same instant, which
  -- is already here. raw below is arms with the kept rows only, less the
  -- doubted rows whose posting was seen again.
  arms AS MATERIALIZED (
    SELECT
      c.company_token AS tok,
      CASE WHEN c.posted_at IS NOT NULL
           THEN LEAST(ceil(extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0)::int, 31)
      END AS tt,
      (c.posted_at IS NOT NULL AND c.posted_at >= now() - interval '90 days') AS in_cohort,
      (c.posted_at IS NOT NULL
        AND c.posted_at >= (SELECT h.from_d FROM cohort30 h)
        AND c.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,
      -- in_watch30: the row's board was read in full from before the row was
      -- posted. The floor is a DATE and the comparison is against the start
      -- of the following UTC day, so a role posted on the floor day itself --
      -- the day a board was first seen, or the day its last cut-short read
      -- happened -- is outside. NULL anywhere (no floor, no obs row, no date)
      -- is false, the refusing direction. The same expression on all three
      -- arms, because a takedown, an age-out and a still-live role are three
      -- outcomes of one cohort and only the cohort may be clipped.
      COALESCE(c.posted_at >= ((wf.watched_from + 1)::timestamp AT TIME ZONE 'UTC'), false) AS in_watch30,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL OR c.superseded THEN 0 ELSE 1 END AS is_fill,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL THEN 0
           WHEN c.superseded THEN 1 ELSE 0 END AS is_relist,
      0 AS is_ageout,
      0 AS is_live,
      0 AS is_lstar,
      true AS in_cov,
      (c.posted_at IS NOT NULL) AS dated,
      'c'::text AS arm,
      c.posting_id AS pid,
      (COALESCE(c.suspect, false) OR dk.tok IS NOT NULL) AS doubted,
      c.superseded AS sup,
      c.closed_at AS seen_at,
      (c.absence_basis IS DISTINCT FROM 'lap_backfill') AS kept,
      (COALESCE(c.suspect, false) OR dk.tok IS NOT NULL) AS bad,
      CASE WHEN c.posted_at IS NOT NULL
           THEN LEAST(GREATEST(COALESCE(floor(extract(epoch FROM (
                  GREATEST(c.first_seen, ((wf.watched_from + 1)::timestamp AT TIME ZONE 'UTC')) - c.posted_at)) / 86400.0)::int, 0), 0), 31)
      END AS entry_tt,
      COALESCE(c.first_seen > c.posted_at + make_interval(days => COALESCE(cd.gap_days, 1) + 1), false) AS late
    FROM public.job_board_closures c
    JOIN toks ON toks.tok = c.company_token
    -- `dark` is one row per (tok, closed_at) by construction, so this cannot
    -- multiply rows; dk.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    LEFT JOIN obs wf ON wf.tok = c.company_token
    LEFT JOIN cadence cd ON cd.tok = c.company_token
    WHERE c.closed_at >= now() - interval '90 days'

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
      COALESCE(e.posted_at >= ((wf.watched_from + 1)::timestamp AT TIME ZONE 'UTC'), false) AS in_watch30,
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
      (e.posted_at IS NOT NULL) AS dated,
      'e'::text AS arm,
      e.posting_id AS pid,
      false AS doubted,
      false AS sup,
      e.exited_at AS seen_at,
      (e.exit_reason IN ('aged_out', 'board_dormant', 'untracked')) AS kept,
      (bb.tok IS NOT NULL) AS bad,
      CASE WHEN e.posted_at IS NOT NULL
           THEN LEAST(GREATEST(COALESCE(floor(extract(epoch FROM (
                  ((wf.watched_from + 1)::timestamp AT TIME ZONE 'UTC') - e.posted_at)) / 86400.0)::int, 0), 0), 31)
      END AS entry_tt,
      false AS late
    FROM public.job_board_exits e
    JOIN toks ON toks.tok = e.company_token
    -- bad_batch is DISTINCT on (tok, at) by construction, so this cannot
    -- multiply rows; bb.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at
    LEFT JOIN obs wf ON wf.tok = e.company_token
    WHERE e.exited_at >= now() - interval '90 days'
      AND e.exit_reason <> 'removed'

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
      COALESCE(p.posted_at >= ((wf.watched_from + 1)::timestamp AT TIME ZONE 'UTC'), false) AS in_watch30,
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
      (p.posted_at IS NOT NULL) AS dated,
      'p'::text AS arm,
      p.id AS pid,
      false AS doubted,
      false AS sup,
      p.first_seen AS seen_at,
      true AS kept,
      false AS bad,
      CASE WHEN p.posted_at IS NOT NULL
           THEN LEAST(GREATEST(COALESCE(floor(extract(epoch FROM (
                  GREATEST(p.first_seen, ((wf.watched_from + 1)::timestamp AT TIME ZONE 'UTC')) - p.posted_at)) / 86400.0)::int, 0), 0), 31)
      END AS entry_tt,
      COALESCE(p.first_seen > p.posted_at + make_interval(days => COALESCE(cd.gap_days, 1) + 1), false) AS late
    FROM public.job_board_postings p
    JOIN toks ON toks.tok = p.company_token
    LEFT JOIN obs wf ON wf.tok = p.company_token
    LEFT JOIN cadence cd ON cd.tok = p.company_token
    WHERE p.missing_since IS NULL
  ),
  -- A DOUBTED ROW WHOSE POSTING WAS SEEN AGAIN NEVER CAME DOWN (20261008110000).
  -- A doubted row -- a kept closure stamped suspect or caught by the dark
  -- proxy, or a kept age-out logged in a bad batch -- is SEEN AGAIN when its
  -- posting was observed at a later instant: closed again (any basis), exited
  -- again, or stored again (a later first_seen). Such a row leaves the risk
  -- set and the role counts; the later observation already carries the
  -- posting. A doubted row never seen again stays, censored at its instant.
  --
  -- Only a board with a doubted batch (dirty) can hold such a row, so only
  -- its held rows are aggregated: seen_last is the latest observation of each
  -- of its postings that has a doubted row, one row per (board, posting).
  -- raw joins it on that whole key, from a held scan with no sort order of
  -- its own, so the join can never be merged on the board alone with the
  -- posting left as a filter. The scalar seek is the one observation the held
  -- rows cannot make -- a posting stored again and not served now (stamped
  -- missing, or under another board) -- and the CASE reaches it only for a
  -- doubted row that is its posting's latest observation. It is a CASE and
  -- not an OR on purpose: the planner lifts the arm of an OR that names only
  -- arms' columns into a filter below the join, and that copy ran the seek
  -- for every doubted row. The COALESCE is load-bearing: a doubted row whose
  -- posting has no row at all must be KEPT, and NOT (true AND NULL) is NULL,
  -- which a WHERE drops.
  dirty AS (
    SELECT DISTINCT bb.tok FROM bad_batch bb
  ),
  seen_last AS (
    SELECT a.tok, a.pid, max(a.seen_at) AS last_at
    FROM arms a
    WHERE a.tok IN (SELECT d.tok FROM dirty d)
    GROUP BY a.tok, a.pid
    HAVING bool_or(a.bad AND a.kept)
  ),
  raw AS MATERIALIZED (
    SELECT a.tok, a.tt, a.in_cohort, a.in_cohort30, a.in_watch30, a.is_fill, a.is_relist,
           a.is_ageout, a.is_live, a.is_lstar, a.in_cov, a.dated, a.arm, a.pid, a.doubted, a.sup,
           a.entry_tt, a.late
    FROM arms a
    LEFT JOIN seen_last l ON l.tok = a.tok AND l.pid = a.pid
    WHERE a.kept
      AND NOT (a.bad
               AND CASE WHEN l.last_at > a.seen_at THEN true
                        ELSE COALESCE((SELECT p2.first_seen FROM public.job_board_postings p2 WHERE p2.id = a.pid) > a.seen_at, false)
                   END)
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
  -- DELAYED ENTRY ON THE 14-DAY CHAIN (20261012121000). The chain counted
  -- every row as at risk from age 0, so a role first seen at day 9 (a board we
  -- began reading after it was posted, or one we read every few days) was
  -- credited nine days it never showed us, and on boards first watched 21,
  -- 30, 45 and 60 days ago the printed share ran 0.57, 0.65, 0.73 and 0.79 of
  -- the truth (simulated, accuracy spec 2026-10-11). Now:
  --   * only rows posted after the board's watch floor (in_watch30, the same
  --     expression the day-30 chain clips on), so the chain is empty on a
  --     board we cannot date and on every board read in laps, which the
  --     shared gate refuses anyway;
  --   * each row enters at entry_tt, its age on the later of its first
  --     sighting and the day after the watch floor, and is at risk at day t_j
  --     only when entry_tt < t_j <= tt: n_j = #{tt >= t_j} - #{entry >= t_j}.
  --     A row first seen in the same day-interval as its event, or after it,
  --     showed us no exposure and is left out;
  --   * the exit ledger carries no first sighting, so an age-out enters at
  --     the watch floor alone: the residual this cannot close, counted by
  --     late_sighted_30 for the closure and live arms.
  -- agg holds, per board and day, the rows whose clock stops there (cnt, and
  -- their events) and the rows that ENTER there (ent), so a day with only
  -- entries still subtracts them.
  agg AS (
    SELECT x.tok, x.tt,
           sum(x.d_fill)::int   AS d_fill,
           sum(x.d_relist)::int AS d_relist,
           sum(x.cnt)::int      AS cnt,
           sum(x.ent)::int      AS ent
    FROM (
      SELECT r.tok, r.tt, r.is_fill AS d_fill, r.is_relist AS d_relist, 1 AS cnt, 0 AS ent
      FROM raw r
      WHERE r.in_cohort AND r.tt IS NOT NULL AND r.tt >= 0 AND r.in_watch30 AND r.entry_tt < r.tt
      UNION ALL
      SELECT r.tok, r.entry_tt, 0, 0, 0, 1
      FROM raw r
      WHERE r.in_cohort AND r.tt IS NOT NULL AND r.tt >= 0 AND r.in_watch30 AND r.entry_tt < r.tt AND r.entry_tt > 0
    ) x
    GROUP BY x.tok, x.tt
  ),
  -- n_j = observations with t >= t_j, less those that entered at or after
  -- t_j. Censored-at-t_j count as at risk, which is the convention the
  -- survival product assumes. A day that holds only entries can have n = 0
  -- (every row still in view there entered on it); such a day carries no
  -- event (an event row is always at risk on its own day) and multiplies S by
  -- one, so it is left out of the product rather than divided by.
  curve AS (
    SELECT q.* FROM (
      SELECT
        a.tok, a.tt, a.d_fill, a.d_relist, a.cnt,
        (a.d_fill + a.d_relist) AS d,
        ((sum(a.cnt) OVER (
          PARTITION BY a.tok ORDER BY a.tt DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )) - (sum(a.ent) OVER (
          PARTITION BY a.tok ORDER BY a.tt DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )))::int AS n
      FROM agg a
    ) q
    WHERE q.n > 0
  ),
  -- The risk set AT day 14 (and 30 below), over every day including the
  -- entry-only ones the product leaves out.
  risk14 AS (
    SELECT a.tok, COALESCE(sum(a.cnt - a.ent) FILTER (WHERE a.tt >= 14), 0)::int AS n14
    FROM agg a
    GROUP BY a.tok
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
      COALESCE(max(rk.n14), 0)::int AS n14,
      min(c.tt) FILTER (WHERE c.tt <= 30 AND c.r_cif >= 0.5) AS med
    FROM cum c
    LEFT JOIN risk14 rk ON rk.tok = c.tok
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
  -- THE INTERVAL CONTAINS ITS OWN SHARE (20261012121000). The bounds on S
  -- were carried to R by the observed fill share (fills over fills plus
  -- relists, counted), which is not R / (R + X) when relists land early and
  -- fills late, and 7 of 1,319 sampled boards published a share outside its
  -- own interval (NorthwesternMedicine 0.3148 against [0.3156, 0.3308]). Now
  -- the share itself is scaled: R(14) * (1 - S_hi) / (1 - S(14)) and
  -- R(14) * (1 - S_lo) / (1 - S(14)), which hold R(14) between them because
  -- S_lo <= S(14) <= S_hi. When nothing came down by day 14 (S(14) = 1) the
  -- divisor is zero, and a numeric division by zero RAISES in Postgres and
  -- would fail every board in the 25-token batch, so that case is 0 by its
  -- own arm (and NULLIF keeps a later edit from reaching the division).
  bounds AS (
    SELECT
      e.*,
      GREATEST(LEAST(CASE WHEN e.s14 >= 1 THEN 0
                          ELSE e.r14 * (1 - e.s_hi) / NULLIF(1 - e.s14, 0) END, 1), 0) AS r_lo,
      GREATEST(LEAST(CASE WHEN e.s14 >= 1 THEN 0
                          ELSE e.r14 * (1 - e.s_lo) / NULLIF(1 - e.s14, 0) END, 1), 0) AS r_hi
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
  --
  -- AND ONLY OVER WATCHED MEMBERS (20261002121417). The chain runs over the
  -- cohort's rows whose board was read in full from before they were posted.
  -- That is a different risk set from the cohort, which is why the clip is
  -- made HERE, before the product, and not by a later filter: a survival
  -- product cannot be re-cut after the fact. The conjunct is appended to the
  -- end of the WHERE so the cohort clause before it reads as it always has.
  -- Delayed entry on the day-30 chain too, by the same rule as agg above.
  agg30 AS (
    SELECT x.tok, x.tt,
           sum(x.d_fill)::int   AS d_fill,
           sum(x.d_relist)::int AS d_relist,
           sum(x.d_ageout)::int AS d_ageout,
           sum(x.cnt)::int      AS cnt,
           sum(x.ent)::int      AS ent
    FROM (
      SELECT r.tok, r.tt, r.is_fill AS d_fill, r.is_relist AS d_relist, r.is_ageout AS d_ageout, 1 AS cnt, 0 AS ent
      FROM raw r
      WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0 AND r.in_watch30 AND r.entry_tt < r.tt
      UNION ALL
      SELECT r.tok, r.entry_tt, 0, 0, 0, 0, 1
      FROM raw r
      WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0 AND r.in_watch30 AND r.entry_tt < r.tt AND r.entry_tt > 0
    ) x
    GROUP BY x.tok, x.tt
  ),
  curve30 AS (
    SELECT q.* FROM (
      SELECT
        a.tok, a.tt, a.d_fill, a.d_relist, a.d_ageout, a.cnt,
        (a.d_fill + a.d_relist) AS d,
        ((sum(a.cnt) OVER (
          PARTITION BY a.tok ORDER BY a.tt DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )) - (sum(a.ent) OVER (
          PARTITION BY a.tok ORDER BY a.tt DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )))::int AS n
      FROM agg30 a
    ) q
    WHERE q.n > 0
  ),
  risk30 AS (
    SELECT a.tok, COALESCE(sum(a.cnt - a.ent) FILTER (WHERE a.tt >= 30), 0)::int AS n30
    FROM agg30 a
    GROUP BY a.tok
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
      COALESCE(max(rk.n30), 0)::int AS n30,
      COALESCE(sum(c.d_fill)   FILTER (WHERE c.tt <= 30), 0)::int AS fills30,
      COALESCE(sum(c.d_relist) FILTER (WHERE c.tt <= 30), 0)::int AS relists30,
      COALESCE(sum(c.d_fill + c.d_relist) FILTER (WHERE c.tt <= 30), 0)::int AS events30,
      COALESCE(sum(c.d_ageout) FILTER (WHERE c.tt >= 30), 0)::int AS ageouts30
    FROM cum30 c
    LEFT JOIN risk30 rk ON rk.tok = c.tok
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
  -- ONE ROW PER ROLE, NOT PER CLOSURE EVENT (20261008110000). The three
  -- witnesses and the both-sides drop are get_actively_hiring_companies'
  -- (roles / classified); the rows are THIS function's, the closure rows its
  -- risk set kept, so a doubted closure whose posting was seen again is
  -- already gone and does not doubt its role. A role that closed more than
  -- once, was superseded, or is served on its board today (a live row in raw)
  -- came back: it is a re-listed role, never a filled one. A role with a
  -- doubted closure still standing (never seen again) is in neither. filled
  -- is therefore a CEILING (a re-list under a new id is invisible) and
  -- relisted a FLOOR. One hash aggregate over held rows: no lookup per role.
  -- The leaderboard drops a role on ANY doubted closure in the window, seen
  -- again or not, so on a board with dark batches the two can differ; the
  -- COMMENT ON says by how.
  roles AS (
    SELECT r.tok, r.pid,
           count(*) FILTER (WHERE r.arm = 'c')::int AS n_close,
           bool_or(r.sup) AS sup,
           bool_or(r.doubted) AS doubted,
           bool_or(r.arm = 'p') AS live
    FROM raw r
    WHERE r.arm IN ('c', 'p')
    GROUP BY r.tok, r.pid
  ),
  -- Rows of the day-30 cohort, posted while the board was watched, that we
  -- first saw more than one read interval plus a day after their stated
  -- date: the date-validity audit's input (accuracy spec Q3). Reported only.
  late30 AS (
    SELECT r.tok, count(*) FILTER (WHERE r.late)::int AS n
    FROM raw r
    WHERE r.in_cohort30 AND r.in_watch30
    GROUP BY r.tok
  ),
  role_counts AS (
    SELECT ro.tok,
           count(*) FILTER (WHERE ro.n_close = 1 AND NOT ro.doubted AND NOT ro.sup AND NOT ro.live)::int AS filled,
           count(*) FILTER (WHERE ro.n_close > 0 AND NOT ro.doubted AND (ro.n_close > 1 OR ro.sup OR ro.live))::int AS relisted
    FROM roles ro
    GROUP BY ro.tok
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
    -- AND THE TRACKING FLOOR (20261012121000): 21 days of watching, 28 on a
    -- lap_proven board, the floor the page and the shared gate already
    -- applied on their own side. Before it, four lap_proven boards read
    -- sufficient on fewer days than that (accuracy spec, before-bug 15).
    (COALESCE(e.n14, 0) >= 25
       AND COALESCE(e.fills14, 0) >= 5
       AND (e.r_hi - e.r_lo) / 2 <= 0.15
       AND COALESCE(e.relists14, 0) <= COALESCE(e.fills14, 0)
       AND COALESCE(sp.days, 0) >= CASE WHEN ob.bucket = 'lap_proven' THEN 28 ELSE 21 END) AS sufficient,
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
    --
    -- THE WATCH TERM IS READ SECOND, directly after the bucket (20261002121417).
    -- It is redundant with the clipped chain -- a board with no watched member
    -- has no risk set and fails the floor below anyway -- and it is here on
    -- purpose: insufficient_reason_30 names it, and a reason for a term the
    -- boolean does not contain is a term a later edit can drop unnoticed.
    COALESCE(ob.admitted
       AND ob.watched_from IS NOT NULL
       AND ob.watched_from < (SELECT h.to_d FROM cohort30 h)
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
    CASE WHEN ob.admitted THEN e30.relists30 END           AS relists_30,
    -- THE FLOOR THE CHAIN WAS CLIPPED AT, PUBLISHED. cohort_from beside it is
    -- the global date; this board's own cohort began the day after this one
    -- whenever this one is later. NULL means no floor exists: a lap board, a
    -- board we cannot date, or a bucket that cannot see a takedown at all.
    ob.watched_from                                        AS watched_from,
    -- WHICH TERM REFUSED THE FIGURE, IN THE ORDER THE GATE IS READ, so a NULL
    -- share always arrives with its cause. unobservable: no observability row
    -- or a bucket that cannot prove an absence. lap: a lap-certified board,
    -- refused until a lap-latency term exists. watch: no floor, or a floor on
    -- or after cohort_to, so no member of the cohort was watched for its
    -- whole thirty days. The remaining words and predicates are the ones
    -- refresh_layoff_partition's insufficient_reason uses. NULL: sufficient.
    CASE
      WHEN ob.tok IS NULL OR NOT ob.admitted THEN 'unobservable'
      WHEN ob.bucket = 'lap_proven' THEN 'lap'
      WHEN ob.watched_from IS NULL OR ob.watched_from >= (SELECT h.to_d FROM cohort30 h) THEN 'watch'
      WHEN COALESCE(e30.n30, 0) < (SELECT kk.min_n_at_risk_30 FROM k kk) THEN 'n'
      WHEN COALESCE(e30.events30, 0) < (SELECT kk.min_events_30 FROM k kk) THEN 'events'
      WHEN COALESCE(e30.fills30, 0) < (SELECT kk.min_fills_30 FROM k kk) THEN 'fills'
      WHEN COALESCE(e30.relists30, 0) > COALESCE(e30.fills30, 0) THEN 'relists'
      WHEN (e30.s30_hi - e30.s30_lo) / 2 > (SELECT kk.max_half_width_30 FROM k kk) THEN 'width'
      WHEN (e30.s30_hi - e30.s30_lo) / 2 > (SELECT kk.max_rel_half_width_30 FROM k kk) * (1 - e30.s30) THEN 'precision'
      WHEN abs(e30.r30 + e30.x30 + e30.s30 - 1) > 0.000001 THEN 'arithmetic'
      ELSE NULL
    END                                                    AS insufficient_reason_30,
    -- ROLES, NOT EVENTS (20261008110000). fills_90d and relists_90d above stay
    -- what they are named for, a window of closure EVENTS; these two are the
    -- distinct roles behind them. filled_roles_90d: closed exactly once, not
    -- superseded, not serving again today -- a CEILING. relisted_roles_90d:
    -- closed more than once, superseded, or serving again today -- a FLOOR.
    COALESCE(rc.filled, 0)                                 AS filled_roles_90d,
    COALESCE(rc.relisted, 0)                               AS relisted_roles_90d,
    ms.multi_site_title_share                              AS multi_site_title_share,
    COALESCE(ms.multi_site_n, 0)                           AS multi_site_n,
    fd.feed_total                                          AS feed_total,
    fd.observed_at                                         AS feed_read_at,
    fd.state                                               AS feed_state,
    -- Workday's CXS states at most 2,000 and wraps at that offset, so a
    -- total of exactly 2,000 there is the cap, not the board. Unknown (NULL)
    -- when no complete read stated a total in the last seven days.
    CASE WHEN fd.tok IS NULL THEN NULL
         ELSE ((fd.source = 'workday' OR t.tok LIKE '%~wd%') AND fd.feed_total = 2000)
    END                                                    AS feed_capped,
    COALESCE(lt.n, 0)                                      AS late_sighted_30,
    COALESCE(o.undated, 0)                                 AS undated_open
  FROM toks t
  LEFT JOIN bounds   e  ON e.tok  = t.tok
  LEFT JOIN counts   c  ON c.tok  = t.tok
  LEFT JOIN open_now o  ON o.tok  = t.tok
  LEFT JOIN span     sp ON sp.tok = t.tok
  LEFT JOIN base     b  ON b.tok  = t.tok
  LEFT JOIN bounds30 e30 ON e30.tok = t.tok
  LEFT JOIN obs      ob ON ob.tok  = t.tok
  LEFT JOIN role_counts rc ON rc.tok = t.tok
  LEFT JOIN ms       ms ON ms.tok  = t.tok
  LEFT JOIN feed     fd ON fd.tok  = t.tok
  LEFT JOIN late30   lt ON lt.tok  = t.tok;
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
  'WATCH FLOOR (20261002121417): a role joins the day-30 chain only if it was '
  'posted on a later UTC day than watched_from, the last day its board''s '
  'takedowns were not yet observable to us, so each board''s effective cohort '
  'is [GREATEST(cohort_from, watched_from + 1), cohort_to] while cohort_from '
  'stays the global date; watched_from is published beside it. For a '
  'full_read board watched_from is the later of '
  'job_board_board_watch.first_observed_on and the last day '
  'job_board_board_state recorded a truncated read, so ONE TRUNCATED DAY COSTS '
  'THIRTY-ONE DAYS of day-30 eligibility; a full_read board with no watch row '
  'has none and is refused. A lap_proven board has none either and is REFUSED '
  'until a lap-latency term exists: a lap certifies a takedown one to three '
  'laps late and the sweep logs a posting still stamped missing at the cap as '
  'an age-out, so a lap board inflates S(30) however long it has been watched '
  '(0.4800 where the truth was 0.4000, at a four-day certification lag, '
  'executed in pglite). sufficient_30 requires watched_from to exist and to '
  'fall before '
  'cohort_to. insufficient_reason_30 names the first term that failed, in the '
  'order the gate is read: unobservable, lap, watch, n, events, fills, '
  'relists, width, precision, arithmetic; NULL when sufficient. Before this '
  'term, careers.ulta.com (lap_proven, 12 tracking days, first read '
  '2026-09-07) published 0.9431 with sufficient_30 true on a cohort posted '
  'wholly before we first read it (live, 2026-10-01T23:56Z). RESIDUALS this '
  'term does not close: a full_read board still certifies a takedown about '
  'one and a half revisit intervals late, under a point at the freshness '
  'measured on 2026-10-01; and windowing before 2026-09-06, when the read '
  'ledger began, is invisible to it. '
  'A closure never means hired; a role still advertised at day 30 is not '
  'proof of anything about the employer beyond the fact stated; nothing here '
  'extrapolates past the cap (docs/hiring-health-model.md section 10).'
  ' SEEN AGAIN (20261008110000): a doubted observation -- a closure stamped '
  'suspect or caught by the dark proxy, or an age-out logged in a bad batch -- '
  'is DROPPED from the risk set, not censored, when the same posting_id was '
  'observed after that instant: stored again (a later first_seen), closed '
  'again or exited again. The later observation already carries the posting, '
  'so keeping the doubted row made one requisition two or more observations '
  'and pulled fill_rate_14 down and still_open_30 up on every board with a '
  'dark batch. A doubted row whose posting was never seen again is still '
  'censored at its instant, as before. fills_90d, relists_90d and ageouts_90d '
  'never counted a doubted row and do not move; dated_n, undated_n and the '
  'chains do. ROLES, NOT EVENTS (20261008110000): filled_roles_90d counts '
  'distinct posting_ids among the closures of the window the risk set keeps '
  'that closed exactly once, were not superseded and are not served on their '
  'board today -- a CEILING, because a re-list under a new id is invisible; '
  'relisted_roles_90d counts the ones that closed more than once, were '
  'superseded or are served again today -- a FLOOR. A role whose doubted '
  'closure was never seen again is in neither. NOT THE LEADERBOARD''S COUNT, '
  'AND BY ONE RULE: the three witnesses and the drop from both sides are '
  'get_actively_hiring_companies'' (filled_roles_ceiling, '
  'relisted_roles_floor), but that function drops a role on ANY doubted '
  'closure in the window, seen again or not, while this one first removes a '
  'doubted closure whose posting was seen again, so a role that flapped in a '
  'dark batch and then came down for real is filled here and in neither count '
  'there. On a board with dark batches the employer page can therefore print '
  'more filled roles than the leaderboard pages print as '
  'filled_roles_ceiling for the same employer; elsewhere the two agree '
  '(that function also skips closures with no company name). fills_90d and '
  'relists_90d are a count of closure EVENTS and must never be printed as '
  'roles taken down for good: one role that closed twice is two of them.'
  ' DELAYED ENTRY (20261012121000): both chains read only rows posted after '
  'the board''s watch floor, and a row is at risk at day t only when it entered '
  'before t: entry is its age on the later of its first sighting and the day '
  'after the floor (the exit ledger has no first sighting, so an age-out enters '
  'at the floor). n_j = #{tt >= t_j} - #{entry >= t_j}. The 14-day share is '
  'therefore NULL-free but empty (0, not sufficient) on a board read in laps or '
  'with no floor. THE INTERVAL: fill_rate_14_lo/hi are R(14) scaled by '
  '(1 - S_hi)/(1 - S(14)) and (1 - S_lo)/(1 - S(14)), so they contain '
  'fill_rate_14; 0 when S(14) = 1. SUFFICIENT also needs tracking_days of at '
  'least 21 (28 on lap_proven). NEW COLUMNS: multi_site_title_share and '
  'multi_site_n (board_multi_site_title_share: the share of live rows whose '
  'title is live at another location on the board; the hiring-record gate reads '
  'the re-post test as unreliable at 0.20 or more beside max(10, a quarter of '
  'the roles down) roles back); feed_total, feed_read_at and feed_state from '
  'the newest job_board_board_state row of the last seven days that states a '
  'total on a complete read (ok or empty), never the day''s latest row and '
  'never job_board_verifications; feed_capped where that total is Workday''s '
  '2,000 cap, NULL when no such row exists; late_sighted_30, day-30 cohort rows '
  'first seen more than the board''s median read gap plus a day after their '
  'stated date (reported only); undated_open, served rows with no employer '
  'date (counted by first sighting through effective_posted).';
-- THE REACHABLE SET IS STATED, NOT INHERITED. A fresh function carries
-- EXECUTE to PUBLIC, and Supabase grants new functions to anon directly, so
-- all three are revoked by name before the page's grant is given back.
REVOKE ALL ON FUNCTION public.get_company_fill_curve(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_fill_curve(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_company_fill_curve(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_fill_curve(text[]) TO anon, authenticated, service_role;

-- SELF-CHECK: exactly one definition, the earlier files' named terms still in
-- the body, this file's four changes in it, anon can execute it, and a batch
-- of tokens with no data answers one row per token.
DO $$
DECLARE n int; cols text; body text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_company_fill_curve';
  IF n <> 1 THEN
    RAISE EXCEPTION 'self-check 20261012121000: expected exactly one get_company_fill_curve, found %', n;
  END IF;
  SELECT pg_get_function_result(p.oid), pg_get_functiondef(p.oid) INTO cols, body
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_company_fill_curve';
  IF cols NOT LIKE '%still_open_30%' OR cols NOT LIKE '%events_30%' OR cols NOT LIKE '%watched_from%'
     OR cols NOT LIKE '%insufficient_reason_30%' OR cols NOT LIKE '%filled_roles_90d%' OR cols NOT LIKE '%relisted_roles_90d%' THEN
    RAISE EXCEPTION 'self-check 20261012121000: re-issued without an earlier column: %', cols;
  END IF;
  IF cols NOT LIKE '%multi_site_title_share%' OR cols NOT LIKE '%feed_total%' OR cols NOT LIKE '%feed_read_at%'
     OR cols NOT LIKE '%feed_capped%' OR cols NOT LIKE '%late_sighted_30%' OR cols NOT LIKE '%undated_open%' THEN
    RAISE EXCEPTION 'self-check 20261012121000: re-issued without the new columns: %', cols;
  END IF;
  IF body NOT LIKE '%min_events_30%' OR body NOT LIKE '%max_rel_half_width_30%' OR body NOT LIKE '%in_watch30%'
     OR body NOT LIKE '%HAVING bool_or(a.bad AND a.kept)%' OR body NOT LIKE '%THEN ''lap''%' OR body NOT LIKE '%THEN ''watch''%' THEN
    RAISE EXCEPTION 'self-check 20261012121000: re-issued without an earlier term (day-30 gate, watch floor or seen-again rule)';
  END IF;
  IF body NOT LIKE '%r.entry_tt < r.tt%' OR body NOT LIKE '%sum(a.ent)%' THEN
    RAISE EXCEPTION 'self-check 20261012121000: re-issued without delayed entry';
  END IF;
  IF body NOT LIKE '%WHEN e.s14 >= 1 THEN 0%' OR body NOT LIKE '%NULLIF(1 - e.s14, 0)%' THEN
    RAISE EXCEPTION 'self-check 20261012121000: re-issued with an interval that can divide by zero or exclude its share';
  END IF;
  IF body NOT LIKE '%THEN 28 ELSE 21 END%' THEN
    RAISE EXCEPTION 'self-check 20261012121000: re-issued without the tracking floor inside sufficient';
  END IF;
  IF body NOT LIKE '%feed_total IS NOT NULL%' OR body NOT LIKE '%state IN (''ok'', ''empty'')%' THEN
    RAISE EXCEPTION 'self-check 20261012121000: re-issued reading a board total that a mid-feed or error visit can overwrite';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_company_fill_curve(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check 20261012121000: anon cannot execute it, so every employer page loses its record';
  END IF;
  IF (SELECT count(*) FROM public.get_company_fill_curve(ARRAY['20261012121000-a', '20261012121000-b'])) <> 2 THEN
    RAISE EXCEPTION 'self-check 20261012121000: a batch of boards with no data must answer one row per board';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
