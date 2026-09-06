-- THE FLOOR THAT WAS SUPPOSED TO SUPPRESS CHURN DELETED THE FAST FILLS.
--
-- Five live functions dropped every closure that happened less than a week
-- after the role was posted. The rule was added to suppress relist churn, and
-- two other mechanisms already do that job properly: the `superseded` flag
-- names a relist directly, and the feed-dark batch guard (20260906090000) names
-- a collection failure directly. What the age rule actually removed was the
-- entire left tail of the distribution -- the roles that filled quickly, which
-- is the single most useful thing a job seeker could learn from this data.
--
-- Combined with the ingest's 30-day serving cap it left an observable support
-- of one week to one month, and a median drawn from that interval lands near
-- fifteen days whatever employers do. Measured 2026-09-06: eighteen categories
-- reporting medians between 14.9 and 16.3 days, agreeing to within 1.4 days
-- across nursing, securities law, retail and ML research, at sample sizes where
-- the standard error is well under a day. That is not a labour market. It is
-- the shape of the window, published as a fact about employers.
--
-- Every one of the five is re-issued here with the age rule gone and with every
-- published duration measured from the employer's stated posted_at ALONE. The
-- coalesce with our own first_seen is acceptable as a filter and is a
-- falsehood as a published number: it substitutes the day our crawler noticed a
-- role for the day the employer posted it, which is the 2.8-day-median
-- incident, and it has been re-introduced twice since.
--
-- WHAT CHANGES FOR CALLERS, STATED RATHER THAN DISCOVERED IN TRIAGE.
--
-- * closed_90d and `filled` get STRICTLY LARGER, because fast fills stop being
--   deleted. Two behaviours move with them: agent-runner's churn disqualifier
--   (superseded_90d greater than closed_90d and at least 10) fires LESS often,
--   and Account.tsx's "at least 5 closures" floor is reached SOONER. Both move
--   toward showing more, not less, and both were calibrated against a count
--   that was missing its fastest quarter.
-- * get_company_hiring_health's count and its median now share every filter
--   EXCEPT the one that cannot be shared: the median additionally requires a
--   stated posted_at (and closed_at >= posted_at), because a duration cannot be
--   computed without an origin. An earlier draft of this header claimed the live
--   contradiction disappears. IT DOES NOT, and saying so was worse than the
--   defect: gici~wd5~Careers returns closed_90d 41 next to median_days_to_close
--   null because none of those 41 closures carries an employer post date, and
--   after this change it returns a LARGER count next to the same null. What is
--   fixed is the part that was ours -- the seven-day floor and the suspect
--   batches are gone from both sides. What remains is dated coverage, a real
--   property of the employer's board, and this function has no column in which
--   to disclose it (adding one would change the return type, which this file
--   deliberately does not do -- see below). get_company_fill_curve is the
--   surface that publishes dated_coverage, dated_n and undated_n, and it is
--   where a caller must look to see the gap. The COMMENT ON says exactly this.
-- * get_category_fill_speed and get_employer_benchmarks now require a stated
--   posted_at, so their sample is the dated cohort only. On a category whose
--   employers rarely publish dates this can drop the row below its own
--   minimum-sample floor and the category disappears from the surface. That is
--   the honest failure -- absent rather than wrong -- and it is why both
--   functions are now DEPRECATED in favour of get_category_fill_curve, which
--   discloses coverage instead of silently conditioning on it.
--
-- NO SIGNATURE CHANGES ANYWHERE IN THIS FILE. Every one of these five keeps its
-- exact argument list and its exact return columns, so CREATE OR REPLACE is
-- sufficient and nothing needs dropping. That is deliberate and it is the
-- safe order of operations: four consumers read get_company_hiring_health by
-- column name, one of them the post-publish deploy gate, and a DROP would also
-- discard grants and would silently break refresh_explore_cache, which calls
-- get_actively_hiring_companies from a string-bodied SQL function that Postgres
-- records no dependency for. The new curve RPCs are additive; the migration off
-- these five happens on the client's own schedule.
--
-- THESE MEDIANS ARE STILL CENSORED AT THE 30-DAY CAP. Deleting the age rule
-- fixes the left tail; nothing can fix the right tail from this data, because
-- no posting can be observed to close later than the day we stop serving it.
-- median_days_open and median_days_to_close therefore remain LOWER BOUNDS on
-- true time-to-fill and must not be rendered as "typically fills in N days".
-- get_company_fill_curve and get_category_fill_curve are the surfaces that say
-- so honestly, by returning a fill rate at a horizon inside the window and
-- refusing to invent a median that is not reached inside it.
--
-- ONE SPELLING NOTE, BECAUSE IT LOOKS ARBITRARY OTHERWISE. Inside
-- get_actively_hiring_companies the suspect-batch test is written
-- `c.suspect IS NOT TRUE` rather than with a COALESCE. The two are identical on
-- a NOT NULL column, and the guard on that function forbids the string COALESCE
-- anywhere inside the published-median expression -- correctly, because that is
-- how the coalesced origin got in twice before. The guard should keep its
-- teeth; the filter changes its spelling instead.
--
-- One live floor is NOT in this file and needs no repair: get_trending_categories
-- and get_hiring_trends both mention a seven-day interval, and in both cases it
-- is a trend bucket over closed_at, not a rule about how old a closure must be.
-- They are left alone.
--
-- THE FEED-DARK PROXY RUNS HERE TOO, BECAUSE A SITE CANNOT PUBLISH TWO FILL
-- COUNTS FOR ONE EMPLOYER.
--
-- `suspect` is false on every row written before 2026-09-06, so a filter on it
-- alone removes nothing across the ~54 days of history this ships against. The
-- curve RPCs handle that with a retroactive read-time proxy over unstamped
-- batches; these four did not, and the result would have been /explore's
-- actively-hiring leaderboard and the company lander publishing fill counts for
-- the same employer that differ by an entire dark batch -- 400 on one page, 0 on
-- the other, with the honest number on the less-visited one. Deleting the
-- seven-day floor makes that gap strictly wider, because a dark batch's fastest
-- closures used to be floored out and now are not.
--
-- So the same proxy is applied in all four read functions here, with the same
-- era-appropriate denominator the curves use: a batch is dropped when it removed
-- more than max(5, 0.30 x that company's board size AT THE TIME, from the newest
-- job_board_company_snapshots row at or before the batch's day), falling back
-- where no snapshot survives to today's served count with the absolute floor
-- raised to 25. One difference from the curves, and it is forced: these
-- functions have no risk set, so a dropped batch is genuinely absent here rather
-- than censored. That is a reason to prefer the curve RPCs, and the COMMENT ONs
-- say so. get_category_fill_speed and get_employer_benchmarks pay for the extra
-- grouped pass with a raised statement_timeout (15s to 30s, 20s to 30s); both
-- are deprecated, and a slower honest number beats a fast one that counts our
-- own outage as several hundred fills.

-- ── 1. Per-employer lifecycle summary ───────────────────────────────────────
-- Same eight columns, same argument. The count and the median finally share a
-- population, and both durations come from the stated post date.
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
             EXTRACT(DAY FROM now() - (SELECT min(c.closed_at) FROM public.job_board_closures c WHERE c.company_token = t.t))::int,
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
    WHERE c.company_token = ANY (p_tokens) GROUP BY c.company_token
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
  'consumers plus a post-publish deploy gate read this function by column name.';

-- ── 2. Who is actually hiring ───────────────────────────────────────────────
-- Same seven columns, same argument, same ranking. Only the age rule and the
-- coalesced origin are gone.
CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (
  company text, company_token text, closed_90d bigint, open_roles bigint,
  tracking_days int, p50_days_open numeric, dated_n int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH open_now AS (
    SELECT company_token, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  -- The same retroactive feed-dark proxy the curve RPCs run. Without it this
  -- leaderboard ranks the outage: a company serving 120 roles that went dark
  -- once and logged 400 removals in one second scores 333 fills per 100 open
  -- roles and tops the list, while the company lander shows the same employer
  -- with none. `c.suspect IS NOT TRUE` cannot catch it, because suspect is false
  -- on every row written before 2026-09-06.
  batches AS (
    SELECT c.company_token AS tok, c.closed_at AS at,
           date_trunc('day', c.closed_at)::date AS on_day,
           count(*)::int AS n_removed
    FROM public.job_board_closures c
    WHERE c.closed_at > now() - interval '30 days'
      AND c.batch_live_before IS NULL
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
    LEFT JOIN open_now o ON o.company_token = z.tok
    WHERE z.n_removed > CASE
             WHEN z.era_n IS NOT NULL THEN GREATEST(5,  0.30 * z.era_n)
             ELSE GREATEST(25, 0.30 * COALESCE(o.n, 0))
           END
  ),
  fills AS (
    SELECT c.company_token, max(c.company) AS company,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.suspect IS NOT TRUE
           ) AS filled,
           LEAST(GREATEST(EXTRACT(DAY FROM now() - min(c.closed_at))::int, 1), 30) AS tracking_days,
           round((percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (c.closed_at - c.posted_at)) / 86400.0
           ) FILTER (
             WHERE NOT c.superseded
               AND c.suspect IS NOT TRUE
               AND c.posted_at IS NOT NULL
               AND c.closed_at >= c.posted_at
           ))::numeric, 0) AS p50_days_open,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.suspect IS NOT TRUE
               AND c.posted_at IS NOT NULL
               AND c.closed_at >= c.posted_at
           )::int AS dated_n
    FROM public.job_board_closures c
    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
    WHERE c.closed_at > now() - interval '30 days'
      AND c.company <> ''
      AND dk.tok IS NULL
      AND c.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY c.company_token
    -- THE CHURN TEST IS SYMMETRIC. Both sides now apply the same admissibility
    -- filter. It read `count(*) FILTER (WHERE c.superseded)` against a fill count
    -- that excluded suspect batches, so a dark feed's superseded minority was
    -- counted while its fill majority was ruled inadmissible three lines above --
    -- an employer with 50 real fills and 40 real relists could be dropped from
    -- /explore's actively-hiring section on evidence this same query had already
    -- declared unusable.
    HAVING count(*) FILTER (
             WHERE NOT c.superseded
               AND c.suspect IS NOT TRUE
           ) >= 3
       AND count(*) FILTER (WHERE c.superseded AND c.suspect IS NOT TRUE)
           <= count(*) FILTER (
                WHERE NOT c.superseded
                  AND c.suspect IS NOT TRUE
              )
  )
  SELECT f.company, f.company_token, f.filled AS closed_90d, o.n::bigint AS open_roles,
         f.tracking_days, f.p50_days_open, f.dated_n
  FROM fills f
  JOIN open_now o ON o.company_token = f.company_token
  WHERE o.n >= 100
  ORDER BY (f.filled * 100.0 / o.n) DESC, f.filled DESC
  LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.get_actively_hiring_companies(int) IS
  'Employers ranked by FILLS PER 100 SERVED OPEN ROLES, not by absolute fills — '
  'the latter ranked by size under a chip promising a fill record, and its '
  'pre-truncation to the top 60 meant no small employer could place at all. '
  'DATE BASIS: p50_days_open is the median days a filled role stayed up, from '
  'posted_at ALONE (COALESCE with first_seen publishes our discovery time as '
  'the employer''s posting date), over the dated_n closures that carry one; it '
  'is a LOWER BOUND, because the ingest stops serving a posting at 30 days. '
  'tracking_days is per company; it was the age of the entire closure log. The '
  'fill count no longer deletes closures that happened within a week of '
  'posting: that rule was meant to suppress relist churn, which the superseded '
  'flag and the batch guard handle directly, and what it actually removed was '
  'every fast fill. Suspect batches — a dark feed logged as several hundred '
  'takedowns in one second — are excluded from both the count and the median.';

-- ── 3. Category fill speed (DEPRECATED, kept for the deploy window) ─────────
-- Same two arguments, same five columns. Superseded by
-- get_category_fill_curve; retained only so the client can migrate without a
-- window where the surface is dark.
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
         FROM public.job_board_closures)
    ) AS window_days
  FROM public.job_board_closures c
  LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at
  WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
    AND c.category <> ''
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
  'labour market. Do not render it as a typical time-to-fill.';

-- ── 4. Employer benchmarks ──────────────────────────────────────────────────
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
  'reports a fill rate at a horizon that fits inside the window.';

-- ── 5. The archive must not keep a definition the live window abandoned ─────
-- roll_up_and_prune_closures bakes its filters into job_board_closure_rollup
-- for every closure older than 180 days and then deletes the rows. Leaving the
-- age rule here would leave a permanently floored archive sitting under an
-- unfloored live window, and nothing downstream could tell that the two halves
-- of the history mean different things. Service-role only, off the request
-- path, same signature.
--
-- TWO GUARDS THE LIVE READ PATHS CARRY AND THIS DID NOT. get_category_fill_speed,
-- get_employer_benchmarks, get_company_hiring_health and
-- get_actively_hiring_companies all require closed_at >= posted_at, and the
-- first two also require the duration to be under a year. The rollup's p50/p75
-- had neither, so a closure whose feed-supplied posted_at lands after its
-- closed_at -- which is exactly why the other four carry the guard, and is a
-- known product of the dating sweep -- contributed a NEGATIVE days value to the
-- permanent archive while being excluded from every live median. The archive is
-- the only copy that survives the prune; a definition that differs from the live
-- one cannot be detected afterwards, which is this section's own argument.
--
-- AND A dated_n COLUMN, because the same count/median split this file spends its
-- header on was about to be made permanent here: `fills` counts every
-- non-superseded closure while p50/p75 cover only the dated subset, and the
-- rollup table had no column in which to say how large that subset was. Unlike
-- get_company_hiring_health -- whose return type four consumers read by name --
-- this is a service-role writer into a table nobody reads by position, so the
-- column can simply be added.
ALTER TABLE public.job_board_closure_rollup
  ADD COLUMN IF NOT EXISTS dated_n integer;

COMMENT ON COLUMN public.job_board_closure_rollup.dated_n IS
  'Closures behind p50_days_open / p75_days_open: non-superseded, not from a '
  'suspect batch, carrying a stated posted_at with 0 <= closed_at - posted_at '
  '<= 365 days. `fills` counts a LARGER population (it does not require a post '
  'date), so dated_n / fills is the archive''s dated coverage. NULL on rows '
  'rolled before 2026-09-06, when there was no such column and the two '
  'populations were indistinguishable.';

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
      )::int AS fills,
      count(*) FILTER (WHERE c.superseded)::int AS relists,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                  AND c.posted_at IS NOT NULL
                  AND c.closed_at >= c.posted_at
                  AND c.closed_at - c.posted_at <= interval '365 days') AS p50,
      percentile_cont(0.75) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - c.posted_at)) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
                  AND c.posted_at IS NOT NULL
                  AND c.closed_at >= c.posted_at
                  AND c.closed_at - c.posted_at <= interval '365 days') AS p75,
      count(*) FILTER (WHERE NOT c.superseded AND NOT COALESCE(c.suspect, false)
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
    (company_token, company, category, month, fills, relists, dated_n, p50_days_open, p75_days_open, first_closed_at, last_closed_at, rolled_at)
  SELECT company_token, company, category, month, fills, relists, dated_n,
         round(p50::numeric, 1), round(p75::numeric, 1), first_c, last_c, now()
  FROM src
  ON CONFLICT (company_token, category, month) DO UPDATE SET
    fills = EXCLUDED.fills,
    relists = EXCLUDED.relists,
    dated_n = EXCLUDED.dated_n,
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
  'pre-stamp era.';

-- Grants, re-issued. CREATE OR REPLACE preserves existing grants, so these
-- lines exist to make the intended posture explicit and auditable rather than
-- inherited. The four public RPCs are granted and NOT revoked from PUBLIC:
-- on a function meant to be callable by anon, revoking the PUBLIC pseudo-role
-- removes nothing that anon's own named grant holds, and a half-revoke reads
-- as a closure that never happened -- which is how a telemetry aggregate
-- leaked on 2026-08-21. The rollup writer is genuinely closed, so its revoke
-- names anon and authenticated explicitly rather than PUBLIC alone.
GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_category_fill_speed(integer, integer) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_employer_benchmarks(integer, integer, integer) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.roll_up_and_prune_closures(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_closures(integer) TO service_role;

NOTIFY pgrst, 'reload schema';
