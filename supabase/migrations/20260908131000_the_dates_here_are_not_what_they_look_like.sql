-- THE DATES HERE ARE NOT WHAT THEY LOOK LIKE — RANKED BY CONDUCT, GROUPED BY
-- THE KEY THE DATA WAS WRITTEN UNDER.
--
-- This replaces what /explore has been calling "serial re-posters", which is
-- get_repost_churn_companies: no time window at all, GROUP BY the RAW title,
-- and ORDER BY raw event count. Three defects, and they compound.
--
--   1. NO WINDOW. `sup` has no closed_at predicate, so an employer that
--      churned once and reformed carries the finding forever. Every other
--      quantity on the page is windowed; this one was a grudge.
--
--   2. RAW-TITLE GROUPING. See 20260908130000. The collector's own two
--      decisions about a relist are taken on normalize_close_title, so the raw
--      column is the one spelling nothing reasons about.
--
--   3. RANKED BY SIZE UNDER A CLAIM ABOUT CONDUCT. repost_events is
--      size-correlated: a 12,000-posting board accumulates events by existing.
--      20260812130736 measured this and said so — the two largest employers by
--      raw events sat BELOW the median rate — and then left the leaderboard
--      ranking on the raw count anyway. Ranking by size under a heading that
--      accuses is not a misranking, it is a defamation with a denominator
--      missing.
--
-- SO THE RANKING KEY IS EVENTS PER AFFECTED ROLE. And that is exactly why the
-- title port had to land first: under a per-role RATE, raw-title grouping
-- inverts the answer. An employer stamping a fresh req id on every repost
-- splits its events into one-event groups and scores ~1.0; an employer with
-- stable titles concentrates them and tops the list. The section would print
-- its worst verdict over whichever employer decorates its titles LEAST.
--
-- ONE WINDOW, COMMON TO EVERY CARD, AND IT SAYS HOW LONG IT REALLY IS. The
-- predicate is 90 days, matching every other _90d quantity on this page. The
-- closure log began 2026-07-14, so 90 days currently selects the ENTIRE log
-- and the honest length of the window is the log itself: window_days is
-- returned, computed as LEAST(90, the log''s own span), and is 56 today. No
-- card may say "90 days of watching" — that is a watch we did not perform.
-- Each card also carries observed_days, ITS OWN span since the first relist we
-- logged for that employer, because tracking_days is per-employer everywhere
-- else on this page and the two are not the same number.
--
-- THE BASELINE IS RE-MEASURED IN THIS STATEMENT, NEVER QUOTED. The old
-- baseline — "median 2.7 re-lists per affected role" — was measured on
-- 2026-08-12, over the 300 highest-EVENT employers, on RAW titles, on an
-- unbounded window, at 29 days of log. Every one of those four is a different
-- definition from the one used here, and reusing the number under this
-- definition would be the exact error this rebuild exists to stop. It is not
-- re-quoted with a new date either: board_median_per_title and
-- board_p90_per_title are computed over THIS pool, in THIS statement, under
-- THIS normalisation and window, and so are re-measured every time the cache
-- refreshes. A baseline that can go stale eventually does.
--
-- THE GATE IS THE SAMPLE FLOOR ALONE, AND THAT IS A DELIBERATE SUBTRACTION.
-- 20260812130736 gated get_repost_index on `events >= 25 AND events/roles >=
-- 5`. The events floor carries over untouched: it counts the same rows under
-- the same definition, since regrouping changes group boundaries and not the
-- sum. The RATE half does not carry over — 5-per-role was measured on raw
-- titles, and merging decorated variants moves every rate up by an amount
-- nobody has measured. Re-using it here would be publishing a threshold under
-- a definition it was never calibrated against. So the pool is "at least 25
-- logged re-listings", the twelve shown are the twelve highest RATES in it,
-- and the card states the pool size and the pool''s own median and p90 beside
-- the employer''s rate. A reader can see where in the distribution the card
-- sits without anyone inventing a cut point. (get_repost_index, the warning
-- that follows an employer into other sections, is deliberately NOT touched
-- here: its gate was calibrated on raw grouping, and re-gating it needs the
-- measurement this file cannot take. Its contract already reads "did not clear
-- this gate", never "does not re-post".)
--
-- EVERY COUNT HERE IS A FLOOR — AND THE RATIO BETWEEN TWO FLOORS IS NOT ONE.
-- The collector logs at most ONE superseded closure per normalised title per
-- employer per 24h and DELETES the deduped postings outright (one live board
-- collapsed the same title 89 times in a day into a single row), so
-- relist_events_floor and worst_title_events_floor are lower bounds and are
-- named for it.
--
-- relisted_titles IS A FLOOR TOO, AND THAT IS EXACTLY WHY THE RATIO CANNOT BE
-- ONE. The 24h dedupe alone would leave the denominator whole — the first event
-- of every title is always logged — and an earlier draft of this file reasoned
-- from that to call the ratio a floor. But the dedupe is not the only
-- subtraction: the feed-dark rule below drops WHOLE BATCHES, and a title whose
-- only logged event sat in a dropped batch leaves the count of titles as well
-- as the count of events. Removing (e events, 1 title) from (E, T) moves E/T UP
-- when e < E/T and DOWN when e > E/T, so the direction is not knowable from
-- here. The ranking key is therefore returned as events_per_title, with no
-- floor in its name, and must be rendered with no floor marker: a "+" on it
-- would be a claim about direction, made on the one number this section ranks
-- employers by, under a heading that names conduct. The two counts it is built
-- from keep theirs.
--
-- OUR OWN OUTAGES ARE NOT THEIR CONDUCT. A pass where we lost sight of a feed
-- can only ADD events to an accusation, so both guards the estimator uses are
-- applied here: batches the collector stamped `suspect`, and — over the
-- unstamped era alone, which is how the estimator scopes it — any
-- (company_token, closed_at) batch that removed more than max(25, 0.30 x the
-- employer's served count). Both are dropped from the input entirely. The
-- estimator prefers the contemporaneous board size from a snapshot where one
-- survives; snapshots are pruned at 35 days and this scan is board-wide rather
-- than over twelve tokens, so the affordable form is the estimator's own
-- FALLBACK rule — today's served count with the floor raised to 25. It
-- over-deletes a wind-down, which is the right direction of error for a
-- heading that accuses.
--
-- A CLOSURE IS STILL NEVER A HIRE. Nothing here says filled: superseded means
-- the same normalised title was still live on the board when this one came
-- down. That is a re-listing, and a re-listing is what resets the date a
-- reader sees.

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
             SELECT min(c.closed_at) FROM public.job_board_closures c))::int, 1))::int AS win_days
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

-- Cron-only, like the transparency list and the repost index. It groups the
-- whole superseded closure set twice; anon holding EXECUTE on that is a
-- worker-exhaustion lever, and the page reads it out of the hourly cache.
REVOKE ALL ON FUNCTION public.get_relisting_employers(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_relisting_employers(int) TO service_role;

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
  'came down. Cron-only; the page reads it from the explore cache.';

NOTIFY pgrst, 'reload schema';
