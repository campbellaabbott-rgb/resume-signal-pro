-- A FIELD POOLS A POSTING SEEN AGAIN AFTER A DARK BATCH ONCE.
--
-- get_category_fill_curve censored every doubted closure at its instant --
-- the collector's suspect stamp and the retroactive dark proxy alike -- and
-- the age-out its bad batch logged with it. That is right for a posting we
-- never saw again and wrong for one we did: a feed that answers short once
-- stamps every stored posting, the rows are deleted, and the next good read
-- stores them again, so each requisition enters the field's risk set twice --
-- once as the doubted row, once as whatever really happened to it. Summed
-- over every board with a dark batch, a field's fill_rate_14 is pulled down,
-- its still_open_30 up and its intervals narrowed for a reason that is ours
-- (register 1.28 / L13-12; the Workday resume flap alone wrote over a million
-- doubted rows in a month, most of them postings that came straight back).
--
-- THE RULE, AS THE OWNER APPROVED IT and as 20261008110000 applies it at the
-- company grain: a doubted closure, and the age-out the same bad batch
-- logged, leaves the pool when the same posting_id was observed after that
-- instant -- stored again, closed again or exited again. Only an id never
-- seen again stays censored. The guard
-- src/test/a-posting-seen-again-after-a-dark-batch-is-one-observation.test.ts
-- executes the invariance at both grains.
--
-- WHAT IT COSTS, AND WHY THIS SHAPE. The ledgers are read exactly as the
-- previous body read them, once each, into `arms`; only boards with a doubted
-- batch aggregate their held rows by posting, joined back on the whole
-- (board, posting) key; the one key lookup left is a scalar seek for a
-- doubted row that is its posting's latest observation. The first draft of
-- this file re-read both ledgers over the whole window, looked up the posting
-- key for every doubted row -- the Workday flap writes them by the million --
-- and joined the doubted rows back on (board, posting, instant), which a
-- plan without a hash join merged on (board, instant) alone: 2.5s and nine
-- million discarded rows on two small flap boards where the previous body
-- took 0.06s. It runs inside the five minutes the header allows and the cron
-- command pays (20261003220000); the measured cost is in
-- docs/wave2/data-pages-sql.md, production's runtime is read after deploy
-- from get_cron_health and the stats cache's fill_curve stamp, and the
-- rollback is the previous body.
--
-- EVERYTHING ELSE IS THE 20261002121843 TEXT -- the signature, the thirty
-- columns, the watch floor, the gate, the five-minute header, the grants and
-- the census status -- so this is a CREATE OR REPLACE that keeps the oid. The
-- stored comment is restated whole with one paragraph added, and the pool the
-- hourly caches hold is withheld at the foot exactly as 20261002121843
-- withheld it, so the pages say "not yet computed" until the next run rather
-- than serving rows the old rule computed. One function per file. The 30-day
-- freshness fence is not touched.

-- ── the three tables the function reads, repeated because it reads them ──
--
-- A LANGUAGE sql body is validated at CREATE time, and the guards load this
-- file onto pglite schemas built from subsets of the lane. All three belong
-- to earlier files (20260909217800, 20260909212000, 20260906215000) and on a
-- database built from the whole set each statement is a no-op. Only the
-- CREATE is repeated: an ALTER TABLE takes ACCESS EXCLUSIVE whether or not it
-- changes anything, job_board_board_state is upserted by the ingest around the
-- clock, and the owners already set row security and the grants (the company
-- grain's file, 20261002121417, says this at length).
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
  --
  -- AND THE WATCH FLOOR, AT FIELD GRAIN (20261002121843). watched_from is the
  -- last UTC day this board's takedowns were not yet observable to us, spelled
  -- exactly as the company grain (20261002121417) spells it: for a full_read board the later of
  -- the day we first observed it and the last day a read of it was cut short;
  -- NULL for a lap board, for a board with no watch row and for every bucket
  -- above that cannot prove an absence. A NULL floor admits nothing. This CTE
  -- is read by all three arms of raw, so it is computed once per scan.
  obs AS (
    SELECT o.company_token AS tok,
           (o.bucket IN ('full_read', 'lap_proven')) AS admitted,
           CASE WHEN o.bucket = 'full_read' AND bw.first_observed_on IS NOT NULL
                THEN GREATEST(bw.first_observed_on,
                              (SELECT max(bs.observed_on)
                                 FROM public.job_board_board_state bs
                                WHERE bs.company_token = o.company_token
                                  AND bs.state = 'truncated'))
           END AS watched_from
    FROM public.job_board_board_observability o
    LEFT JOIN public.job_board_board_watch bw ON bw.company_token = o.company_token
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
  --
  -- arms IS THAT PASS, HELD ONCE (20261008110500), plus the rows and columns
  -- only the seen-again test reads, as at the company grain (20261008110000):
  -- seen_at is the row's instant (a served role's is its first_seen); kept is
  -- false on a lap_backfill closure, a backdated exit and a row with no
  -- field, which are observations of their posting and never part of a pool;
  -- bad marks a doubted row. A 'removed' exit is not read: the collector
  -- writes it only beside a closure at the same instant. raw below is arms
  -- with the kept rows only, less the doubted rows whose posting was seen
  -- again.
  arms AS MATERIALIZED (
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
      -- ADMITTED ONLY IF WATCHED (the watch floor, 2026-10-02): the bucket can
      -- prove an absence AND this row was posted on a later UTC day than the
      -- board's watch floor, so its whole thirty days were observable. A NULL
      -- floor -- a lap board, a board we cannot date -- is false. The same
      -- expression on all three arms; the cohort is clipped, never one arm.
      COALESCE(ob.admitted AND c.posted_at >= ((ob.watched_from + 1)::timestamp AT TIME ZONE 'UTC'), false) AS admitted,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL OR c.superseded THEN 0 ELSE 1 END AS is_fill,
      CASE WHEN COALESCE(c.suspect, false) OR dk.tok IS NOT NULL THEN 0
           WHEN c.superseded THEN 1 ELSE 0 END AS is_relist,
      true AS in_cov,
      (c.posted_at IS NOT NULL) AS dated,
      c.posting_id AS pid,
      c.closed_at AS seen_at,
      (c.category <> '' AND c.absence_basis IS DISTINCT FROM 'lap_backfill') AS kept,
      (COALESCE(c.suspect, false) OR dk.tok IS NOT NULL) AS bad
    FROM public.job_board_closures c
    -- `dark` is one row per (tok, closed_at) by construction, so this cannot
    -- multiply rows; dk.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    LEFT JOIN obs ob ON ob.tok = c.company_token
    WHERE c.closed_at >= now() - make_interval(days => (SELECT d FROM win))

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
      COALESCE(ob.admitted AND e.posted_at >= ((ob.watched_from + 1)::timestamp AT TIME ZONE 'UTC'), false) AS admitted,
      0 AS is_fill,
      0 AS is_relist,
      true AS in_cov,
      (e.posted_at IS NOT NULL) AS dated,
      e.posting_id AS pid,
      e.exited_at AS seen_at,
      (e.category <> '' AND e.exit_reason IN ('aged_out', 'board_dormant', 'untracked')) AS kept,
      (bb.tok IS NOT NULL) AS bad
    FROM public.job_board_exits e
    -- bad_batch is DISTINCT on (tok, at) by construction, so this cannot
    -- multiply rows; bb.tok IS NOT NULL is the flag, not a filter.
    LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at
    LEFT JOIN obs ob ON ob.tok = e.company_token
    WHERE e.exited_at >= now() - make_interval(days => (SELECT d FROM win))
      AND e.exit_reason <> 'removed'

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
      COALESCE(ob.admitted AND p.posted_at >= ((ob.watched_from + 1)::timestamp AT TIME ZONE 'UTC'), false) AS admitted,
      0 AS is_fill,
      0 AS is_relist,
      true AS in_cov,
      (p.posted_at IS NOT NULL) AS dated,
      p.id AS pid,
      p.first_seen AS seen_at,
      (p.category <> '') AS kept,
      false AS bad
    FROM public.job_board_postings p
    LEFT JOIN obs ob ON ob.tok = p.company_token
    WHERE p.missing_since IS NULL
  ),
  -- A DOUBTED ROW WHOSE POSTING WAS SEEN AGAIN NEVER CAME DOWN (20261008110500),
  -- the company grain's rule (20261008110000) at the grain the figure is
  -- pooled at, in the same shape. A doubted row is SEEN AGAIN when its posting
  -- was observed at a later instant: closed again (any basis), exited again,
  -- or stored again (a later first_seen). Such a row leaves raw; a doubted row
  -- never seen again stays, censored at its instant.
  --
  -- Only a board with a doubted batch (dirty) can hold such a row, so only its
  -- held rows are aggregated: seen_last is the latest observation of each of
  -- its postings that has a doubted row, one row per (board, posting), joined
  -- back on that whole key from a held scan with no sort order of its own, so
  -- a merge join must sort on the whole key. Joined on (board, posting,
  -- instant) instead, a plan without a hash join merged on (board, instant)
  -- alone and compared every row of a doubted batch with every other: two
  -- boards of two 1,500-row batches discarded nine million rows. The scalar
  -- seek is the one observation the held rows cannot make -- a posting stored
  -- again and not served now -- and the CASE reaches it only for a doubted row
  -- that is its posting's latest observation (an OR there would be lifted
  -- below the join and run the seek for every doubted row). The COALESCE is
  -- load-bearing: a doubted row whose posting has no row at all must be KEPT.
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
    SELECT a.cat, a.tok, a.tt, a.in_cohort, a.in_cohort30, a.is_ageout, a.admitted,
           a.is_fill, a.is_relist, a.in_cov, a.dated
    FROM arms a
    LEFT JOIN seen_last l ON l.tok = a.tok AND l.pid = a.pid
    WHERE a.kept
      AND NOT (a.bad
               AND CASE WHEN l.last_at > a.seen_at THEN true
                        ELSE COALESCE((SELECT p2.first_seen FROM public.job_board_postings p2 WHERE p2.id = a.pid) > a.seen_at, false)
                   END)
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
  --
  -- AND THE CONTROL IS COUNTED ONLY OVER ROWS THE POOL CAN CONTAIN (the
  -- watch floor, 2026-10-02). raw.admitted now carries the watch floor, so a board's
  -- events from roles posted before we could see its takedowns -- the ones
  -- whose own takedowns are exactly what we missed -- cannot vouch for its
  -- watched roles. Appended to the end of the WHERE, so the cohort clause in
  -- front of it reads as it always has.
  board30 AS (
    SELECT
      r.tok,
      r.cat,
      sum(r.is_fill + r.is_relist)::int AS events30
    FROM raw r
    WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0 AND r.tt <= 30 AND r.admitted
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
    -- none of them passed all three admission tests -- are one value, and
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

-- THE CONTRACT, RESTATED (see the header): the text the function carries
-- from 20260925163842 on, edited only where the admission rule moved.
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
  'as refresh_closure_population() last wrote it. Since 20261002121843 that is '
  'a necessary test and no longer a sufficient one: the WATCH FLOOR below '
  'refuses every lap_proven board, so only full_read boards can admit. '
  'gate_share_30 is the share of the field''s dated day-30 cohort that '
  'admitted, and the day-30 columns are NULL -- not 1.0 -- when it admitted '
  'nothing. A windowed board with no proven lap has S(30) = 1 by construction, '
  'because its takedowns are invisible and every posting ages out. '
  'POSITIVE CONTROL (20260925163842): the day-30 risk set ALSO admits a '
  'posting only when its own board produced at least five events -- fills plus '
  'relists, the two that move S -- inside the same day-30 cohort AND INSIDE THE '
  'SAME FIELD. Since 20261002121843 those events are counted over ADMITTED '
  'postings only, so events from roles the watch floor refuses cannot vouch '
  'for the roles it admits. The count is taken per (board, field) and joined '
  'on both keys, '
  'because a control counted per board alone would admit a board into every '
  'field it touches on events it produced in a different one: a board with five '
  'engineering fills and twenty thousand eventless customer roles censored at '
  'the cap would re-enter the customer pool on the engineering fills. That '
  'count is over CATEGORISED rows only (every arm of the risk set requires a '
  'non-empty category), so a board with uncategorised cohort events publishes at '
  'company grain and can be excluded here -- this grain is the STRICTER of the '
  'two and nothing is over-published as a result. sufficient_30 then requires '
  'the pooled field to clear seven terms, the same seven the company grain '
  'applies to a board (its eighth, the watch floor, is applied here per '
  'posting, at admission): the risk-set floor, the events floor, a floor on '
  'FILLS alone, '
  'relists not outnumbering fills, the absolute half-width ceiling, a ceiling '
  'on the half-width relative to the complement (1 - still_open_30) the '
  'sentence asserts, and the identity. events_30, fills_30 and relists_30 '
  'publish the counts so the gate is checked rather than trusted. Without the '
  'events floor the gate was four terms that all pass VACUOUSLY on a cohort '
  'with no events, and a board that has never shown us a takedown sat in the '
  'pool holding S up in proportion to its size. Without the relative ceiling it '
  'passed one batch above that: a 20,000-observation pool with five events '
  'publishes 0.9998 with a half-width of 0.00025, which renders as a hundred '
  'per cent with an interval of zero points. Without the fill terms a pool whose '
  'only events are relists publishes taken_down_30 = 0.0000 as a measured '
  'figure. MEASURED, one walk, one basis: 2026-09-25T21:40:43Z to 21:44:27Z, '
  'all 44,379 catalogue tokens, zero failed chunks -- of the risk mass on boards '
  'sufficient_30 admitted, 10.59% sat on boards whose cohort produced zero '
  'events and a further 5.00% on boards estimated to have produced fewer than '
  'five. The exclusion biases each field DOWN by at most the factor '
  '1/(1 - the excluded share) on ln S, and it is disclosed in the same row: '
  'gate_share_30 measures EVERY admission test -- the bucket, the events '
  'floor and, since 20261002121843, the watch floor -- so it is the honest '
  'coverage of the figure beside it, and it is the figure the post-deploy '
  'verifier reads to prove each change to admission applied. TWO FURTHER '
  'COLUMNS EXIST TO BE READ, NOT '
  'GATED ON. dated_cohort_n_30 is gate_share_30''s denominator -- the field''s '
  'whole dated day-30 cohort before any admission test -- so a caller handed NULL '
  'columns can say WHICH absence it is: no dated role reached the cap at all, '
  'or dated roles reached it and none was admitted under all three tests. '
  'top_board_share_30 is the share of the ADMITTED dated cohort held by the '
  'field''s single largest board, and it names the residual this change does '
  'NOT close: the pooled S(30) is a mass-weighted average, so a large board '
  'that cleared the events floor on a handful of events of its own still '
  'carries its whole censored mass into the pool. A cap on it would need a '
  'threshold calibrated against per-(board, field) risk mass, which cannot be '
  'read from outside today -- the board''s companies facet is board-wide and '
  'ignores the category filter, and the field totals beside it are capped -- so '
  'the quantity is published and watched rather than guessed at. AGE-OUTS ARE NOT EVENTS HERE and must never be '
  'counted as them -- they are our own sweep at the cap. NEITHER ARE the 90-day '
  'event counts: those are a WINDOW OF EVENTS and the cohort is a different '
  'population, and 42 of the 71 boards this closed had events in that window '
  'and none inside the cohort. '
  ' WATCH FLOOR (20261002121843): a posting is admitted to the day-30 risk '
  'set only if it was posted on a later UTC day than watched_from, the last '
  'day its board''s takedowns were not yet observable to us -- the floor '
  'get_company_fill_curve applies (20261002121417), spelled identically. For '
  'a full_read board watched_from is the later of '
  'job_board_board_watch.first_observed_on and the last day '
  'job_board_board_state recorded a truncated read, so ONE TRUNCATED DAY COSTS '
  'THIRTY-ONE DAYS of admission; a full_read board with no watch row has none '
  'and is refused. A lap_proven board has none either and is REFUSED until a '
  'lap-latency term exists: a lap certifies a takedown one to three laps late '
  'and the sweep logs a posting still stamped missing at the cap as an '
  'age-out, so a lap board inflates S(30) however long it has been watched. '
  'The floor is applied per POSTING on all three arms, so each board''s '
  'effective cohort is [GREATEST(cohort_from, watched_from + 1), cohort_to] '
  'while cohort_from stays the global date. A posting therefore enters the '
  'pool only when it passes THREE admission tests: its board''s bucket can '
  'prove an absence, it was posted after its board''s watch floor, and its '
  'board produced five events of its own among its admitted postings in the '
  'field. gate_share_30 '
  'and dated_cohort_n_30 are computed exactly as before, so the share falls '
  'by the mass the floor removed and discloses the cut. Before this term the '
  'field pooled lap boards whose first provable lap postdated the whole '
  'cohort, and boards onboarded or cut short while it was being posted: on '
  'one pglite field of six boards, each with a true S(30) of 0.4000, the '
  'previous definition published 0.5785 with sufficient_30 true, and this one '
  'publishes 0.4000 with gate_share_30 0.1992. RESIDUALS this term does not '
  'close: a full_read board still certifies a takedown about one and a half '
  'revisit intervals late, and windowing before 2026-09-06, when the read '
  'ledger began, is invisible to it. '
  'A closure never means hired; a role still advertised at day 30 is not '
  'proof of anything about the employer beyond the fact stated; nothing here '
  'extrapolates past the cap (docs/hiring-health-model.md section 10).'
  ' SEEN AGAIN (20261008110500, the company grain''s 20261008110000 rule): a '
  'doubted observation -- a closure stamped suspect or caught by the dark '
  'proxy, or an age-out logged in a bad batch -- is DROPPED from the pool, '
  'not censored, when the same posting_id was observed after that instant '
  '(stored again, closed again or exited again); the later observation '
  'already carries the posting, and keeping both made one requisition two '
  'or more observations on every board with a dark batch. A doubted row '
  'whose posting was never seen again stays censored at its instant.';

-- THE REACHABLE SET, STATED NOT INHERITED. Unchanged from 20260925163842 and
-- 20260928003117: the function is deliberately anon-callable; PUBLIC is still
-- not the same set as anon, so all three are named.
REVOKE ALL ON FUNCTION public.get_category_fill_curve(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_fill_curve(int, int) TO anon, authenticated, service_role;

-- Self-verifying: exactly one definition must remain, it must carry the raised
-- header in its own proconfig, it must still publish the thirty columns, its
-- stored body must carry the watch floor, and the comment stored beside it
-- must state that floor -- a re-issue whose purpose is the floor must not be
-- able to report success having lost it, changed the shape, dropped the header
-- the cron pays for, or left the old contract describing the old rule.
DO $$
DECLARE n int; cfg text[]; cols text; body text;
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
    RAISE EXCEPTION 'get_category_fill_curve: the watch-floor re-issue changed the result shape: %', cols;
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO body
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_category_fill_curve';
  IF body NOT LIKE '%watched_from%'
     OR body NOT LIKE '%public.job_board_board_state%'
     OR body NOT LIKE '%public.job_board_board_watch%' THEN
    RAISE EXCEPTION 'get_category_fill_curve: re-issued without the watch floor on the day-30 pool';
  END IF;
  IF COALESCE(obj_description('public.get_category_fill_curve(int, int)'::regprocedure, 'pg_proc'), '')
       NOT LIKE '%WATCH FLOOR (20261002121843)%' THEN
    RAISE EXCEPTION 'get_category_fill_curve: the watch floor is running under a contract that does not state it';
  END IF;
  -- 20261008110500: the seen-again rule in the body and in the contract.
  IF body NOT LIKE '%HAVING bool_or(a.bad AND a.kept)%'
     OR body NOT LIKE '%CASE WHEN l.last_at > a.seen_at THEN true%'
     OR body NOT LIKE '%WHERE p2.id = a.pid) > a.seen_at%' THEN
    RAISE EXCEPTION 'get_category_fill_curve: re-issued without the seen-again rule';
  END IF;
  IF COALESCE(obj_description('public.get_category_fill_curve(int, int)'::regprocedure, 'pg_proc'), '')
       NOT LIKE '%SEEN AGAIN (20261008110500%' THEN
    RAISE EXCEPTION 'get_category_fill_curve: the seen-again rule is running under a contract that does not state it';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_category_fill_curve(int, int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_category_fill_curve: anon cannot execute it';
  END IF;
END $$;

-- ── the pre-fix pool is withheld where it is stored ───────────────────────
--
-- Both hourly caches carry the previous copy of these rows forward whole when
-- a run fails, so the pool computed under the old admission would otherwise
-- outlive this file for as long as the curve keeps timing out. The keys are
-- removed, not nulled: refresh_stats_cache then has nothing to carry and the
-- pages' reader renders the part as absent ("not yet computed") until the
-- next run writes rows under the new admission; refresh_explore_cache starts
-- from an empty object. stats_cache's sibling stamp key goes with its part, so
-- nothing is left dating rows that are gone. Each statement names the one row
-- it means, and the block is a no-op on a schema that has no cache table.
DO $$
BEGIN
  IF to_regclass('public.job_board_meta') IS NOT NULL THEN
    UPDATE public.job_board_meta
       SET v = v - 'fill_curve' - 'fill_curve_computed_at'
     WHERE k = 'stats_cache';
    UPDATE public.job_board_meta
       SET v = v - 'field_curves'
     WHERE k = 'explore_cache';
  END IF;
END $$;
