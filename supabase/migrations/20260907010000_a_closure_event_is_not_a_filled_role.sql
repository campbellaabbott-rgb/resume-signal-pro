-- A CLOSURE EVENT IS NOT A FILLED ROLE, AND A RATIO OF 2,496% IS NOT A RANKING.
--
-- /explore's headline section says "Companies that actually fill roles". Read
-- straight out of the cache the page renders, 2026-09-06:
--
--   company           filled  days  open now   implied fills/day
--   Advocate Health    6,406    11       420               582
--   KnitWell Group     5,058    11       420               460
--   Pacs               4,234    10       341               423
--   JLL                4,331    11       220               394
--   Accenture          4,293    11       172               390
--
-- JLL cannot fill 394 roles a day while holding 220 open. Nothing in that table
-- is a fill count. They are CLOSURE EVENTS, and the arithmetic says so before
-- any model does: an employer cannot fill twenty times its own board in eleven
-- days, so most of those events are the same handful of roles leaving and
-- coming back.
--
-- WHY IT REGRESSED TODAY, AND WHY THE OLD FLOOR IS NOT THE FIX.
--
-- 20260906093000 removed
--     count(*) FILTER (WHERE NOT c.superseded
--       AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days')
-- and left
--     count(*) FILTER (WHERE NOT c.superseded AND c.suspect IS NOT TRUE).
--
-- Removing it from the MEDIAN was right and stays right: it truncated the left
-- tail and gave eighteen categories the same ~15-day answer, which is the whole
-- reason the hiring-health rewrite exists. On the COUNT it was doing a second,
-- unrelated job by accident -- a role that comes back within a week could not be
-- counted -- and deleting it removed the only thing holding same-day and
-- few-day relist churn out of "filled". Restoring it would re-import the
-- truncation into a place it does not belong. The floor is not the successor.
--
-- THE SUCCESSOR IS THE TABLE'S OWN DEFINITION OF A REPOST.
--
-- job_board_closures.posting_id is `source:token:externalId`, and the column's
-- own comment (20260714150000:15) says it is "not unique: reposts re-close".
-- The log therefore already names a relist without any modelling: the SAME
-- posting_id closing twice inside the window is one role that came back. So is
-- a posting_id that closed and is serving on the board right now. Neither
-- depends on `superseded`, which is set only when the identical normalised
-- title was ALSO live in the very same pass -- and a partially-read paginated
-- board (Workday pages of 20, Oracle pages of 100, MAX_POSTINGS_PER_VISIT 250,
-- with a rotating start offset) does not have the vanished title live in that
-- pass by construction. That is precisely the failure shape of the five
-- employers above: all five are large paginated tenants, and six of the twelve
-- published open_roles values are exact multiples of twenty.
--
-- So this function counts ROLES, not events, and it counts a role as filled
-- only when the log shows it leaving once and not returning. Fast fills are
-- kept -- a role that closes on day one and never comes back is a fill here,
-- which is the thing the seven-day floor was deleting.
--
-- THE RANKING IS THE CUMULATIVE-INCIDENCE FILL RATE, NOT A THROUGHPUT RATIO.
--
-- `filled * 100.0 / open_roles` is a throughput-to-inventory ratio and it is
-- unbounded: Accenture scored 2,496%. It also has no common denominator (each
-- employer's own current board) and no common window (an 11-day row ranked
-- beside a 50-day one as if the counts were comparable). Ranking now happens on
-- get_company_fill_curve's R(14) -- Aalen-Johansen cumulative incidence with
-- RELIST as a competing event and still-open / aged-out roles censored, over a
-- cohort selected on the employer's stated post date inside a fixed 90-day
-- window, evaluated at one fixed 14-day horizon. Common denominator (the risk
-- set at day 14), common window, bounded in [0,1], and it arrives with an
-- interval and with `sufficient`, which is honoured as a hard gate: an employer
-- whose curve refuses to answer does not appear at all.
--
-- Reading the curve rather than re-deriving it is deliberate. Two surfaces that
-- compute the same quantity twice eventually disagree, and this page has
-- already shipped that exact defect (the leaderboard and /jobs/company printing
-- different fill counts for one employer).
--
-- THE HEADER AND THE CARDS NOW AGREE.
--
-- The section's blurb says companies whose takedowns are mostly re-listings are
-- disqualified and appear under "Serial re-posters" instead. The gate said
-- `relists <= non-relists`, so 49% churn qualified -- and then Accenture,
-- Michaels, Pacs and KnitWell each rendered "Re-lists roles: 2,242 re-postings
-- across 182 roles in 49d" on their own card inside the section that had just
-- called them disqualified. The GATE was wrong, not the sentence: a
-- recommendation surface cannot recommend an employer on a fill record while
-- warning about its churn in the same card.
--
-- Two disqualifiers replace the one:
--
--   (a) THE WARNING'S OWN PREDICATE. get_repost_index renders that sentence for
--       any employer with >= 25 superseded events at a rate of >= 5 per
--       affected title. The same test is applied here, so no card in this
--       section can carry the warning. The index's window is 180 days and this
--       one is 90; the closure log holds ~54 days today, so both are "all of
--       it", and when the log grows past 90 days this gate becomes the narrower
--       of the two and must be widened to match.
--
--   (b) A SHARE, MEASURED ON THE FLOOR WE CAN SEE. Relisted roles must be under
--       a fifth of the roles the employer took down. Every relist figure is a
--       LOWER BOUND -- the collector logs only the first superseded closure per
--       normalised title per 24h and DELETES the rest -- so an observed 20% is
--       consistent with a far higher truth, and the bar is set where a
--       recommendation can survive that uncertainty. The old bar, 50% of a
--       floor, could not.
--
-- WHY IT TIMED OUT, WHICH IS ONE STRUCTURAL FACT AND NOT A BUDGET.
--
-- The direct call returns 57014 at 60s. The rewrite added the retroactive
-- feed-dark proxy to this function, and added it UNSCOPED:
--
--   1. `open_now` groups the whole served board.                     (kept)
--   2. `batches` made a SECOND full pass over 30 days of the closure
--      log for EVERY company, grouped by (company_token, closed_at).
--   3. `sized` then ran a correlated snapshot lookup once PER BATCH.
--      One closed_at per board pass x every board we carry x a month
--      of passes is on the order of 10^5-10^6 index seeks.
--   4. `fills` made a THIRD pass over the same 30 days and hash-joined
--      it against the output of 2-3, then sorted each group for
--      percentile_cont.
--
-- Every row of 2, 3 and 4 was computed for companies that cannot appear in the
-- answer: the >= 100 open-roles floor was applied at the very END, after all of
-- it. The fix is to apply eligibility FIRST and drive everything else from it.
-- `eligible` is a few hundred employers, so the closure work becomes a few
-- hundred index range scans on job_board_closures_curve_idx instead of a
-- month-wide scan, the snapshot lookup runs once per (company, DAY) rather than
-- once per batch, and the log is read ONCE instead of twice.
--
-- That is an eligibility gate, not the pre-truncation the guard forbids. The
-- pre-truncation cut the pool to `p_limit * 3` BY RAW FILLS before open roles
-- were known, so the ranking could never see a small employer; this cuts on the
-- published >= 100 open-roles rule, which is order-independent and is the same
-- predicate the final WHERE has always applied.
--
-- THE BUDGET IS NOT OURS TO SET, WHICH IS THE OPPOSITE OF WHAT THIS FILE FIRST
-- CLAIMED. The first draft of this header said entering get_company_fill_curve
-- "re-arms the ceiling at 25s". That contradicts its own premise and is wrong:
-- statement_timeout is armed ONCE, from statement start, and the GUC has no
-- assign hook, so changing it mid-statement -- which is all a function's SET
-- clause does -- cannot re-arm a timer already running. Neither the curve's
-- `SET statement_timeout = '25s'` nor this function's binds for a call that is
-- already in flight. The effective ceiling for the whole call is whatever the
-- CALLER's session had when the statement began: refresh_explore_cache's
-- 15min, or PostgREST's role default on a direct call. The SET below is kept
-- for the case where this function IS the statement, and it is documented as
-- what it is rather than as the binding constraint.
--
-- So the lever is never the budget. It is the number of employers this
-- statement does work for, and there are exactly two of those: |eligible|, and
-- the token array handed to get_company_fill_curve. Both are bounded below.
--
-- THE MASKING THIS FILE DEPENDS ON IS FIXED IN 20260907020000, NOT HERE.
-- refresh_explore_cache's `hiring` section is the only one of its eight that
-- neither carries the previous value forward nor appends to stale_parts: on a
-- failure it writes `'hiring' => []` and drops hiring_n, so the section and its
-- stated denominator vanish together with nothing on the page saying why. That
-- is the mechanism that hid the 57014 this file exists to remove, so shipping
-- this without it would leave the next timeout as silent as this one was. It is
-- a change to refresh_explore_cache and gets its own migration; deploy the two
-- together, and the cache one FIRST if they are separated, because a page that
-- can say "hiring could not be recomputed" is strictly safer than one that
-- cannot.

-- DROPPED BEFORE IT IS RE-CREATED, because CREATE OR REPLACE cannot change a
-- function's return type and this one gains eleven columns. The seven the
-- deployed clients read (company, company_token, closed_90d, open_roles,
-- tracking_days, p50_days_open, dated_n) keep their names, order and types, so
-- Explore.tsx, GhostJobIndex.tsx and refresh_explore_cache's `to_jsonb(h)` are
-- unaffected and the extra keys simply appear in the cached rows. The argument
-- signature is unchanged, so the GRANT and every call site survive; the GRANT
-- itself does not survive a DROP and is re-issued below. refresh_explore_cache
-- calls this through a string-bodied plpgsql statement, which Postgres records
-- no dependency for, so the DROP cannot cascade into it.
DROP FUNCTION IF EXISTS public.get_actively_hiring_companies(int);

CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (
  company text, company_token text, closed_90d bigint, open_roles bigint,
  tracking_days int, p50_days_open numeric, dated_n int,
  fills_window_days int,
  filled_roles_ceiling bigint,
  relisted_roles_floor bigint,
  relist_share_floor numeric,
  repost_events_floor bigint,
  fill_incidence_14d numeric,
  fill_incidence_14d_lo numeric,
  fill_incidence_14d_hi numeric,
  at_risk_14d int,
  fills_le_14d int,
  dated_share numeric,
  feed_total int,
  feed_total_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH open_now AS (
    SELECT company_token, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  -- ELIGIBILITY FIRST. This is the cut that makes the query finish, and it is
  -- the >= 100 open-roles rule that the final WHERE has always applied, moved
  -- to the front so the closure log is read for a few hundred employers instead
  -- of for every board we carry. It is order-independent: no employer that
  -- would have ranked is removed by it, which is the difference between an
  -- eligibility gate and the pre-truncation-by-raw-fills the guard forbids.
  eligible AS (
    SELECT o.company_token AS tok, o.n
    FROM open_now o
    WHERE o.n >= 100
      AND o.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  ),
  -- Roles serving RIGHT NOW, by posting id. A posting_id that closed inside the
  -- window and is on the board today came back; `missing_since IS NULL` alone,
  -- without the 30-day serving predicate, because the question here is "did this
  -- role return", not "does the board show it".
  live_ids AS (
    SELECT p.id
    FROM public.job_board_postings p
    JOIN eligible e ON e.tok = p.company_token
    WHERE p.missing_since IS NULL
  ),
  -- ONE PASS over the closure log, token-scoped, serving every count below.
  -- 90 days matches get_company_fill_curve's window and the 90-day clamp on
  -- tracking_days, so the count and the span it is published beside finally
  -- describe the same stretch of time -- `closed_90d` was a 30-day count under
  -- a 90-day name.
  ev AS (
    SELECT
      c.company_token AS tok, c.company, c.posting_id, c.title,
      c.closed_at, c.posted_at, c.superseded, c.suspect, c.batch_live_before
    FROM public.job_board_closures c
    JOIN eligible e ON e.tok = c.company_token
    WHERE c.closed_at > now() - interval '90 days'
      AND c.company <> ''
  ),
  -- The retroactive feed-dark proxy, unchanged in threshold and meaning from
  -- get_company_fill_curve and get_company_hiring_health, so the three cannot
  -- publish three fill counts for one employer. It applies only to unstamped
  -- history (batch_live_before IS NULL); the collector stamps its own batch now,
  -- so this retires itself.
  batches AS (
    SELECT ev.tok, ev.closed_at AS at,
           date_trunc('day', ev.closed_at)::date AS on_day,
           count(*)::int AS n_removed
    FROM ev
    WHERE ev.batch_live_before IS NULL
    GROUP BY ev.tok, ev.closed_at, date_trunc('day', ev.closed_at)::date
  ),
  -- ONCE PER (COMPANY, DAY), NOT ONCE PER BATCH. Same scalar-subquery spelling
  -- the sibling functions use -- a primary-key seek into a 35-day table, not a
  -- per-company lateral counting open roles -- but evaluated over at most 90
  -- days x |eligible| rows instead of once for every board pass of every board
  -- on the site. That change alone is the difference between 10^5-10^6 seeks
  -- and 10^4, and it is the term that was spending the 60s budget.
  --
  -- THE DENOMINATOR IS THE BOARD AS IT WAS. Scoring a 40-day-old batch against
  -- today's served count deletes exactly the employer that filled a hiring class
  -- and then wound its board down. Snapshots are pruned at 35 days, so the older
  -- history has none; there the fallback is today's count with the absolute
  -- floor raised to 25, because in that region a wind-down and a dark feed are
  -- indistinguishable and a floor of 5 deleted legitimate small passes whole.
  bdays AS (
    SELECT DISTINCT b.tok, b.on_day FROM batches b
  ),
  era AS (
    SELECT d.tok, d.on_day,
           (SELECT s.open_roles
              FROM public.job_board_company_snapshots s
             WHERE s.company_token = d.tok
               AND s.snapshot_date <= d.on_day
             ORDER BY s.snapshot_date DESC
             LIMIT 1) AS era_n
    FROM bdays d
  ),
  dark AS (
    SELECT b.tok, b.at
    FROM batches b
    LEFT JOIN era z ON z.tok = b.tok AND z.on_day = b.on_day
    LEFT JOIN eligible o ON o.tok = b.tok
    WHERE b.n_removed > CASE
             WHEN z.era_n IS NOT NULL THEN GREATEST(5,  0.30 * z.era_n)
             ELSE GREATEST(25, 0.30 * COALESCE(o.n, 0))
           END
  ),
  -- ONE ROW PER ROLE, not per closure event. This is the whole repair.
  --
  -- `closed_at` here is the role's FIRST logged closure, which is the one whose
  -- duration is publishable: for a genuine fill it is the only one, and for a
  -- role that came back no duration is published at all.
  roles AS (
    SELECT
      ev.tok,
      ev.posting_id,
      max(ev.company)                                   AS company,
      count(*)::int                                     AS n_close,
      bool_or(ev.superseded)                            AS superseded,
      bool_or(COALESCE(ev.suspect, false) OR dk.tok IS NOT NULL) AS doubted,
      min(ev.closed_at)                                 AS closed_at,
      (array_agg(ev.posted_at ORDER BY ev.closed_at ASC))[1] AS posted_at
    FROM ev
    -- `dark` is one row per (tok, closed_at) by construction, so this cannot
    -- multiply rows; dk.tok IS NOT NULL is a flag, not a filter.
    LEFT JOIN dark dk ON dk.tok = ev.tok AND dk.at = ev.closed_at
    GROUP BY ev.tok, ev.posting_id
  ),
  -- THREE INDEPENDENT WITNESSES THAT A ROLE CAME BACK, and a role needs only
  -- one of them to stop being a fill:
  --   n_close > 1        the same posting_id closed more than once in 90 days,
  --                      which is what "not unique: reposts re-close" means;
  --   superseded         the collector saw the identical title still live in the
  --                      same pass;
  --   lv.id IS NOT NULL  the posting is serving on the board again today.
  -- The first two are 24h-deduped by the collector and the third only sees roles
  -- that are back RIGHT NOW, so the relist side is a FLOOR and the fill side is
  -- therefore a CEILING. Both are named that way in the returned columns.
  --
  -- A DOUBTED ROLE IS DROPPED FROM BOTH SIDES, never from one. Counting a dark
  -- batch's relists while ruling its fills inadmissible is the asymmetry
  -- 20260906093000 removed from the HAVING; it is not reintroduced here.
  classified AS (
    SELECT
      r.tok, r.company, r.closed_at, r.posted_at,
      (NOT r.doubted) AND r.n_close = 1 AND NOT r.superseded AND lv.id IS NULL AS is_fill,
      (NOT r.doubted) AND (r.n_close > 1 OR r.superseded OR lv.id IS NOT NULL)  AS is_relist
    FROM roles r
    LEFT JOIN live_ids lv ON lv.id = r.posting_id
  ),
  -- The warning's own predicate, so the header and the cards agree. Superseded
  -- events grouped by title, exactly as get_repost_index does it -- suspect rows
  -- deliberately NOT filtered out, because the gate has to match the surface
  -- that renders the sentence, and over-excluding an employer from a
  -- recommendation errs in the safe direction.
  churn AS (
    SELECT ev.tok,
           count(*)::bigint                 AS repost_events,
           count(DISTINCT ev.title)::bigint AS repost_roles
    FROM ev
    WHERE ev.superseded
    GROUP BY ev.tok
  ),
  fills AS (
    SELECT
      c.tok AS company_token,
      max(c.company) AS company,
      count(*) FILTER (WHERE c.is_fill)    AS filled,
      count(*) FILTER (WHERE c.is_relist)  AS relisted,
      LEAST(GREATEST(EXTRACT(DAY FROM now() - min(c.closed_at))::int, 1), 90) AS tracking_days,
      round((percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (c.closed_at - c.posted_at)) / 86400.0
      ) FILTER (
        WHERE c.is_fill
          AND c.posted_at IS NOT NULL
          AND c.closed_at >= c.posted_at
      ))::numeric, 0) AS p50_days_open,
      count(*) FILTER (
        WHERE c.is_fill
          AND c.posted_at IS NOT NULL
          AND c.closed_at >= c.posted_at
      )::int AS dated_n
    FROM classified c
    GROUP BY c.tok
    -- The churn share, on the floor we can see. Relisted roles must be under a
    -- fifth of the roles taken down; the old bar was half, which is where a 49%
    -- employer qualified and then contradicted the section's own blurb on its
    -- own card. Both sides carry the same admissibility, so a doubted batch
    -- cannot fail an employer on evidence this query has already refused.
    HAVING count(*) FILTER (WHERE c.is_fill) >= 3
       AND count(*) FILTER (WHERE c.is_relist) * 5
           <= count(*) FILTER (WHERE c.is_fill OR c.is_relist)
  ),
  -- DISQUALIFIER (a), APPLIED BEFORE THE CURVE RATHER THAN AFTER IT.
  --
  -- This predicate used to sit in the final WHERE, which meant every employer
  -- it excludes was still measured by get_company_fill_curve first. That is the
  -- worst possible ordering: employers clearing get_repost_index's gate are by
  -- definition the ones with the most closure events, so the tokens the curve
  -- spent the most time on were exactly the tokens whose rows were then thrown
  -- away. It is a published rule with no dependence on rank, so moving it
  -- forward removes work without removing anybody the ranking could have shown.
  admissible AS (
    SELECT f.*
    FROM fills f
    LEFT JOIN churn ch ON ch.tok = f.company_token
    WHERE NOT (COALESCE(ch.repost_events, 0) >= 25
               AND COALESCE(ch.repost_events, 0)::numeric
                   / GREATEST(COALESCE(ch.repost_roles, 1), 1) >= 5)
  ),
  -- THE FILL MEASURE, READ RATHER THAN RE-DERIVED. One call, for the surviving
  -- tokens only. Re-implementing Aalen-Johansen here would give this page and
  -- /jobs/company two estimators for one quantity, which is how they came to
  -- publish 400 and 0 for the same employer in the first place.
  --
  -- AND THE ARRAY IS BOUNDED, WHICH THE FIRST DRAFT LEFT UNDONE. It passed
  -- `ARRAY(SELECT company_token FROM fills)` -- every admissible employer --
  -- while `LIMIT GREATEST(p_limit, 1)` was applied in the outer query, AFTER.
  -- refresh_explore_cache calls this with p_limit = 2000, so the outer LIMIT
  -- bounded nothing and the curve was entered with the whole eligible pool
  -- against a function whose own header budgets it at ~200 tokens. Moving
  -- eligibility to the front and leaving that unbounded would have relocated
  -- the timeout rather than removed it.
  --
  -- THE CUT IS ORDER-DEPENDENT AND IS NOT PRETENDED OTHERWISE. Unlike the
  -- >= 100 open-roles gate above, this one can in principle delete an employer
  -- the ranking would have shown: if more than CURVE_TOKEN_BUDGET employers are
  -- admissible, the ones past the cut are never measured and never appear. Two
  -- things keep that honest rather than merely convenient. It is ordered by
  -- dated_n -- how many of the employer's takedowns carry the employer's own
  -- posting date -- which is the sample the curve estimates FROM and the thing
  -- `sufficient` is a statement about, not board size and not raw closures; and
  -- it binds only above 200, where the alternative is not a longer list but no
  -- list at all, because the statement is cancelled and refresh_explore_cache
  -- writes an empty section. A bound that is disclosed and ordered by evidence
  -- depth is not the pre-truncation-by-raw-fills the guard forbids, which cut
  -- to p_limit * 3 by closure volume before open roles were even known.
  curve AS (
    SELECT * FROM public.get_company_fill_curve(
      ARRAY(SELECT a.company_token
              FROM admissible a
             ORDER BY a.dated_n DESC, a.filled DESC, a.company_token
             LIMIT 200))
  )
  SELECT f.company,
         f.company_token,
         f.filled::bigint                        AS closed_90d,
         o.n::bigint                             AS open_roles,
         f.tracking_days,
         f.p50_days_open,
         f.dated_n,
         90                                      AS fills_window_days,
         f.filled::bigint                        AS filled_roles_ceiling,
         f.relisted::bigint                      AS relisted_roles_floor,
         round(f.relisted::numeric / NULLIF(f.filled + f.relisted, 0), 4) AS relist_share_floor,
         COALESCE(ch.repost_events, 0)           AS repost_events_floor,
         cv.fill_rate_14                         AS fill_incidence_14d,
         cv.fill_rate_14_lo                      AS fill_incidence_14d_lo,
         cv.fill_rate_14_hi                      AS fill_incidence_14d_hi,
         cv.n_at_risk_14                         AS at_risk_14d,
         cv.fills_le_14                          AS fills_le_14d,
         cv.dated_coverage                       AS dated_share,
         ver.feed_total,
         -- WHEN THAT NUMBER WAS LAST READ. job_board_verifications holds ONE
         -- ROW PER BOARD and is UPSERTed on every successful fetch, so it has
         -- no history and a board that went dark keeps its last advertised
         -- total forever. Published without its stamp, feed_total is a figure
         -- with no date basis -- the standing rule this product states on every
         -- other number it prints. The caller renders the stamp or suppresses
         -- the number.
         ver.verified_at                         AS feed_total_at
  FROM admissible f
  JOIN open_now o ON o.company_token = f.company_token
  JOIN curve cv ON cv.company_token = f.company_token
  LEFT JOIN churn ch ON ch.tok = f.company_token
  LEFT JOIN public.job_board_verifications ver ON ver.company_token = f.company_token
  WHERE o.n >= 100
    -- SAMPLE-SIZE GATE, HONOURED AS A GATE. get_company_fill_curve refuses to
    -- answer below 25 at risk at day 14, 5 observed fills, a half-width of 0.15
    -- and relists not outnumbering fills. An employer it refuses does not appear
    -- here at all: there is no fallback ordering to drop back to, because the
    -- fallback was the throughput ratio this file exists to delete.
    AND cv.sufficient
    -- Disqualifier (a) is no longer applied here: it is applied in `admissible`
    -- above, before the curve, so the employers it excludes are never measured.
    -- The churn join survives only to publish repost_events_floor.
  -- Ranked on the fill probability itself. Ties break toward the tighter
  -- interval -- the better-evidenced employer, not the bigger one -- and only
  -- then on volume.
  ORDER BY cv.fill_rate_14 DESC,
           (cv.fill_rate_14_hi - cv.fill_rate_14_lo) ASC,
           f.filled DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_actively_hiring_companies(int) IS
  'Employers ranked by the CUMULATIVE-INCIDENCE FILL RATE at 14 days, from '
  'get_company_fill_curve, over a common window and a common denominator. It '
  'was ranked by filled * 100 / open_roles, a throughput-to-inventory ratio '
  'that is unbounded (Accenture scored 2,496%), has a per-employer denominator, '
  'and mixed an 11-day row with a 50-day one as if the counts were comparable. '
  'Only employers whose curve reports sufficient = true are returned; there is '
  'no fallback ordering. Every column, what it measures, and its date basis: '
  '(1) company / company_token: the employer as its board names it. '
  '(2) closed_90d: LEGACY NAME, kept because four consumers read this function '
  'by column name. It is now the count of ROLES the employer took down and did '
  'not bring back, over 90 days of closure history, and it is identical to '
  'filled_roles_ceiling -- read that one. It was a count of closure EVENTS, '
  'which is why /explore published 4,331 fills for an employer holding 220 open '
  'roles across 11 days. '
  '(3) open_roles: an EXACT count of the postings this board will actually '
  'serve -- both serving predicates, so it equals what /jobs/company/{token} '
  'shows. It is NOT a cap: no LIMIT exists anywhere on the path that produces '
  'it. It IS a floor on the employer''s own advertised opening count, because '
  'paginated vendors are read a page at a time (MAX_POSTINGS_PER_VISIT 250, '
  'Workday pages of 20, Oracle of 100), which is why several published values '
  'land on exact multiples of twenty. feed_total is the employer''s own number '
  'where the feed states one; compare the two before reading open_roles as the '
  'size of the employer''s hiring. '
  '(4) tracking_days: DAYS WE HAVE WATCHED THIS EMPLOYER -- from its own first '
  'logged closure, clamped to [1, 90]. Not the age of the closure log. '
  '(5) p50_days_open: median days a filled role stayed up, measured from the '
  'employer''s stated posted_at ALONE (never COALESCEd with our first_seen, '
  'which publishes our discovery date as the employer''s posting date), over '
  'the dated_n roles that carry one. A LOWER BOUND: the ingest stops serving a '
  'posting at 30 days, so no closure can be observed later than that. '
  '(6) dated_n: how many filled roles carried a stated post date, i.e. the '
  'sample behind p50_days_open. '
  '(7) fills_window_days: 90. The window closed_90d, filled_roles_ceiling, '
  'relisted_roles_floor and repost_events_floor are all measured over. Stated '
  'because closed_90d was a 30-day count under a 90-day name. '
  '(8) filled_roles_ceiling: distinct posting_ids that closed exactly once in '
  'the window, were not superseded, and are not serving again today. A CEILING, '
  'not an equality: the collector logs only the first superseded closure per '
  'normalised title per 24h and DELETES the rest, so re-lists it never saw are '
  'counted here as fills. Render it as "up to N", never as "N". '
  '(9) relisted_roles_floor: distinct posting_ids that closed more than once, '
  'or were superseded, or are serving again today. A FLOOR, for the same 24h '
  'dedupe. Render with "at least". '
  '(10) relist_share_floor: relisted / (filled + relisted). A FLOOR. '
  '(11) repost_events_floor: superseded closure events in the window. A FLOOR. '
  '(12) fill_incidence_14d: get_company_fill_curve.fill_rate_14 -- the '
  'Aalen-Johansen cumulative incidence that a role is FILLED within 14 days of '
  'the employer''s stated post date, with re-listing as a competing event and '
  'still-open / aged-out roles censored. This is the ranking key. It is a '
  'CEILING for the dedupe reason above and must render as "up to". '
  '(13/14) fill_incidence_14d_lo / _hi: the curve''s APPROXIMATE 95% interval '
  '(Greenwood on the complementary log-log scale, carried across to the fill '
  'incidence by the observed fill share). Label it an approximation wherever it '
  'renders. '
  '(15) at_risk_14d: observations STILL AT RISK at day 14 -- survivors, i.e. '
  'sum(cnt) WHERE tt >= 14. IT IS NOT THE DENOMINATOR OF fill_incidence_14d '
  'AND DIVIDING BY IT IS WRONG. A cumulative incidence accumulates over the '
  'whole entering cohort, so fills_le_14d / at_risk_14d routinely exceeds 1 '
  '(live 2026-09-07: Ubc 207/120, BBVA 209/54) while the rate is 0.4-0.6. It '
  'is published as the SAMPLE-SIZE GATE the caller checks (>= 25), not as a '
  'quantity to divide by. This comment said "the common denominator the rate '
  'is computed against" for one release: a column whose own description '
  'misnames it is the same defect this whole function was rewritten to remove, '
  'one level up in the schema. '
  '(16) fills_le_14d: observed fills at or before day 14 in that cohort. '
  '(17) dated_share: the share of the risk set carrying a stated post date. '
  'Below it the durations describe a minority of the board and the caller must '
  'refuse to publish the rate (FILL_COVERAGE_MIN). '
  '(18) feed_total: the employer''s own stated opening count from '
  'job_board_verifications, or NULL where the feed states none. '
  '(19) feed_total_at: when that count was last read. job_board_verifications '
  'is one row per board, UPSERTed on every successful fetch, so it keeps no '
  'history and a board that went dark holds its last advertised total forever. '
  'feed_total has no date basis without this column and must not be published '
  'without it. '
  'WHAT THE RANKING CANNOT SEE, STATED BECAUSE IT IS NOT FIXABLE HERE. The '
  'collector logs only the FIRST superseded closure per normalised title per '
  'employer per 24h and DELETES the rest, so deduped re-listings are absent '
  'from the curve''s risk set rather than present in it as competing events. '
  'That raises the estimated incidence at every day, and it raises it MORE for '
  'employers that re-list more -- fill_incidence_14d is an upper bound whose '
  'looseness grows with the very churn this section excludes. Every gate above '
  'reads the post-dedupe FLOOR, so an employer whose re-listing we cannot see '
  'can clear all three and rank first. Concretely: 800 same-title re-lists '
  'across 10 titles leave 10 visible rows, which is under get_repost_index''s '
  '25-event bar, under the 20% share bar, and inside `sufficient`. This '
  'function cannot distinguish that employer from a genuine filler, and no '
  'gate here can, because the evidence was discarded upstream. The repair '
  'belongs in the collector -- keep one row per deduped re-list, or a repeat '
  'count on the row it keeps -- and until it lands, every surface rendering '
  'this ranking must say the rate cannot see re-listings we never logged. '
  'INDEX NOTE, DECLINED WITH ITS REASON. `ev` selects posting_id and title, '
  'neither of which is in job_board_closures_curve_idx''s INCLUDE list, so the '
  'closure scan takes a heap fetch per row instead of running index-only. '
  'Adding both would fix that and was NOT done: they are the two widest text '
  'columns on the table, and that index sits on the collector''s hot 200-row '
  'closure inserts, a path 20260906090000 already narrowed for write cost '
  'under WORKER_RESOURCE_LIMIT pressure. Random heap access on an hourly job '
  'is the cheaper side of that trade. The term that governs this statement''s '
  'runtime is the size of `eligible` and the 200-token bound on the curve '
  'call, not the access method. '
  'DISQUALIFICATION: an employer is excluded when its re-listed roles reach a '
  'fifth of its takedowns, or when it clears get_repost_index''s own gate '
  '(>= 25 superseded events at >= 5 per affected title). The second is what '
  'makes the section''s blurb true: no card here can carry the "Re-lists roles" '
  'warning, which four cards in this very section were rendering while the '
  'blurb called them disqualified. The index measures 180 days and this gate '
  'measures 90; the log holds ~54 days today so they see the same population, '
  'and this gate must be widened when it does not. '
  'SUSPECT AND FEED-DARK BATCHES: excluded from both sides of every count, on '
  'the same threshold and the same era-appropriate denominator '
  'get_company_fill_curve uses, so the two cannot publish different fill counts '
  'for one employer.';
