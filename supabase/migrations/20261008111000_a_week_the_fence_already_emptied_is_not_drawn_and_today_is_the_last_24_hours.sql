-- A WEEK THE FENCE ALREADY EMPTIED IS NOT DRAWN, AND "TODAY" IS THE LAST 24 HOURS.
--
-- Three defects in the two functions /hiring-trends and the /jobs ticker read,
-- fixed in one file because a guard (a-week-of-takedowns-cannot-outnumber-its-
-- own-quarter) requires the weekly series and the counter to move together.
--
-- 1. THE OLDEST WEEKLY BAR LOST THE POSTINGS THE 30-DAY CAP HAD ALREADY MOVED
--    (register L2-06). get_hiring_trends starts its series at
--    date_trunc('week', now() - 28 days). From Wednesday onwards that week's
--    Monday is more than 30 days old, and the collector moves every posting
--    dated past its 30-day freshness window to job_board_exits as aged_out --
--    "aged out, not closed" -- so those postings are in neither the live leg
--    nor the closure leg. Live on a Sunday (23:27Z): the week of Aug 31 read
--    126,499 new postings (474 entry-level, 159 remote) against 235,529,
--    265,495 and 267,124 for the next three; Monday's cache, starting Sep 7,
--    did not show it. A fabricated ~50% hiring jump, five days a week.
--    job_board_exits carries no first_seen, so the series' own three-day rule
--    cannot be applied to the aged-out rows and adding them back is not
--    honest; the week is dropped instead. The series now starts at the first
--    week wholly inside the fence: a week is drawn only if its Monday (00:00
--    UTC) is no more than 30 days before now(). The page applies the same rule
--    to any cached row it reads (src/lib/hiring-trends-trust.ts).
--
-- 2. THE REMOTE SHARE DIVIDED TWO POPULATIONS (register L2-21). new_postings
--    is the live leg PLUS the closure leg; remote_new and entry_new are counted
--    over the live leg alone, and the page divided one by the other: the week
--    of 2026-09-21 printed 4% (9,357 / 267,124) beside 5.5% on the field grid.
--    live_new is appended: the live leg's own count, the denominator remote_new
--    and entry_new were drawn from. new_postings is unchanged.
--
-- 3. "TODAY" WAS SINCE 00:00 UTC (register L11-06). /jobs printed "63 roles
--    filled or closed today" at 17:18 PT (00:18Z) while the board logs tens of
--    thousands of admissible takedowns a day: get_takedowns_today counted
--    closed_at >= date_trunc('day', now()). It is now a rolling 24 hours, and
--    the copy says so in all nine locales. Every admissibility rule is
--    unchanged.
--
-- The weekly series' shape changes (live_new), so it is dropped from the
-- catalogue by name and re-created, with its comment and grants restated; the
-- counter keeps its signature and return type, so it is a plain replace. Both
-- keep SECURITY DEFINER (the ledger is service_role-only), their headers, and
-- the census status they have today: client-callable, allowlisted. The last
-- block reads the end state back and raises if any part did not land. The
-- 30-day freshness fence itself is not touched.

SET LOCAL lock_timeout = '10s';

-- ── 1. drop every definition of the weekly series, by name, from pg_proc ────
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

-- ── 2. the weekly series, inside the fence, with its live denominator ───────
--
-- Every leg is the 20261002113617 text; `weeks` gains the fence clause and the
-- projection gains live_new.
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
    SELECT date_trunc('week', c.posted_at)::date AS w, count(DISTINCT c.posting_id)::int AS n
    FROM public.job_board_closures c
    WHERE c.posted_at IS NOT NULL AND c.posted_at > now() - interval '35 days'
      AND NOT c.superseded
      AND c.first_seen IS NOT NULL AND c.first_seen - c.posted_at < interval '3 days'
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      AND c.company_token NOT IN (SELECT company_token FROM excluded)
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
  'leg can no longer see it -- a week reaching past the fence printed about half '
  'its true count (20261008111000). '
  'SECURITY DEFINER because job_board_closures is service_role-only and an '
  'INVOKER version answers 200 with zeroes (20260820174500). '
  '`closed` is an events-per-week RATE dated by closed_at -- the day we '
  'confirmed the posting gone, never its post date -- and it EXCLUDES batches '
  'the collector flagged as possible read failures of its own (suspect), the '
  'same filter closed_90d applies, so a week can no longer outnumber the '
  'quarter it sits inside. `closed_flagged` is the count that filter removed: '
  'closed + closed_flagged is every non-superseded, non-backfill row in the '
  'week. A page that sees closed_flagged > closed is looking at a week that '
  'describes our crawler more than employers and should withhold it. A '
  'takedown is not a hire: a hire, a withdrawal, a cancelled requisition and a '
  'retitle are indistinguishable from a feed. '
  '`new_postings` counts DISTINCT postings dated that week and seen within '
  'three days of that date: live rows, plus closure rows whose posting is not '
  'already counted live. `live_new` is the live rows alone, and it is the '
  'population `entry_new` and `remote_new` are counted over: a share of either '
  'divides by live_new, never by new_postings (20261008111000; the page printed '
  '4% remote where the like-for-like share was higher). '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'statement_timeout is 60s because a timeout inside the hourly refresh is '
  'silent: the previous rows are carried forward and only stale_parts says so.';
REVOKE ALL ON FUNCTION public.get_hiring_trends() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated, service_role;

-- ── 3. the ticker, over the last 24 hours ──────────────────────────────────
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
COMMENT ON FUNCTION public.get_takedowns_today() IS
  'Non-superseded closures logged in the last 24 hours -- a rolling window, '
  'not since midnight UTC, so the figure means the same thing to a reader in '
  'any timezone (20261008111000: at 17:18 PT the since-midnight count read 63 '
  'beside a board logging tens of thousands of admissible takedowns a day). An '
  'events-per-day RATE, dated entirely by closed_at. SECURITY DEFINER because '
  'job_board_closures is service_role-only; as INVOKER it returns 0 with a '
  '200, which is indistinguishable from a quiet day (20260820174500). '
  'EXCLUDES batches the collector flagged as possible read failures of its '
  'own (suspect), the filter closed_90d and the weekly series apply, since '
  '20261002113617. The /v1/changes feed does not expose the flag, so a '
  'consumer rebuilding this figure from the feed will count higher. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist.';
REVOKE ALL ON FUNCTION public.get_takedowns_today() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_takedowns_today() TO anon, authenticated, service_role;

-- ── 4. the end state, read back from the catalog ────────────────────────────
DO $$
DECLARE
  n int;
  f oid;
  argn text[];
  definer boolean;
  cfg text[];
  src text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_hiring_trends';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_hiring_trends: expected exactly one definition, found %', n;
  END IF;
  SELECT p.oid, p.proargnames, p.prosecdef, p.proconfig, p.prosrc INTO f, argn, definer, cfg, src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_hiring_trends';
  IF argn IS NULL OR NOT ('closed_flagged' = ANY(argn)) OR NOT ('live_new' = ANY(argn)) THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created without closed_flagged or live_new: %', argn;
  END IF;
  IF NOT definer THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created as INVOKER, which answers anon with zeroes';
  END IF;
  IF cfg IS NULL OR NOT ('statement_timeout=60s' = ANY(cfg)) THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created without the sixty-second header: %', cfg;
  END IF;
  IF src NOT LIKE '%>= now() - interval ''30 days''%' THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created without the fence on its weeks';
  END IF;
  IF NOT has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_hiring_trends: anon or authenticated cannot execute it, so the page and the cache-miss path go dark';
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_takedowns_today';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_takedowns_today: expected exactly one definition, found %', n;
  END IF;
  SELECT p.oid, p.prosrc, p.prosecdef INTO f, src, definer
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_takedowns_today';
  IF src NOT LIKE '%COALESCE(suspect, false)%' OR NOT definer THEN
    RAISE EXCEPTION 'get_takedowns_today: the stored body does not exclude flagged batches, or is not DEFINER';
  END IF;
  IF src NOT LIKE '%interval ''24 hours''%' OR src LIKE '%date_trunc(''day''%' THEN
    RAISE EXCEPTION 'get_takedowns_today: the stored body is not the rolling 24 hours';
  END IF;
  IF NOT has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_takedowns_today: anon cannot execute it, so the /jobs ticker goes dark';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
