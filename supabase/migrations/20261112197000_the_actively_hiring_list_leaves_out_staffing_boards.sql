-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- THE ACTIVELY HIRING LIST LEAVES OUT STAFFING BOARDS (bug round NB-5).
--
-- /ghost-job-index's "Actively hiring" list ranked recruiting intermediaries
-- as hiring employers: on 2026-11-15 the hourly cache put Weekday AI first and
-- Distro fifth. Every Weekday posting is for one of its clients, and Distro's
-- board advertises other firms' roles, so their takedowns are other companies'
-- roles closing, not their own hiring. The owner chose on 2026-11-16 to leave
-- staffing, recruiting and job-ad intermediaries out of the list; they stay on
-- the board, labelled.
--
-- WHY NOT THE SHOWCASE EXCLUSION TABLE. The eligible CTE already skips it, but
-- a dozen other readers skip it too (today's takedowns, the weekly trend,
-- /explore, the company page's panels). A row there would take the board out
-- of every figure, which is not what the owner chose.
--
-- The body is 20260909201000's, copied whole, with two changes in its first
-- two CTEs. open_now also reports whether any open row of the board carries the
-- catalogue's agency flag, from the scan it already makes (the catalogue
-- stamps a board's flag on all of its rows or none). eligible then drops a
-- flagged board, and three intermediaries the catalogue does not flag yet by
-- token: two of them sit in packed catalogue rows that cannot carry the flag,
-- which the board lane splits. Signature, columns, SECURITY DEFINER,
-- search_path, statement_timeout, comment and grants are unchanged; the
-- comment gains one sentence, once.

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
    SELECT company_token, count(*)::int AS n, bool_or(agency) AS agency
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
      -- A staffing or recruiting board's takedowns are its clients' roles
      -- closing, not its own hiring: it stays on the board, labelled, and is
      -- left out of this list (owner, 2026-11-16). The catalogue's flag first;
      -- three intermediaries it does not flag yet, by token.
      AND NOT o.agency
      AND o.company_token <> ALL (ARRAY['weekday-1', 'distro', 'mercier-consultancy-group'])
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
      -- ONE PLACE, BECAUSE THERE IS ONE READ. Every count, share, median and
      -- span below is derived from `ev`, so the whole function inherits the
      -- admissibility decision from this line.
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
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

DO $$
DECLARE c text;
BEGIN
  c := COALESCE(obj_description('public.get_actively_hiring_companies(integer)'::regprocedure, 'pg_proc'), '');
  IF position('STAFFING BOARDS (20261112197000)' IN c) = 0 THEN
    EXECUTE format('COMMENT ON FUNCTION public.get_actively_hiring_companies(int) IS %L',
      c || ' STAFFING BOARDS (20261112197000): a board the catalogue flags as a '
        || 'staffing or recruiting agency, and three intermediaries it does not '
        || 'flag yet (Weekday AI, Distro, Mercier Consultancy Group), are not '
        || 'eligible: their takedowns are their clients'' roles closing. They stay '
        || 'on the board, labelled.');
  END IF;
END $$;

-- Self-verifying, and safe to re-run: one definition, carrying both changes.
DO $$
DECLARE n int; src text;
BEGIN
  SELECT count(*), max(p.prosrc) INTO n, src
  FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
  WHERE s.nspname = 'public' AND p.proname = 'get_actively_hiring_companies';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_actively_hiring_companies: % definitions, expected 1', n;
  END IF;
  IF position('bool_or(agency) AS agency' IN src) = 0 OR position('AND NOT o.agency' IN src) = 0 THEN
    RAISE EXCEPTION 'get_actively_hiring_companies: the agency flag does not reach the eligible boards';
  END IF;
  IF position('''weekday-1'', ''distro'', ''mercier-consultancy-group''' IN src) = 0 THEN
    RAISE EXCEPTION 'get_actively_hiring_companies: the three unflagged intermediaries are still eligible';
  END IF;
  IF position('STAFFING BOARDS (20261112197000)' IN
       COALESCE(obj_description('public.get_actively_hiring_companies(integer)'::regprocedure, 'pg_proc'), '')) = 0 THEN
    RAISE EXCEPTION 'get_actively_hiring_companies: its contract does not say staffing boards are left out';
  END IF;
END $$;
