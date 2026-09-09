-- THE SAME LATE CLOSED_AT, IN THIRTEEN MORE PLACES.
--
-- The middle file of 20260909200000's change, whose header is the argument for
-- all three and is not repeated here: a 'lap_backfill' closure carries a
-- closed_at that is knowingly late by up to the freshness window, so it may not
-- date any duration, rate or tenure. That file re-issues the two fill curves,
-- 20260909202000 re-issues get_board_flow (which needs a file to itself, for a
-- reason its own header gives), and this one re-issues the other thirteen
-- functions that read job_board_closures.closed_at. The section numbers below
-- are continuous across the three files.
--
-- It applies immediately after its sibling, and must: get_actively_hiring_
-- companies below calls get_company_fill_curve, which that file defines.
--
-- ONE COMMENT IS NOT A COPY OF ITS DEFINING MIGRATION'S. get_actively_hiring_
-- companies was defined in 20260907010000 and its COMMENT was CORRECTED in
-- 20260908120000, by a DO block that rewrote the stored text in place -- the
-- at_risk_14d line, which had called a survivor count "the common denominator
-- the rate is computed against" when fills_le_14d / at_risk_14d routinely
-- exceeds 1. Re-issuing the comment from the defining file would have restored
-- the falsehood the later migration exists to have removed, with
-- a-sample-size-is-not-a-denominator.test.ts green over it, because that guard
-- reads the newest file that declares the column. The corrected wording is
-- carried below verbatim.

SET LOCAL statement_timeout = '5min';

-- ── 3. the deprecated category median ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_category_fill_speed(
  p_days integer DEFAULT 90,
  p_min_closures integer DEFAULT 300
)
RETURNS TABLE (
  category text,
  closures bigint,
  median_days_open numeric,
  p75_days_open numeric,
  window_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH open_now AS (
    SELECT company_token AS tok, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  -- The same retroactive feed-dark proxy the curve RPCs run, on the same
  -- era-appropriate denominator. Without it a dark feed's several hundred
  -- one-second removals -- which sit at ~1 day since posting -- drag this
  -- category median down, while every other surface excludes them. The extra
  -- grouped pass is what the timeout went from 15s to 30s to pay for.
  batches AS (
    SELECT c.company_token AS tok, c.closed_at AS at,
           date_trunc('day', c.closed_at)::date AS on_day,
           count(*)::int AS n_removed
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
      AND c.batch_live_before IS NULL
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token, c.closed_at, date_trunc('day', c.closed_at)::date
  ),
  sized AS (
    -- Era board size as a scalar subquery, not a lateral join: the guard on
    -- get_actively_hiring_companies forbids the word, correctly, because a
    -- per-company lateral counting open roles is what forced the leaderboard to
    -- pre-truncate. This is a primary-key seek per BATCH into a 35-day table,
    -- not a count per company, but the guard should keep its teeth and the
    -- spelling should change instead.
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
  )
  SELECT
    c.category,
    count(*)::bigint AS closures,
    round(percentile_cont(0.5) WITHIN GROUP (
      ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
    )::numeric, 1) AS median_days_open,
    round(percentile_cont(0.75) WITHIN GROUP (
      ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
    )::numeric, 1) AS p75_days_open,
    LEAST(
      LEAST(GREATEST(p_days, 7), 365),
      (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
         FROM public.job_board_closures
        WHERE absence_basis IS DISTINCT FROM 'lap_backfill')
    ) AS window_days
  FROM public.job_board_closures c
  LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
  WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
    AND c.category <> ''
    AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    AND NOT c.superseded
    AND NOT COALESCE(c.suspect, false)
    AND dk.tok IS NULL
    AND c.posted_at IS NOT NULL
    AND c.closed_at >= c.posted_at
    AND c.closed_at - c.posted_at <= interval '365 days'
  GROUP BY c.category
  HAVING count(*) >= GREATEST(p_min_closures, 50)
  ORDER BY median_days_open ASC;
$$;
COMMENT ON FUNCTION public.get_category_fill_speed(integer, integer) IS
  'DEPRECATED — use get_category_fill_curve. Kept only so callers can migrate '
  'without a dark window. DATE BASIS: durations are measured from the '
  'employer''s stated posted_at ALONE over the closures that carry one, and '
  'relists and suspect batches are excluded. The age rule that deleted every '
  'closure occurring within a week of posting is gone; it was meant to suppress '
  'relist churn and what it removed was every fast fill. THE REMAINING NUMBER '
  'IS STILL CENSORED and is a LOWER BOUND: the ingest stops serving a posting '
  'at 30 days, so nothing can be observed to close later than that, which is '
  'why this function reported 14.9 to 16.3 days across all eighteen categories '
  'on 2026-09-06 — the midpoint of our own retention cap, not a property of any '
  'labour market. Do not render it as a typical time-to-fill.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'That exclusion matters more here than anywhere: this median is already '
  'the midpoint of our own retention cap, and a backlog''s worth of '
  'one-day durations would drag it below even that.';
GRANT EXECUTE ON FUNCTION public.get_category_fill_speed(integer, integer) TO anon, authenticated, service_role;

-- ── 4. the company lander summary ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE(company_token text, open_roles integer, closed_90d integer, superseded_90d integer, median_days_open numeric, median_days_to_close numeric, tracking_days integer, feed_total integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH toks AS (SELECT DISTINCT unnest(p_tokens) AS t),
  -- Retroactive feed-dark proxy, identical in shape and threshold to the one in
  -- get_company_fill_curve, so the company lander and the curve card cannot
  -- publish two different fill counts for the same employer. It applies only to
  -- unstamped history (batch_live_before IS NULL); the collector stamps its own
  -- batch now, so this retires itself. The denominator is the board size AT THE
  -- TIME of the batch -- today's count deletes exactly the employer that filled
  -- a hiring class and then shrank.
  open_now AS (
    SELECT p.company_token AS tok, count(*)::int AS n
    FROM public.job_board_postings p
    WHERE p.company_token = ANY (p_tokens)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token
  ),
  batches AS (
    SELECT c.company_token AS tok, c.closed_at AS at,
           date_trunc('day', c.closed_at)::date AS on_day,
           count(*)::int AS n_removed
    FROM public.job_board_closures c
    WHERE c.company_token = ANY (p_tokens)
      AND c.closed_at > now() - interval '90 days'
      AND c.batch_live_before IS NULL
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token, c.closed_at, date_trunc('day', c.closed_at)::date
  ),
  sized AS (
    -- Era board size as a scalar subquery, not a lateral join: the guard on
    -- get_actively_hiring_companies forbids the word, correctly, because a
    -- per-company lateral counting open roles is what forced the leaderboard to
    -- pre-truncate. This is a primary-key seek per BATCH into a 35-day table,
    -- not a count per company, but the guard should keep its teeth and the
    -- spelling should change instead.
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
  span AS (
    SELECT t.t AS company_token,
           LEAST(GREATEST(COALESCE(
             EXTRACT(DAY FROM now() - (SELECT min(c.closed_at) FROM public.job_board_closures c
                WHERE c.company_token = t.t AND c.absence_basis IS DISTINCT FROM 'lap_backfill'))::int,
             EXTRACT(DAY FROM now() - (SELECT min(p.first_seen) FROM public.job_board_postings p WHERE p.company_token = t.t))::int,
             0), 0), 90) AS days
    FROM toks t
  ),
  live AS (
    SELECT company_token, count(*)::int AS open_roles,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0))
             FILTER (WHERE posted_at IS NOT NULL))::numeric AS median_days_open
    FROM public.job_board_postings
    WHERE company_token = ANY (p_tokens)
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  closed AS (
    -- A batch the collector marked suspect is a collection failure recorded as
    -- several hundred takedowns in one second; it is excluded here, not counted
    -- and then explained away downstream. So is an unstamped batch the
    -- retroactive proxy flags, on the same threshold the curve RPCs use.
    --
    -- THE SUSPECT TEST IS ON BOTH COUNTS, NOT JUST THE FILLS. An earlier draft
    -- excluded suspect batches from closed_90d and from the median while leaving
    -- superseded_90d counting them, which inflated the published relist floor
    -- with our own outage -- and, worse, fed the same asymmetry into
    -- get_actively_hiring_companies' HAVING, where a dark batch's superseded
    -- minority was compared against a fill count that had already ruled the
    -- batch inadmissible.
    SELECT c.company_token,
           count(*) FILTER (
             WHERE c.closed_at > now() - interval '90 days'
               AND NOT c.superseded
               AND NOT COALESCE(c.suspect, false)
               AND dk.tok IS NULL
           )::int AS closed_90d,
           count(*) FILTER (
             WHERE c.closed_at > now() - interval '90 days'
               AND c.superseded
               AND NOT COALESCE(c.suspect, false)
               AND dk.tok IS NULL
           )::int AS superseded_90d,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.closed_at - c.posted_at)) / 86400.0)
             FILTER (WHERE c.closed_at > now() - interval '90 days'
                       AND NOT c.superseded
                       AND NOT COALESCE(c.suspect, false)
                       AND dk.tok IS NULL
                       AND c.posted_at IS NOT NULL
                       AND c.closed_at >= c.posted_at))::numeric AS median_days_to_close
    FROM public.job_board_closures c
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    WHERE c.company_token = ANY (p_tokens)
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token
  ),
  ver AS (
    SELECT company_token, feed_total FROM public.job_board_verifications
    WHERE company_token = ANY (p_tokens)
  )
  SELECT toks.t AS company_token,
         COALESCE(live.open_roles, 0),
         COALESCE(closed.closed_90d, 0),
         COALESCE(closed.superseded_90d, 0),
         live.median_days_open,
         closed.median_days_to_close,
         span.days,
         ver.feed_total
  FROM toks
  LEFT JOIN live   ON live.company_token   = toks.t
  LEFT JOIN closed ON closed.company_token = toks.t
  LEFT JOIN ver    ON ver.company_token    = toks.t
  LEFT JOIN span   ON span.company_token   = toks.t;
$$;
COMMENT ON FUNCTION public.get_company_hiring_health(text[]) IS
  'Per-employer lifecycle summary. open_roles applies BOTH serving predicates '
  'so it matches /jobs/company/{token}. tracking_days is PER COMPANY (its own '
  'first closure, falling back to when we first saw its board) — it was the age '
  'of the entire closure log, which made every new board report a long window '
  'with no fills, and silence read as a verdict. DATE BASIS: '
  'median_days_to_close is measured from the employer''s stated posted_at '
  'ALONE and covers only closures that carry one; median_days_open is the age '
  'of currently-served roles on the same basis. Both are LOWER BOUNDS -- the '
  'ingest stops serving a posting at 30 days, so no closure can ever be '
  'observed later than that, and neither number may be rendered as a typical '
  'time-to-fill. closed_90d and median_days_to_close now share one filter; they '
  'were computed over different populations and rendered side by side as one '
  'fact, which is why gici~wd5~Careers published 41 closures next to a null '
  'median on 2026-09-06. superseded_90d is a FLOOR, not a count: the collector '
  'logs one superseded closure per title per 24h. Prefer '
  'get_company_fill_curve, which censors rather than deletes the roles that did '
  'not close and discloses dated coverage instead of conditioning on it. '
  'THE COUNT AND THE MEDIAN STILL COME FROM DIFFERENT SAMPLES, and this function '
  'has no column that can say by how much. They now share every filter they can '
  '-- the seven-day floor is gone from both, suspect and feed-dark batches are '
  'excluded from both, and superseded_90d is filtered the same way rather than '
  'being the one count that admitted our own outage -- but the median '
  'additionally requires a stated posted_at, because a duration cannot be '
  'computed without an origin. gici~wd5~Careers therefore still returns a '
  'closure count next to a null median, and after this change the count is '
  'LARGER: none of its closures carries an employer post date. That gap is '
  'dated coverage and it is real; get_company_fill_curve publishes it as '
  'dated_coverage / dated_n / undated_n and is the surface to read for it. '
  'Adding a dated_n column here would change the return type, and four '
  'consumers plus a post-publish deploy gate read this function by column name.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'It is excluded from closed_90d, superseded_90d, median_days_to_close '
  'and tracking_days alike -- one filter across the four, because the '
  'asymmetry that let one count admit what another refused is the defect '
  'this function''s own header spends its length on.';
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated, service_role;

-- ── 5. the employer benchmark table ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_employer_benchmarks(
  p_days integer DEFAULT 90,
  p_min_closures integer DEFAULT 25,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  company text,
  closures bigint,
  median_days_open numeric,
  window_days integer,
  observed_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH open_now AS (
    SELECT company_token AS tok, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  -- Same retroactive feed-dark proxy, same era denominator. A dark batch of
  -- several hundred one-second removals lands at ~1 day since posting and would
  -- otherwise make the employer that had the outage look like the fastest
  -- employer on the page. The timeout went from 20s to 30s to pay for the pass.
  batches AS (
    SELECT c.company_token AS tok, c.closed_at AS at,
           date_trunc('day', c.closed_at)::date AS on_day,
           count(*)::int AS n_removed
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
      AND c.batch_live_before IS NULL
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token, c.closed_at, date_trunc('day', c.closed_at)::date
  ),
  sized AS (
    -- Era board size as a scalar subquery, not a lateral join: the guard on
    -- get_actively_hiring_companies forbids the word, correctly, because a
    -- per-company lateral counting open roles is what forced the leaderboard to
    -- pre-truncate. This is a primary-key seek per BATCH into a 35-day table,
    -- not a count per company, but the guard should keep its teeth and the
    -- spelling should change instead.
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
  q AS (
    SELECT
      c.company,
      extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0 AS days_open,
      c.closed_at
    FROM public.job_board_closures c
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
      AND c.company <> ''
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      AND c.posted_at IS NOT NULL
      AND NOT c.superseded
      AND NOT COALESCE(c.suspect, false)
      AND dk.tok IS NULL
      AND c.closed_at >= c.posted_at
      AND c.closed_at - c.posted_at <= interval '365 days'
  ),
  depth AS (
    SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer AS d
    FROM q
  )
  SELECT
    q.company,
    count(*)::bigint AS closures,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY q.days_open)::numeric, 1) AS median_days_open,
    (SELECT d FROM depth) AS window_days,
    (SELECT d FROM depth) AS observed_days
  FROM q
  GROUP BY q.company
  HAVING count(*) >= GREATEST(p_min_closures, 5)
  ORDER BY median_days_open ASC, closures DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;
COMMENT ON FUNCTION public.get_employer_benchmarks(integer, integer, integer) IS
  'Median days a filled role stayed posted, per employer. DATE BASIS: the '
  'employer''s stated posted_at ALONE, over the closures that carry one — the '
  'caption on /ghost-job-index claimed "or our first sighting, where no date is '
  'published", which was our discovery time published as an employer''s posting '
  'date and is no longer true of this function. Relists and suspect batches are '
  'excluded, and the rule that deleted every closure occurring within a week of '
  'posting is gone. THE NUMBER IS STILL CENSORED at the 30-day serving cap and '
  'is a LOWER BOUND on true time-to-fill; prefer get_category_fill_curve, which '
  'reports a fill rate at a horizon that fits inside the window.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'This is a LEADERBOARD ORDERED BY SPEED, so an admitted backlog would '
  'not merely blur it: a board whose first lap lands a month of takedowns '
  'on one day would take the top of the page for being fastest, on the '
  'strength of our own late observation. depth/window_days derive from q, '
  'which is already filtered.';
GRANT EXECUTE ON FUNCTION public.get_employer_benchmarks(integer, integer, integer) TO anon, authenticated, service_role;

-- ── 6. the who-is-hiring leaderboard ───────────────────────────────────────
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
COMMENT ON FUNCTION public.get_actively_hiring_companies(int) IS
  'Employers ranked by the CUMULATIVE-INCIDENCE FILL RATE at 14 days, from '
  'get_company_fill_curve, over a common window and a common denominator. It '
  'was ranked by filled * 100 / open_roles, a throughput-to-inventory ratio '
  'that is unbounded (Accenture scored 2,496%), has a per-employer '
  'denominator, and mixed an 11-day row with a 50-day one as if the counts '
  'were comparable. Only employers whose curve reports sufficient = true are '
  'returned; there is no fallback ordering. Every column, what it measures, '
  'and its date basis: (1) company / company_token: the employer as its board '
  'names it. (2) closed_90d: LEGACY NAME, kept because four consumers read '
  'this function by column name. It is now the count of ROLES the employer '
  'took down and did not bring back, over 90 days of closure history, and it '
  'is identical to filled_roles_ceiling -- read that one. It was a count of '
  'closure EVENTS, which is why /explore published 4,331 fills for an '
  'employer holding 220 open roles across 11 days. (3) open_roles: an EXACT '
  'count of the postings this board will actually serve -- both serving '
  'predicates, so it equals what /jobs/company/{token} shows. It is NOT a '
  'cap: no LIMIT exists anywhere on the path that produces it. It IS a floor '
  'on the employer''s own advertised opening count, because paginated vendors '
  'are read a page at a time (MAX_POSTINGS_PER_VISIT 250, Workday pages of '
  '20, Oracle of 100), which is why several published values land on exact '
  'multiples of twenty. feed_total is the employer''s own number where the '
  'feed states one; compare the two before reading open_roles as the size of '
  'the employer''s hiring. (4) tracking_days: DAYS WE HAVE WATCHED THIS '
  'EMPLOYER -- from its own first logged closure, clamped to [1, 90]. Not the '
  'age of the closure log. (5) p50_days_open: median days a filled role '
  'stayed up, measured from the employer''s stated posted_at ALONE (never '
  'COALESCEd with our first_seen, which publishes our discovery date as the '
  'employer''s posting date), over the dated_n roles that carry one. A LOWER '
  'BOUND: the ingest stops serving a posting at 30 days, so no closure can be '
  'observed later than that. (6) dated_n: how many filled roles carried a '
  'stated post date, i.e. the sample behind p50_days_open. (7) '
  'fills_window_days: 90. The window closed_90d, filled_roles_ceiling, '
  'relisted_roles_floor and repost_events_floor are all measured over. Stated '
  'because closed_90d was a 30-day count under a 90-day name. (8) '
  'filled_roles_ceiling: distinct posting_ids that closed exactly once in the '
  'window, were not superseded, and are not serving again today. A CEILING, '
  'not an equality: the collector logs only the first superseded closure per '
  'normalised title per 24h and DELETES the rest, so re-lists it never saw '
  'are counted here as fills. Render it as "up to N", never as "N". (9) '
  'relisted_roles_floor: distinct posting_ids that closed more than once, or '
  'were superseded, or are serving again today. A FLOOR, for the same 24h '
  'dedupe. Render with "at least". (10) relist_share_floor: relisted / '
  '(filled + relisted). A FLOOR. (11) repost_events_floor: superseded closure '
  'events in the window. A FLOOR. (12) fill_incidence_14d: '
  'get_company_fill_curve.fill_rate_14 -- the Aalen-Johansen cumulative '
  'incidence that a role is FILLED within 14 days of the employer''s stated '
  'post date, with re-listing as a competing event and still-open / aged-out '
  'roles censored. This is the ranking key. It is a CEILING for the dedupe '
  'reason above and must render as "up to". (13/14) fill_incidence_14d_lo / '
  '_hi: the curve''s APPROXIMATE 95% interval (Greenwood on the complementary '
  'log-log scale, carried across to the fill incidence by the observed fill '
  'share). Label it an approximation wherever it renders. (15) at_risk_14d: '
  'observations STILL AT RISK at day 14 -- survivors, i.e. sum(cnt) WHERE tt '
  '>= 14. IT IS NOT THE DENOMINATOR OF fill_incidence_14d AND DIVIDING BY IT '
  'IS WRONG: a cumulative incidence accumulates over the whole entering '
  'cohort, so fills_le_14d / at_risk_14d routinely exceeds 1 (live '
  '2026-09-07: Ubc 207/120, BBVA 209/54) while the rate is 0.4-0.6. It is '
  'published as the SAMPLE-SIZE GATE the caller checks (>= 25), never as a '
  'quantity to divide by. (16) fills_le_14d: observed fills at or before day '
  '14 in that cohort. (17) dated_share: the share of the risk set carrying a '
  'stated post date. Below it the durations describe a minority of the board '
  'and the caller must refuse to publish the rate (FILL_COVERAGE_MIN). (18) '
  'feed_total: the employer''s own stated opening count from '
  'job_board_verifications, or NULL where the feed states none. (19) '
  'feed_total_at: when that count was last read. job_board_verifications is '
  'one row per board, UPSERTed on every successful fetch, so it keeps no '
  'history and a board that went dark holds its last advertised total '
  'forever. feed_total has no date basis without this column and must not be '
  'published without it. WHAT THE RANKING CANNOT SEE, STATED BECAUSE IT IS '
  'NOT FIXABLE HERE. The collector logs only the FIRST superseded closure per '
  'normalised title per employer per 24h and DELETES the rest, so deduped '
  're-listings are absent from the curve''s risk set rather than present in it '
  'as competing events. That raises the estimated incidence at every day, and '
  'it raises it MORE for employers that re-list more -- fill_incidence_14d is '
  'an upper bound whose looseness grows with the very churn this section '
  'excludes. Every gate above reads the post-dedupe FLOOR, so an employer '
  'whose re-listing we cannot see can clear all three and rank first. '
  'Concretely: 800 same-title re-lists across 10 titles leave 10 visible '
  'rows, which is under get_repost_index''s 25-event bar, under the 20% share '
  'bar, and inside `sufficient`. This function cannot distinguish that '
  'employer from a genuine filler, and no gate here can, because the evidence '
  'was discarded upstream. The repair belongs in the collector -- keep one '
  'row per deduped re-list, or a repeat count on the row it keeps -- and '
  'until it lands, every surface rendering this ranking must say the rate '
  'cannot see re-listings we never logged. INDEX NOTE, DECLINED WITH ITS '
  'REASON. `ev` selects posting_id and title, neither of which is in '
  'job_board_closures_curve_idx''s INCLUDE list, so the closure scan takes a '
  'heap fetch per row instead of running index-only. Adding both would fix '
  'that and was NOT done: they are the two widest text columns on the table, '
  'and that index sits on the collector''s hot 200-row closure inserts, a path '
  '20260906090000 already narrowed for write cost under WORKER_RESOURCE_LIMIT '
  'pressure. Random heap access on an hourly job is the cheaper side of that '
  'trade. The term that governs this statement''s runtime is the size of '
  '`eligible` and the 200-token bound on the curve call, not the access '
  'method. DISQUALIFICATION: an employer is excluded when its re-listed roles '
  'reach a fifth of its takedowns, or when it clears get_repost_index''s own '
  'gate (>= 25 superseded events at >= 5 per affected title). The second is '
  'what makes the section''s blurb true: no card here can carry the "Re-lists '
  'roles" warning, which four cards in this very section were rendering while '
  'the blurb called them disqualified. The index measures 180 days and this '
  'gate measures 90; the log holds ~54 days today so they see the same '
  'population, and this gate must be widened when it does not. SUSPECT AND '
  'FEED-DARK BATCHES: excluded from both sides of every count, on the same '
  'threshold and the same era-appropriate denominator get_company_fill_curve '
  'uses, so the two cannot publish different fill counts for one '
  'employer. ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, so '
  'its closed_at is the day we could finally see it and is late by an unknown '
  'amount up to the freshness window. It is a count of events, never a dated '
  'one -- see COMMENT ON COLUMN public.job_board_closures.absence_basis, and '
  'get_closure_population() for how many such rows exist. The exclusion is '
  'applied once, in `ev`, which is this function''s only read of the closure '
  'log; filled_roles_ceiling, relisted_roles_floor, p50_days_open, dated_n '
  'and tracking_days all derive from it, and fill_incidence_14d comes from '
  'get_company_fill_curve, which carries the same rule.';
GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated, service_role;

-- ── 7. the Ghost Job Index rollup ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_ghost_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15min'
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
  open_n   bigint;
  dated_n  bigint;
  tokens_n bigint;
  names_n  bigint;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_stats_rollup WHERE k = 'ghost_stats';

  -- The four postings counts, in a single sequential pass.
  --
  -- SAME DEFINITIONS AS EVER, and two of them were incidents:
  --   * every count filters missing_since IS NULL — a column headed "open
  --     postings" must mean postings the board will actually serve;
  --   * total_company_names groups on the RAW company string, the same key
  --     get_size_segments uses, so the headline and the segments page cannot
  --     disagree about what one employer is.
  BEGIN
    SET LOCAL statement_timeout = '8min';
    SELECT
      count(*) FILTER (WHERE missing_since IS NULL),
      count(posted_at) FILTER (WHERE missing_since IS NULL),
      count(DISTINCT company_token) FILTER (WHERE missing_since IS NULL),
      count(DISTINCT company) FILTER (WHERE missing_since IS NULL AND company <> '')
    INTO open_n, dated_n, tokens_n, names_n
    FROM public.job_board_postings;

    payload := jsonb_build_object(
      'total_open',          open_n,
      'total_companies',     tokens_n,
      'total_company_names', names_n,
      -- Kept in the payload because GhostJobIndex gates its coverage caveat on
      -- it; when the column went missing the caveat never rendered once.
      'posted_coverage_pct',
        CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'counts'::text;
    payload := jsonb_build_object(
      'total_open',          prev -> 'total_open',
      'total_companies',     prev -> 'total_companies',
      'total_company_names', prev -> 'total_company_names',
      'posted_coverage_pct', prev -> 'posted_coverage_pct');
    WHEN OTHERS THEN
    stale := stale || 'counts'::text;
    payload := jsonb_build_object(
      'total_open',          prev -> 'total_open',
      'total_companies',     prev -> 'total_companies',
      'total_company_names', prev -> 'total_company_names',
      'posted_coverage_pct', prev -> 'posted_coverage_pct');
  END;

  -- Posting-age median. From the EMPLOYER's stated posted_at and never from
  -- first_seen, which is when WE noticed: on 4,179 rows carrying both, the two
  -- bases differ by 17.6 days at the median and the published figure was the
  -- flattering one. Sorts only the dated, still-served subset.
  BEGIN
    SET LOCAL statement_timeout = '5min';
    payload := payload || jsonb_build_object('median_days_open', (
      SELECT round(percentile_cont(0.5) WITHIN GROUP (
               ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0)
             )::numeric, 1)
      FROM public.job_board_postings
      WHERE missing_since IS NULL AND posted_at IS NOT NULL));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'median_days_open'::text;
    payload := payload || jsonb_build_object('median_days_open', prev -> 'median_days_open');
    WHEN OTHERS THEN
    stale := stale || 'median_days_open'::text;
    payload := payload || jsonb_build_object('median_days_open', prev -> 'median_days_open');
  END;

  -- Closure-derived figures. A different, far smaller table.
  BEGIN
    SET LOCAL statement_timeout = '2min';
    payload := payload || jsonb_build_object(
      'closed_90d', (SELECT count(*) FROM public.job_board_closures
                      WHERE closed_at > now() - interval '90 days'
                        AND NOT superseded
                        AND NOT COALESCE(suspect, false)
                        AND absence_basis IS DISTINCT FROM 'lap_backfill'),
      'observed_days', (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
                          FROM public.job_board_closures
                         WHERE absence_basis IS DISTINCT FROM 'lap_backfill'),
      'median_days_to_close', (
        SELECT round((percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
        FROM public.job_board_closures
        WHERE closed_at > now() - interval '90 days'
          AND NOT superseded
          AND NOT COALESCE(suspect, false)
          AND posted_at IS NOT NULL
          AND absence_basis IS DISTINCT FROM 'lap_backfill'
          AND closed_at >= posted_at));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'closures'::text;
    payload := payload || jsonb_build_object(
      'closed_90d',           prev -> 'closed_90d',
      'observed_days',        prev -> 'observed_days',
      'median_days_to_close', prev -> 'median_days_to_close');
    WHEN OTHERS THEN
    stale := stale || 'closures'::text;
    payload := payload || jsonb_build_object(
      'closed_90d',           prev -> 'closed_90d',
      'observed_days',        prev -> 'observed_days',
      'median_days_to_close', prev -> 'median_days_to_close');
  END;

  -- ALWAYS write. A row that says "these three parts are stale" is worth far
  -- more than no row, which is what the previous all-or-nothing version left
  -- behind through two cron ticks and a migration seed.
  payload := payload || jsonb_build_object('stale_parts', to_jsonb(stale));

  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  VALUES ('ghost_stats', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;
COMMENT ON FUNCTION public.refresh_ghost_stats() IS
  'Recomputes the Ghost Job Index payload into job_board_stats_rollup '
  'k = ''ghost_stats'', in parts, each part falling back to its previous '
  'value and naming itself in stale_parts rather than losing the whole row. '
  'get_ghost_job_index_stats() serves what this writes and computes nothing '
  'itself, so the admissibility rule lives here -- the surface it feeds '
  '(/ghost-job-index) cannot state a basis its writer did not apply. DATE '
  'BASIS: median_days_open is the age of still-served postings from the '
  'employer''s stated posted_at alone; median_days_to_close is '
  'closed_at - posted_at on the same basis. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'Both, plus closed_90d and observed_days, exclude it. observed_days is '
  'the one that would have gone backwards: it is the age of the log, and a '
  'backfilled board arriving with today''s closed_at cannot shorten it, '
  'but a future prune that left backfill rows as the OLDEST surviving ones '
  'would have lengthened it with a date nobody may trust.';
REVOKE ALL ON FUNCTION public.refresh_ghost_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ghost_stats() TO service_role;
-- ── 8. the permanent archive ───────────────────────────────────────────────
--
-- THIS IS THE ONE THAT CANNOT BE FIXED LATER. roll_up_and_prune_closures bakes
-- its aggregates into job_board_closure_rollup and then DELETES the rows, so a
-- month rolled with backfilled durations in its p50 keeps them forever and no
-- later query can separate them. The rollup is also where the excluded events
-- would vanish entirely, which is why the count moves into a column of its own
-- rather than being dropped: a lap_backfill row is a real takedown with an
-- unusable date, and `fills` minus that is a smaller population than it was.
ALTER TABLE public.job_board_closure_rollup
  ADD COLUMN IF NOT EXISTS backfill_n integer;

COMMENT ON COLUMN public.job_board_closure_rollup.backfill_n IS
  'Closures in this month whose absence_basis is ''lap_backfill'': real '
  'takedowns, observed on a big board''s first proven laps, whose closed_at is '
  'the day we could finally see them and is late by up to the freshness '
  'window. They are counted HERE and nowhere else in this row -- not in fills, '
  'not in relists, not in dated_n, not in p50/p75 -- because the event is true '
  'and the date is not. This column exists so the prune cannot silently shrink '
  'the archive: without it, excluding those rows from the aggregates and then '
  'deleting them would lose the events with no trace. NULL on rows rolled '
  'before 2026-09-09. first_closed_at / last_closed_at DO span them, because '
  'those bound when we OBSERVED the month''s events, which is exactly what a '
  'lap_backfill closed_at honestly is.';

CREATE OR REPLACE FUNCTION public.roll_up_and_prune_closures(p_keep_days integer DEFAULT 180)
RETURNS TABLE (months_rolled integer, rows_pruned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(p_keep_days, 30));
  v_months integer := 0;
  v_pruned integer := 0;
BEGIN
  WITH src AS (
    SELECT
      c.company_token,
      max(c.company) AS company,
      COALESCE(NULLIF(c.category, ''), 'other') AS category,
      date_trunc('month', c.closed_at)::date AS month,
      count(*) FILTER (
        WHERE NOT c.superseded
          AND NOT COALESCE(c.suspect, false)
          AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      )::int AS fills,
      count(*) FILTER (WHERE c.superseded
                         AND c.absence_basis IS DISTINCT FROM 'lap_backfill')::int AS relists,
      -- The events the four aggregates above no longer admit, kept as a count
      -- so the prune cannot make them disappear.
      count(*) FILTER (WHERE c.absence_basis = 'lap_backfill')::int AS backfill_n,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                  AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                  AND c.posted_at IS NOT NULL
                  AND c.closed_at >= c.posted_at
                  AND c.closed_at - c.posted_at <= interval '365 days') AS p50,
      percentile_cont(0.75) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                  AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                  AND c.posted_at IS NOT NULL
                  AND c.closed_at >= c.posted_at
                  AND c.closed_at - c.posted_at <= interval '365 days') AS p75,
      count(*) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                         AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                         AND c.posted_at IS NOT NULL
                         AND c.closed_at >= c.posted_at
                         AND c.closed_at - c.posted_at <= interval '365 days')::int AS dated_n,
      min(c.closed_at) AS first_c,
      max(c.closed_at) AS last_c
    FROM public.job_board_closures c
    WHERE c.closed_at < v_cutoff
      AND c.company_token <> ''
    GROUP BY c.company_token, COALESCE(NULLIF(c.category, ''), 'other'), date_trunc('month', c.closed_at)::date
  )
  INSERT INTO public.job_board_closure_rollup AS r
    (company_token, company, category, month, fills, relists, dated_n, backfill_n, p50_days_open, p75_days_open, first_closed_at, last_closed_at, rolled_at)
  SELECT company_token, company, category, month, fills, relists, dated_n, backfill_n,
         round(p50::numeric, 1), round(p75::numeric, 1), first_c, last_c, now()
  FROM src
  ON CONFLICT (company_token, category, month) DO UPDATE SET
    fills = EXCLUDED.fills,
    relists = EXCLUDED.relists,
    dated_n = EXCLUDED.dated_n,
    backfill_n = EXCLUDED.backfill_n,
    p50_days_open = EXCLUDED.p50_days_open,
    p75_days_open = EXCLUDED.p75_days_open,
    first_closed_at = LEAST(r.first_closed_at, EXCLUDED.first_closed_at),
    last_closed_at = GREATEST(r.last_closed_at, EXCLUDED.last_closed_at),
    rolled_at = now();
  GET DIAGNOSTICS v_months = ROW_COUNT;

  DELETE FROM public.job_board_closures c
  WHERE c.closed_at < v_cutoff
    AND EXISTS (
      SELECT 1 FROM public.job_board_closure_rollup rr
      WHERE rr.company_token = c.company_token
        AND rr.category = COALESCE(NULLIF(c.category, ''), 'other')
        AND rr.month = date_trunc('month', c.closed_at)::date
    );
  GET DIAGNOSTICS v_pruned = ROW_COUNT;

  RETURN QUERY SELECT v_months, v_pruned;
END;
$$;
COMMENT ON FUNCTION public.roll_up_and_prune_closures(integer) IS
  'Rolls closures older than p_keep_days into job_board_closure_rollup, then '
  'deletes them. DATE BASIS: p50/p75 are measured from the employer''s stated '
  'posted_at ALONE over the closures that carry one, exclude relists and '
  'suspect batches, and carry the same two sanity guards the live read paths '
  'carry (closed_at >= posted_at, and the duration under a year) — a closure '
  'whose feed-supplied post date lands after its close date used to contribute '
  'a NEGATIVE value here while being excluded from every live median. dated_n '
  'is the count behind those percentiles; `fills` counts a LARGER population, '
  'because it does not require a post date, so dated_n / fills is this row''s '
  'dated coverage and the count/median split is visible instead of baked in. '
  'This writes the ONLY copy of history that survives the prune, and a stored '
  'definition that differs from the live one cannot be detected afterwards, '
  'which is why the two are kept in step deliberately rather than by luck. NOTE '
  'the one place they are NOT in step: the live functions also drop unstamped '
  'feed-dark batches via a read-time proxy against contemporaneous company '
  'snapshots, and those snapshots are pruned at 35 days, so the proxy cannot be '
  'reconstructed at rollup time (180 days). Batches the collector stamped '
  'suspect ARE excluded here, and from 2026-09-06 every batch carries that '
  'stamp, so the gap closes on its own and is confined to rows rolled from the '
  'pre-stamp era.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'fills, relists, dated_n, p50_days_open and p75_days_open all exclude '
  'it; backfill_n counts it, so the archive still knows those events '
  'happened after the rows themselves are deleted. This is the one caller '
  'where the decision is irreversible: a month rolled with a backfilled '
  'duration inside its p50 keeps it forever, because the rows the median '
  'was drawn from are gone. first_closed_at / last_closed_at deliberately '
  'DO span backfill rows -- they bound when we observed the month, which '
  'is what that closed_at truthfully is.';
REVOKE ALL ON FUNCTION public.roll_up_and_prune_closures(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_closures(integer) TO service_role;

-- ── 9. the relisting-employer warning ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_relisting_employers(p_limit int DEFAULT 12)
RETURNS TABLE (
  company                  text,
  company_token            text,
  relist_events_floor      bigint,
  relisted_titles          bigint,
  events_per_title         numeric,
  worst_title              text,
  worst_title_events_floor bigint,
  worst_title_first_at     timestamptz,
  first_relisted_at        timestamptz,
  observed_days            int,
  window_days              int,
  board_median_per_title   numeric,
  board_p90_per_title      numeric,
  board_pool_n             int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  -- Still-serving employers only, with the showcase exclusions the other
  -- editorial rankings apply. A warning on a card that cannot be reached is a
  -- verdict with no page behind it, and this is a ranking of employers against
  -- each other, which is the definition of an editorial surface here.
  WITH live AS (
    SELECT p.company_token AS tok, max(p.company) AS co_name
    FROM public.job_board_postings p
    WHERE p.company <> ''
      AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token
  ),
  -- The board as it is, used only as the feed-dark denominator below. Both
  -- serving predicates and nothing else, so it is the same population
  -- /jobs/company/{token} shows.
  serving AS (
    SELECT p.company_token AS tok, count(*)::int AS n
    FROM public.job_board_postings p
    WHERE p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token
  ),
  -- (company_token, closed_at) IS the batch key: the collector writes one
  -- closed_at per board pass. Counted over ALL closures of the pass, not just
  -- the superseded ones, because the question is how much of the feed vanished
  -- at once.
  --
  -- UNSTAMPED HISTORY ONLY, exactly as the estimator scopes it. From
  -- 2026-09-06 every closure carries its batch's own alibi and the collector
  -- stamps `suspect` itself, so a proxy applied there would second-guess a
  -- decision made with more information than this query has. batch_live_before
  -- IS NULL selects the era that has no such stamp -- and that era is finite,
  -- so this scan shrinks as it ages out of the window.
  batches AS (
    SELECT c.company_token AS tok, c.closed_at AS at, count(*)::int AS n_removed
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - interval '90 days'
      AND c.batch_live_before IS NULL
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY c.company_token, c.closed_at
  ),
  dark AS (
    SELECT b.tok, b.at
    FROM batches b
    LEFT JOIN serving s ON s.tok = b.tok
    WHERE b.n_removed > GREATEST(25, 0.30 * COALESCE(s.n, 0))
  ),
  -- One row per (employer, NORMALISED title). raw_title is the most common raw
  -- spelling inside the group, so the card can print a title a reader
  -- recognises while the grouping stays on the key the flag was written under.
  sup AS (
    SELECT c.company_token AS tok,
           public.normalize_close_title(c.title) AS norm_title,
           count(*)::bigint AS n,
           min(c.closed_at) AS first_ev,
           mode() WITHIN GROUP (ORDER BY c.title) AS raw_title
    FROM public.job_board_closures c
    LEFT JOIN dark d ON d.tok = c.company_token AND d.at = c.closed_at
    WHERE c.superseded
      AND c.closed_at >= now() - interval '90 days'
      AND NOT COALESCE(c.suspect, false)
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      AND d.tok IS NULL
    GROUP BY c.company_token, public.normalize_close_title(c.title)
  ),
  agg AS (
    SELECT s.tok,
           sum(s.n)::bigint AS n_events,
           count(*)::bigint AS n_titles,
           round(sum(s.n)::numeric / count(*), 2) AS per_title,
           min(s.first_ev) AS first_ev
    FROM sup s
    GROUP BY s.tok
    HAVING sum(s.n) >= 25
  ),
  pool AS (
    SELECT a.tok, a.n_events, a.n_titles, a.per_title, a.first_ev, l.co_name
    FROM agg a
    JOIN live l ON l.tok = a.tok
  ),
  -- The baseline, over the pool the twelve are drawn from, in this statement.
  board AS (
    SELECT count(*)::int AS pool_n,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY pool.per_title))::numeric, 2) AS med,
           round((percentile_cont(0.9) WITHIN GROUP (ORDER BY pool.per_title))::numeric, 2) AS p90
    FROM pool
  ),
  -- How long the record actually is. The 90-day predicate above cannot select
  -- more log than exists, so the window a card may name is the log's own span.
  span AS (
    SELECT LEAST(90, GREATEST(EXTRACT(DAY FROM now() - (
             SELECT min(c.closed_at) FROM public.job_board_closures c
              WHERE c.absence_basis IS DISTINCT FROM 'lap_backfill'))::int, 1))::int AS win_days
  ),
  worst AS (
    SELECT DISTINCT ON (s.tok) s.tok, s.raw_title, s.n, s.first_ev
    FROM sup s
    JOIN pool ON pool.tok = s.tok
    ORDER BY s.tok, s.n DESC, s.norm_title
  )
  SELECT pool.co_name,
         pool.tok,
         pool.n_events,
         pool.n_titles,
         pool.per_title,
         worst.raw_title,
         worst.n,
         worst.first_ev,
         pool.first_ev,
         GREATEST(EXTRACT(DAY FROM now() - pool.first_ev)::int, 1),
         span.win_days,
         board.med,
         board.p90,
         board.pool_n
  FROM pool
  JOIN worst ON worst.tok = pool.tok
  CROSS JOIN board
  CROSS JOIN span
  -- The rate is the ranking key, and the aggregate below it in the caller must
  -- not re-sort: a list chosen by one rule and shown in another order is the
  -- defect 20260811203000 fixed on the transparency list.
  ORDER BY pool.per_title DESC, pool.n_events DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;
COMMENT ON FUNCTION public.get_relisting_employers(int) IS
  'Employers ranked by RE-LISTINGS PER AFFECTED ROLE, where a role is a title '
  'normalised by normalize_close_title -- the key the collector itself uses for '
  'the superseded flag and the 24h dedupe. Grouping by the raw title under a '
  'per-role rate ranks the employer with the LEAST title decoration worst, '
  'which is why the port lands first. WINDOW: closed_at within 90 days, one '
  'window for every card; window_days reports how much log that actually is '
  '(LEAST(90, the closure log''s own span) -- 56 today, the log began '
  '2026-07-14) and NO surface may call it 90 days of watching. DATE BASIS: '
  'every date here is OURS -- closed_at is when we observed the removal, not a '
  'date any employer stated; no employer-stated posting date is read by this '
  'function at all. COLUMNS: (1) company / (2) company_token identify the '
  'employer, name taken from live postings. (3) relist_events_floor: logged '
  'superseded closures in the window -- A FLOOR, because the collector logs at '
  'most one per normalised title per employer per 24h and deletes the deduped '
  'postings, so publish it as ">=N", never "=N". (4) relisted_titles: distinct '
  'normalised titles with at least one logged re-listing in the window; ALSO A '
  'FLOOR -- the 24h dedupe never removes a title (its first event always logs), '
  'but the feed-dark rule below drops whole batches and can take a title''s only '
  'event with them -- and a count of TITLES rather than of requisitions, which '
  'we cannot see. (5) events_per_title: (3)/(4), the ranking key, and NOT a '
  'floor: it is a ratio of two floors deflated by the same batch drops, which '
  'moves it up when the dropped title was quiet and down when it was loud. It '
  'must render with no "+" and no stated direction; the floor marker belongs on '
  '(3) and (4), which have one. (6) worst_title: the most common RAW spelling inside the '
  'worst-scoring normalised group, shown so a reader recognises the role; other '
  'spellings of the same role are folded into it. (7) worst_title_events_floor: '
  'that group''s logged re-listings, same floor. (8) worst_title_first_at: the '
  'first date WE saw that title recycled (min closed_at in the group, our '
  'clock). (9) first_relisted_at: the first date we saw ANY title of this '
  'employer recycled. (10) observed_days: days from (9) to now -- THIS '
  'EMPLOYER''S OWN SPAN, not the board''s, and not tracking_days from any other '
  'RPC. (11) window_days: as above. (12) board_median_per_title and (13) '
  'board_p90_per_title: the median and 90th percentile of (5) across the whole '
  'pool, MEASURED IN THIS STATEMENT under this normalisation and window -- the '
  '2.7 from 20260812130736 is NOT this quantity (raw titles, unbounded window, '
  'top-300-by-events, 29 days of log) and must not be printed here. (14) '
  'board_pool_n: employers in the pool the twelve were drawn from. GATE: '
  'relist_events_floor >= 25, the sample floor from 20260812130736, which '
  'survives the regrouping because it counts the same rows; the 5-per-role RATE '
  'half of that gate does NOT survive it and is deliberately absent. FEED-DARK: '
  'batches stamped suspect, and -- over UNSTAMPED history only (batch_live_'
  'before IS NULL), the same scoping the estimator uses -- any (company_token, '
  'closed_at) batch removing more than max(25, 0.30 x the employer''s served '
  'count), are dropped from the input; our collection failing is not their '
  'conduct, and here the error can only run toward accusing. The threshold uses '
  'TODAY''S served count rather than the contemporaneous snapshot the estimator '
  'prefers, because snapshots are pruned at 35 days and this scan is '
  'board-wide; that over-deletes a wind-down, which is the safe direction under '
  'a heading that accuses. A CLOSURE IS NEVER A HIRE and nothing here claims '
  'one: superseded means the same normalised title was still live when this one '
  'came down. Cron-only; the page reads it from the explore cache.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'This surface ACCUSES a named employer, so admitting it would be the '
  'worst case in the file: a first lap''s backlog of superseded rows lands '
  'as a month of re-listing on one day, and relist_events_floor, '
  'events_per_title and observed_days would each be computed from it. All '
  'three, plus the feed-dark batch sizer and window_days, exclude it.';
REVOKE ALL ON FUNCTION public.get_relisting_employers(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_relisting_employers(int) TO service_role;

-- ── 10. the repost-rate gate ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_repost_index()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '90s'
AS $$
  WITH sup AS (
    SELECT company_token, title, count(*) AS n, min(closed_at) AS first_ev
    FROM public.job_board_closures
    WHERE superseded
      -- The window get_repost_churn_companies lacks. See above.
      AND closed_at >= now() - interval '180 days'
      AND absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY company_token, title
  ),
  agg AS (
    SELECT company_token,
           sum(n)::int AS events,
           count(*)::int AS roles,
           GREATEST(EXTRACT(DAY FROM now() - min(first_ev))::int, 1) AS days
    FROM sup
    GROUP BY company_token
    HAVING sum(n) >= 25
       AND sum(n)::numeric / GREATEST(count(*), 1) >= 5
  ),
  live AS (
    SELECT company_token
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  )
  SELECT COALESCE(
    jsonb_object_agg(a.company_token, jsonb_build_array(a.events, a.roles, a.days)),
    '{}'::jsonb)
  FROM agg a
  JOIN live l ON l.company_token = a.company_token;
$$;
COMMENT ON FUNCTION public.get_repost_index() IS
  'token -> [repost_events, reposted_roles, days] for employers whose re-list '
  'RATE clears 5 per affected role on at least 25 events, still serving roles, '
  'within 180 days. Gated on a rate because repost_events is size-correlated: '
  'the two largest employers by raw events re-list BELOW the median rate, so a '
  'top-N gate would warn about ordinary large employers and miss the worst. A '
  'miss means "did not clear this gate", never "does not re-post" — nothing may '
  'render a clean bill from it.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'Both terms of the published RATE are computed from closed_at -- the '
  'event count and the `days` span it is divided by -- so a backlog would '
  'move the numerator up and the denominator down at once and could push '
  'an ordinary employer through a gate that exists to name the worst.';
REVOKE ALL ON FUNCTION public.get_repost_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_repost_index() TO service_role;

-- ── 11. the older repost-churn cards ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_repost_churn_companies(p_limit int DEFAULT 12)
RETURNS TABLE (
  company text, company_token text,
  repost_events bigint, reposted_roles bigint,
  worst_title text, worst_count bigint,
  tracking_days int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH sup AS (
    SELECT company_token, max(company) AS company, title,
           count(*) AS n, min(closed_at) AS first_ev
    FROM public.job_board_closures
    WHERE superseded
      AND absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY company_token, title
  ),
  agg AS (
    SELECT company_token, max(company) AS company,
           sum(n)::bigint AS repost_events,
           count(*)::bigint AS reposted_roles,
           GREATEST(EXTRACT(DAY FROM now() - min(first_ev))::int, 1) AS tracking_days
    FROM sup
    GROUP BY company_token
    HAVING sum(n) >= 20
  ),
  worst AS (
    SELECT DISTINCT ON (company_token) company_token, title, n
    FROM sup ORDER BY company_token, n DESC
  )
  SELECT a.company, a.company_token, a.repost_events, a.reposted_roles,
         w.title AS worst_title, w.n::bigint AS worst_count, a.tracking_days
  FROM agg a
  JOIN worst w USING (company_token)
  ORDER BY a.repost_events DESC
  LIMIT p_limit;
$$;
COMMENT ON FUNCTION public.get_repost_churn_companies(int) IS
  'Employers ranked by re-list events, with tracking_days as the span since '
  'their first such event. Superseded by get_repost_index / '
  'get_relisting_employers for the published surfaces; kept because the '
  'explore cache builder still names it. repost_events over tracking_days '
  'is a RATE and tracking_days is a TENURE, both computed from closed_at. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'Excluding it is what stops a board''s first lap from reporting a month '
  'of re-listing as one day''s churn against a tracking span of one day.';
GRANT EXECUTE ON FUNCTION public.get_repost_churn_companies(int) TO anon, authenticated;

-- ── 12. the weekly trend series ────────────────────────────────────────────
--
-- SECURITY DEFINER IS SPELLED IN THE BODY, and was not in the source this is
-- copied from. 20260820174500 switched this function with an ALTER after the
-- closure-log lockdown left it returning one week of `closed: 0` behind a 200
-- and /hiring-trends published "no roles filled or closed" as a fact about the
-- labour market for two days. A CREATE OR REPLACE carrying the old INVOKER
-- header forward would run that outage again.
CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '20s' AS $$
  WITH excluded AS (SELECT company_token FROM public.showcase_excluded),
  epoch AS (
    SELECT date_trunc('week', min(closed_at))::date AS w0 FROM public.job_board_closures
    WHERE absence_basis IS DISTINCT FROM 'lap_backfill'
  ),
  weeks AS (
    SELECT date_trunc('week', d)::date AS week_start
    FROM generate_series(date_trunc('week', now() - interval '28 days'), now(), interval '1 week') d
    WHERE date_trunc('week', d)::date >= COALESCE((SELECT w0 FROM epoch), date_trunc('week', now())::date)
  ),
  posted_live AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n,
      (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_new,
      (count(*) FILTER (WHERE remote))::int AS remote_new
    FROM public.job_board_postings
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND first_seen - posted_at < interval '3 days'
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  ),
  posted_closed AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n
    FROM public.job_board_closures
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND NOT superseded
      AND first_seen IS NOT NULL AND first_seen - posted_at < interval '3 days'
      AND absence_basis IS DISTINCT FROM 'lap_backfill'
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  ),
  closes AS (
    SELECT date_trunc('week', closed_at)::date AS w, count(*)::int AS closed
    FROM public.job_board_closures
    WHERE closed_at > now() - interval '35 days' AND NOT superseded
      AND absence_basis IS DISTINCT FROM 'lap_backfill'
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  )
  SELECT weeks.week_start,
         COALESCE(posted_live.n, 0) + COALESCE(posted_closed.n, 0),
         COALESCE(posted_live.entry_new, 0),
         COALESCE(posted_live.remote_new, 0),
         COALESCE(closes.closed, 0)
  FROM weeks
  LEFT JOIN posted_live   ON posted_live.w   = weeks.week_start
  LEFT JOIN posted_closed ON posted_closed.w = weeks.week_start
  LEFT JOIN closes        ON closes.w        = weeks.week_start
  ORDER BY weeks.week_start;
$$;
COMMENT ON FUNCTION public.get_hiring_trends() IS
  'Weekly new postings and closures over a 35-day window, for /hiring-trends. '
  'SECURITY DEFINER because job_board_closures is service_role-only and an '
  'INVOKER version answers 200 with zeroes (20260820174500). `closed` is an '
  'events-per-week RATE dated by closed_at. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'Admitting it would put a big board''s entire thirty-day backlog into a '
  'single week''s bar, and take it out of the weeks it actually belonged '
  'to, on a chart whose whole subject is the shape over time.';
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated;

-- ── 13. the trending-category rail ─────────────────────────────────────────
--
-- SECURITY DEFINER in the body, for the same reason as the function above it:
-- the ALTER of 20260820174500 is not carried by a CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.get_trending_categories()
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT category,
    (count(*) FILTER (WHERE posted_at > now() - interval '7 days'))::int AS last7,
    CASE WHEN (SELECT min(closed_at) FROM public.job_board_closures
                 WHERE absence_basis IS DISTINCT FROM 'lap_backfill') <= now() - interval '14 days'
         THEN (count(*) FILTER (WHERE posted_at <= now() - interval '7 days'))::int
         ELSE NULL END AS prior7
  FROM public.job_board_postings
  WHERE posted_at IS NOT NULL AND posted_at > now() - interval '14 days'
    AND first_seen - posted_at < interval '3 days'
    AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  GROUP BY category
  HAVING count(*) FILTER (WHERE posted_at > now() - interval '7 days') >= 20
  ORDER BY 2 DESC LIMIT 15;
$$;
COMMENT ON FUNCTION public.get_trending_categories() IS
  'Categories by new postings in the last seven days, with the prior seven '
  'as a comparison. SECURITY DEFINER: it reads job_board_closures, which is '
  'service_role-only, and an INVOKER version publishes emptiness with a 200 '
  '(20260820174500). The closure log is read for ONE thing here -- '
  'min(closed_at), the age of the log, which gates whether a prior-7-day '
  'comparison may be shown at all. That is a TENURE. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'A backfilled row can only ever be recent, so admitting it cannot make '
  'the log look older today -- but after a prune it could be the oldest '
  'row left, and the gate would then open on a date nobody may trust. The '
  'filter is here so the rule holds without depending on which rows '
  'happen to survive.';
GRANT EXECUTE ON FUNCTION public.get_trending_categories() TO anon, authenticated;

-- ── 14. today's takedown counter ───────────────────────────────────────────
--
-- The purest case in the file: a count of events dated by closed_at, over one
-- day. A board's first proven lap can hand it thirty days of takedowns at once,
-- and the number on the page is "today". SECURITY DEFINER in the body, again
-- because the ALTER of 20260820174500 does not survive a CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.get_takedowns_today()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  SELECT count(*)::int FROM public.job_board_closures
  WHERE closed_at >= date_trunc('day', now()) AND NOT superseded
    AND absence_basis IS DISTINCT FROM 'lap_backfill';
$$;
COMMENT ON FUNCTION public.get_takedowns_today() IS
  'Non-superseded closures logged since midnight UTC -- an events-per-day '
  'RATE, dated entirely by closed_at. SECURITY DEFINER because '
  'job_board_closures is service_role-only; as INVOKER it returns 0 with a '
  '200, which is indistinguishable from a quiet day (20260820174500). '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'This is the surface a backlog would distort most visibly: one board''s '
  'first lap could multiply today''s figure several-fold with takedowns '
  'that happened over the preceding month.';
GRANT EXECUTE ON FUNCTION public.get_takedowns_today() TO anon, authenticated;

-- ── 16. the per-application lifecycle answer ───────────────────────────────
--
-- DROPPED FIRST, and it is the only function in this file that is. CREATE OR
-- REPLACE cannot change a function's return type -- Postgres raises "cannot
-- change return type of existing function" -- and this one gains a column
-- (closed_at_is_observation), so a plain REPLACE would fail the whole
-- migration. The signature is written out rather than discovered because this
-- file itself creates that exact signature four lines down; there is one
-- overload and no view or function depends on it (checked: the only references
-- in the tree are this file, its two predecessors, the client rpc call and the
-- guards). The GRANT is re-issued at the bottom of the section, which a DROP
-- makes mandatory rather than tidy.
DROP FUNCTION IF EXISTS public.get_application_lifecycle(text[]);
CREATE OR REPLACE FUNCTION public.get_application_lifecycle(p_job_ids text[])
RETURNS TABLE (
  job_id text,
  outcome text,
  closed_at timestamptz,
  days_standing numeric,
  relisted boolean,
  -- THE DATE IS THE HALF WE CANNOT KNOW, so the caller is told which half it
  -- is holding. Nulling days_standing alone was not enough: it hid the derived
  -- number and published the raw one, and the raw one is the more prominent
  -- half of the sentence the account page renders ("Came down on 9/20/2026").
  -- TRUE means closed_at is the day we could finally SEE the posting was gone
  -- -- late by an unknown amount up to the freshness window -- so a renderer
  -- must state it as a ceiling ("on or before"), never as the event date, and
  -- an irreversible write must not treat it as one.
  closed_at_is_observation boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_job_ids[1:500]) AS jid
  ),
  cl AS (
    SELECT DISTINCT ON (c.posting_id)
      c.posting_id, c.closed_at, c.posted_at, c.first_seen, c.company_token, c.title,
      c.absence_basis
    FROM public.job_board_closures c
    WHERE c.posting_id = ANY(p_job_ids[1:500])
    ORDER BY c.posting_id, c.closed_at DESC
  ),
  liv AS (
    SELECT p.id, p.posted_at, p.first_seen
    FROM public.job_board_postings p
    WHERE p.id = ANY(p_job_ids[1:500])
  )
  SELECT
    ids.jid AS job_id,
    CASE
      WHEN liv.id IS NOT NULL AND cl.posting_id IS NOT NULL THEN 'came_down_relisted'
      WHEN liv.id IS NOT NULL THEN 'still_standing'
      WHEN cl.posting_id IS NOT NULL THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_board_postings p2
          WHERE p2.company_token = cl.company_token
            AND lower(p2.title) = lower(cl.title)
            AND COALESCE(p2.posted_at, p2.first_seen) >= cl.closed_at
        ) THEN 'came_down_relisted' ELSE 'came_down' END
      ELSE 'not_observed'
    END AS outcome,
    cl.closed_at,
    CASE
      -- THE ROW IS NOT FILTERED OUT, THE DURATION IS. A lap_backfill closure
      -- is a true statement that this posting came down -- it is the date that
      -- is late, by up to the freshness window. Dropping the row would report
      -- 'not_observed' for a job that demonstrably closed, which is a worse
      -- answer than none; nulling days_standing says the one thing we cannot
      -- know and keeps the one we can.
      WHEN cl.posting_id IS NOT NULL AND cl.absence_basis = 'lap_backfill' THEN NULL
      WHEN cl.posting_id IS NOT NULL AND COALESCE(cl.posted_at, cl.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (cl.closed_at - COALESCE(cl.posted_at, cl.first_seen))) / 86400.0)::numeric, 1)
      WHEN liv.id IS NOT NULL AND COALESCE(liv.posted_at, liv.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (now() - COALESCE(liv.posted_at, liv.first_seen))) / 86400.0)::numeric, 1)
      ELSE NULL
    END AS days_standing,
    (cl.posting_id IS NOT NULL AND liv.id IS NOT NULL) AS relisted,
    COALESCE(cl.posting_id IS NOT NULL AND cl.absence_basis = 'lap_backfill', false) AS closed_at_is_observation
  FROM ids
  LEFT JOIN cl  ON cl.posting_id = ids.jid
  LEFT JOIN liv ON liv.id = ids.jid;
$$;
COMMENT ON FUNCTION public.get_application_lifecycle(text[]) IS
  'Per posting id: whether it is still standing, came down, or came down and '
  'was relisted, with days_standing beside it. days_standing is the ONE '
  'surviving coalesced duration in this schema -- closed_at minus '
  'COALESCE(posted_at, first_seen) -- which is admissible only because '
  'first_seen can never precede the true post date, so the number is always '
  'a LOWER BOUND and Account.tsx renders it as "at least N days posted". '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'THE EXCLUSION IS SHAPED DIFFERENTLY HERE, and deliberately: the row '
  'stays and `outcome` still says came_down, because that is true; only '
  'days_standing goes NULL. Filtering the row away would answer '
  '''not_observed'' about a posting that demonstrably closed, which is a '
  'worse error than the one being fixed, and the floor wording cannot '
  'rescue a duration whose origin is late by an unknown amount. '
  'closed_at IS STILL RETURNED FOR SUCH A ROW, and closed_at_is_observation '
  'is how the caller knows what it is holding: TRUE means closed_at is the '
  'day we could finally SEE the posting was gone, not the day it went. '
  'Nulling days_standing alone hid the derived number and published the raw '
  'one, and the raw one is the more prominent half of the sentence the '
  'account page renders. A renderer MUST state a TRUE row as a ceiling '
  '(''on or before''), and a caller that PERSISTS the date -- '
  'user_applications.posting_closed_at is written once and never rewritten -- '
  'must not write it at all.';
GRANT EXECUTE ON FUNCTION public.get_application_lifecycle(text[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';