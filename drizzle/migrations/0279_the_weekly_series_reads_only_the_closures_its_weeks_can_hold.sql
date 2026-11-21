-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing and changes no job: the hourly stats cache keeps reading the weekly series on its schedule (reviewed 2026-11-18 in the bug round B integration; the owner's CW2-SC2 answer of that day ships it without the EXPLAIN below).
--
-- THE WEEKLY SERIES READS ONLY THE CLOSURES ITS WEEKS CAN HOLD (CW2-SC2).
--
-- get_hiring_trends (20261112191500, NB-46) counts, per week, the postings
-- dated in it, and its posted_closed leg adds the closure rows whose posting
-- is no longer live. That leg was bounded on posted_at alone, which the
-- closure log does not index, so every hourly stats-cache refresh (and the
-- page's live fallback when the cache lacks the series) read the whole log,
-- every closure since the collector started, to keep the ones posted in the
-- last 35 days. The takedown leg beside it was already bounded on closed_at.
--
-- The leg is now bounded on closed_at as well, as the field table's closure
-- leg has been since 20261008111500, so it can use the closed_at index. The
-- bound removes no row the leg counts: a stored posted_at is never later
-- than the moment it was read (sanePostedAt in job-board/normalize.ts clamps
-- a future date to the read), and a closure row copies it and is written
-- after that read, so a closure of a posting dated inside the last 35 days
-- was written inside them too. The bound carries one day of margin for
-- clock skew: 36 days against the 35 the posted_at clause keeps.
--
-- Everything else is 20261112191500's, letter for letter: the ticker
-- (get_takedowns_today) re-issued unchanged beside the series, because the
-- two are held to one exclusion rule and move in one file; the series'
-- signature, shape, SECURITY DEFINER, pinned search_path, sixty-second
-- header, comment and grants; the drop by name first, so the file also
-- applies over an older shape; and the end-state block, which gains the
-- bound's own checks.
--
-- AN OPTIONAL CHECK (read-only, SQL editor, not at :27-:33 or :44). The owner's
-- CW2-SC2 answer of 2026-11-18 ("A, ship now") ships this file without it.
-- An EXPLAIN of get_hiring_trends() shows only a function scan, so EXPLAIN
-- the leg itself:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT date_trunc('week', c.posted_at)::date, count(DISTINCT c.posting_id)
--     FROM public.job_board_closures c
--    WHERE c.posted_at IS NOT NULL AND c.posted_at > now() - interval '35 days'
--      AND c.closed_at > now() - interval '36 days'
--    GROUP BY 1;
-- and the same without the closed_at line. The bound does its job when the
-- first plan reads job_board_closures_closed_at_idx (or reads fewer buffers)
-- and the second reads the table whole.
--
-- The last block reads the end state back and raises if any part did not
-- land. Safe to run twice.

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.job_board_board_watch (
  company_token        text PRIMARY KEY,
  first_observed_on    date NOT NULL,
  first_observed_basis text NOT NULL,
  is_censored          boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 1. the ticker, unchanged: the rolling 24 hours, flagged batches excluded.
CREATE OR REPLACE FUNCTION public.get_takedowns_today()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  SELECT count(*)::int FROM public.job_board_closures
  WHERE closed_at > now() - interval '24 hours' AND NOT superseded
    AND NOT COALESCE(suspect, false)
    AND absence_basis IS DISTINCT FROM 'lap_backfill';
$$;
REVOKE ALL ON FUNCTION public.get_takedowns_today() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_takedowns_today() TO anon, authenticated, service_role;

-- 2. the weekly series: the same signature and shape, its posted_closed leg
-- bounded on closed_at. Dropped by name first, as 20261112191500 does, so the
-- file also applies over an older shape.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'get_hiring_trends'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int, closed_flagged int, live_new int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s' AS $$
  WITH excluded AS (SELECT company_token FROM public.showcase_excluded),
  epoch AS (
    SELECT date_trunc('week', min(closed_at))::date AS w0 FROM public.job_board_closures
    WHERE absence_basis IS DISTINCT FROM 'lap_backfill'
  ),
  weeks AS (
    SELECT date_trunc('week', d)::date AS week_start
    FROM generate_series(date_trunc('week', now() - interval '28 days'), now(), interval '1 week') d
    WHERE date_trunc('week', d)::date >= COALESCE((SELECT w0 FROM epoch), date_trunc('week', now())::date)
      AND (date_trunc('week', d)::date)::timestamp AT TIME ZONE 'UTC' >= now() - interval '30 days'
  ),
  watched AS (
    SELECT w.company_token FROM public.job_board_board_watch w
    WHERE w.first_observed_on <= (SELECT min(k.week_start) FROM weeks k)
  ),
  posted_live AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n,
      (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_new,
      (count(*) FILTER (WHERE remote))::int AS remote_new
    FROM public.job_board_postings
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND first_seen - posted_at < interval '3 days'
      AND company_token NOT IN (SELECT company_token FROM excluded)
      AND company_token IN (SELECT company_token FROM watched)
    GROUP BY 1
  ),
  posted_closed AS (
    SELECT date_trunc('week', c.posted_at)::date AS w, count(DISTINCT c.posting_id)::int AS n
    FROM public.job_board_closures c
    WHERE c.posted_at IS NOT NULL AND c.posted_at > now() - interval '35 days'
      AND c.first_seen IS NOT NULL AND c.first_seen - c.posted_at < interval '3 days'
      AND c.closed_at > now() - interval '36 days'
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      AND c.company_token NOT IN (SELECT company_token FROM excluded)
      AND c.company_token IN (SELECT company_token FROM watched)
      AND NOT EXISTS (
        SELECT 1 FROM public.job_board_postings p
        WHERE p.id = c.posting_id
          AND p.posted_at IS NOT NULL AND p.posted_at > now() - interval '35 days'
          AND p.first_seen - p.posted_at < interval '3 days')
    GROUP BY 1
  ),
  closes AS (
    SELECT date_trunc('week', closed_at)::date AS w,
           (count(*) FILTER (WHERE NOT COALESCE(suspect, false)))::int AS closed,
           (count(*) FILTER (WHERE COALESCE(suspect, false)))::int AS closed_flagged
    FROM public.job_board_closures
    WHERE closed_at > now() - interval '35 days' AND NOT superseded
      AND absence_basis IS DISTINCT FROM 'lap_backfill'
      AND company_token NOT IN (SELECT company_token FROM excluded)
      AND company_token IN (SELECT company_token FROM watched)
    GROUP BY 1
  )
  SELECT weeks.week_start,
         COALESCE(posted_live.n, 0) + COALESCE(posted_closed.n, 0),
         COALESCE(posted_live.entry_new, 0),
         COALESCE(posted_live.remote_new, 0),
         COALESCE(closes.closed, 0),
         COALESCE(closes.closed_flagged, 0),
         COALESCE(posted_live.n, 0)
  FROM weeks
  LEFT JOIN posted_live   ON posted_live.w   = weeks.week_start
  LEFT JOIN posted_closed ON posted_closed.w = weeks.week_start
  LEFT JOIN closes        ON closes.w        = weeks.week_start
  ORDER BY weeks.week_start;
$$;
COMMENT ON FUNCTION public.get_hiring_trends() IS
  'Weekly new postings and takedowns for /hiring-trends, over the weeks wholly '
  'inside the 30-day freshness fence: a week is returned only if its Monday '
  '(00:00 UTC) is no more than 30 days before now(), because the collector moves '
  'every posting dated past 30 days to job_board_exits as aged_out and the live '
  'leg can no longer see it (20261008111000). '
  'Only boards job_board_board_watch says we observed by the Monday of the '
  'first week returned count, on every leg, so a board catalogued mid-series '
  'raises no later week (20261112191500). '
  'SECURITY DEFINER because job_board_closures is service_role-only and an '
  'INVOKER version answers 200 with zeroes (20260820174500). '
  '`closed` is an events-per-week RATE dated by closed_at (the day we '
  'confirmed the posting gone, never its post date); it EXCLUDES batches the '
  'collector flagged as possible read failures of its own (suspect), the same '
  'filter closed_90d applies, so a week can no longer outnumber the quarter it '
  'sits inside, and it excludes same-title re-lists, which are not takedowns. '
  '`closed_flagged` is the count that filter removed. A takedown is not a '
  'hire: a hire, a withdrawal, a cancelled requisition and a retitle are '
  'indistinguishable from a feed. '
  '`new_postings` counts DISTINCT postings dated that week and seen within '
  'three days of that date: live rows, plus closure rows whose posting is not '
  'already counted live, a posting later taken down as a same-title re-list '
  'included (20261112191500: dropping those removed more from older weeks as '
  'the marks accrued, and the week-over-week change read as growth). '
  '`live_new` is the live rows alone, and it is the population `entry_new` and '
  '`remote_new` are counted over: a share of either divides by live_new, never '
  'by new_postings. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL. lap_backfill is EXCLUDED '
  'and must stay excluded: its closed_at is the day we could finally see the '
  'takedown. statement_timeout is 60s because a timeout inside the hourly '
  'refresh is silent: the previous rows are carried forward and only '
  'stale_parts says so.';
REVOKE ALL ON FUNCTION public.get_hiring_trends() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated, service_role;

-- 3. the end state, read back.
DO $verify$
DECLARE
  f   regprocedure := to_regprocedure('public.get_trending_categories(integer)');
  g   regprocedure := to_regprocedure('public.get_hiring_trends()');
  src text;
  fsrc text;
  leg text;
BEGIN
  IF g IS NULL THEN
    RAISE EXCEPTION 'get_hiring_trends() is missing';
  END IF;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_takedowns_today()');
  IF src IS NULL OR position('COALESCE(suspect, false)' IN src) = 0 OR position('24 hours' IN src) = 0 THEN
    RAISE EXCEPTION 'get_takedowns_today: the stored body does not exclude flagged batches over the rolling 24 hours';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_takedowns_today()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_takedowns_today: anon cannot execute it, so the /jobs ticker goes dark';
  END IF;
  IF NOT (SELECT 'closed_flagged' = ANY (p.proargnames) AND 'live_new' = ANY (p.proargnames) FROM pg_proc p WHERE p.oid = g) THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created without closed_flagged or live_new';
  END IF;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = g;
  IF position('public.job_board_board_watch w' IN src) = 0
     OR position('c.company_token IN (SELECT company_token FROM watched)' IN src) = 0
     OR (length(src) - length(replace(src, 'company_token IN (SELECT company_token FROM watched)', ''))) / length('company_token IN (SELECT company_token FROM watched)') <> 3 THEN
    RAISE EXCEPTION 'get_hiring_trends: a leg is not held to the boards watched through the series';
  END IF;
  IF position('posted_closed AS (' IN src) = 0 OR position('closes AS (' IN src) <= position('posted_closed AS (' IN src) THEN
    RAISE EXCEPTION 'get_hiring_trends: no posted_closed leg before the takedown leg';
  END IF;
  leg := substring(src FROM position('posted_closed AS (' IN src) FOR position('closes AS (' IN src) - position('posted_closed AS (' IN src));
  IF position('AND c.closed_at > now() - interval ''36 days''' IN leg) = 0 THEN
    RAISE EXCEPTION 'get_hiring_trends: the posted_closed leg is not bounded on closed_at (CW2-SC2)';
  END IF;
  IF position('c.posted_at > now() - interval ''35 days''' IN leg) = 0 THEN
    RAISE EXCEPTION 'get_hiring_trends: the posted_closed leg lost the 35-day posted_at window its 36-day bound is a margin over';
  END IF;
  IF position('AND NOT c.superseded' IN src) > 0 THEN
    RAISE EXCEPTION 'get_hiring_trends: still drops a posting that came down as a same-title re-list from its own week';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = g) THEN
    RAISE EXCEPTION 'get_hiring_trends: not SECURITY DEFINER, so anon reads an empty ledger';
  END IF;
  IF NOT (SELECT 'statement_timeout=60s' = ANY (p.proconfig) AND 'search_path=public' = ANY (p.proconfig)
            FROM pg_proc p WHERE p.oid = g) THEN
    RAISE EXCEPTION 'get_hiring_trends: lost its sixty-second header or its pinned search_path';
  END IF;
  IF NOT has_function_privilege('anon', g, 'EXECUTE') OR NOT has_function_privilege('authenticated', g, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_hiring_trends: the page''s roles cannot execute it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = g AND a.grantee = 0) THEN
    RAISE EXCEPTION 'get_hiring_trends: still granted to PUBLIC';
  END IF;
  -- The field table, where it exists, holds the same closed-leg clause.
  IF f IS NOT NULL THEN
    SELECT p.prosrc INTO fsrc FROM pg_proc p WHERE p.oid = f;
    IF position('c.company_token IN (SELECT company_token FROM watched)' IN fsrc) = 0
       OR position('AND NOT c.superseded' IN fsrc) > 0 THEN
      RAISE EXCEPTION 'get_trending_categories does not hold the rule the weekly series holds';
    END IF;
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
