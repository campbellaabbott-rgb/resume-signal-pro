-- A WEEK OF TAKEDOWNS IS COUNTED ON THE FILTER ITS QUARTER USES.
--
-- WHAT WAS PUBLISHED. /hiring-trends printed 845,110, 870,536 and 806,570
-- "roles filled or closed" for the weeks beginning 09-07, 09-14 and 09-21,
-- read out of the same hourly cache row that carried a 90-day closure total of
-- 1,852,789. Each of those weeks was larger than the whole servable board
-- (~752k), and three of them summed to 2.5M against a quarter of 1.85M. A week
-- cannot outnumber the quarter it sits inside unless the two are counted on
-- different rules, and they were. The /jobs ticker ("roles filled or closed
-- today") read 130,373 on 2026-10-01 off the same gap.
--
-- THE ONE PREDICATE THAT DIFFERED. The weekly series' `closes` leg and the
-- 90-day total (refresh_ghost_stats' closed_90d) read the same ledger, on the
-- same date column, with the same relist and first-lap-backfill exclusions.
-- The 90-day total also drops every batch the collector stamped as doubted --
-- the feed-dark guard of 20260906090000 -- and the weekly leg did not. (The
-- weekly leg additionally drops showcase-excluded boards, which can only ever
-- make it the SMALLER number.) So the doubted-batch predicate was the only
-- thing that could make a week exceed its quarter, and two live numbers size
-- it: 3,149,729 non-superseded, non-backfill rows in 30 days against 1,852,789
-- admitted rows in 90 means at least 1.3M doubted rows in the last month. The
-- ticker had the same omission. Both readers were pinned by name in the
-- known-unguarded ledger of a-collection-failure-is-not-four-hundred-fills
-- from the day the guard shipped; this file is the fix that ledger waited for.
--
-- WHERE THE DOUBTED MASS COMES FROM, AND WHY THIS FILE DOES NOT TOUCH IT. The
-- Workday fetcher reports an exhaustive read on every RESUMED visit, because
-- Workday's jobs API answers `total: 0` at any offset past zero (measured on
-- six tenants; SmartRecruiters, the control, keeps its total on every page).
-- Each 250-row window then reconciles as though it were the whole board, every
-- stored row outside it is logged as a takedown, and the rows come back on the
-- next lap. The guard catches most of those batches, which is why the 90-day
-- total stayed plausible while the week did not. Fixing the fetcher changes
-- how many rows every large Workday board holds, against a corpus ceiling that
-- is not yet sized, and that is the owner's decision rather than this file's.
-- What this file does is make the weekly figure comparable with the 90-day one
-- and publish, beside it, how much was doubted -- so a page can see when the
-- doubted rows outnumber the admitted ones and decline to print the week.
--
-- WHAT CHANGES, AND WHY EACH.
--
--   1. `closes` -- one scan, two counts. `closed` is the rows the collector
--      did not doubt; `closed_flagged` is the rows it did. Same WHERE, same
--      GROUP BY, so it costs what the old leg cost. closed + closed_flagged is
--      every non-superseded, non-backfill row in the week -- exactly the
--      pre-fix figure -- which makes the deploy provable from outside: the
--      three complete weeks already published must partition into the two new
--      columns without a row left over (scripts/verify-deploy.sh, 7g).
--
--   2. `posted_closed` -- DISTINCT postings, and none already counted live.
--      The same flap that writes the doubted takedowns re-inserts the posting
--      afterwards, so one posting dated last Tuesday could leave three closure
--      rows inside its three-day window plus a live row, and the old leg
--      counted every one: two churned postings came out as five new ones in
--      pglite. A posting now counts once in this leg, and not at all when a
--      live row with the same id already passes the live leg's own gate.
--      Doubted rows STAY in this leg on purpose. The doubt is about the
--      takedown, never about whether the employer dated a posting that week.
--
--   3. The header -- a sixty-second statement_timeout where it was twenty.
--      The pre-fix body ran 7-13s live. In a 1.2M-closure pglite model the
--      distinct sort and the anti-join cost about 1.95x the old body, which
--      projects past twenty, and a timeout here is SILENT: the hourly refresh
--      catches it, carries the previous (inflated) rows forward and names
--      hiring_trends in stale_parts, which the page never reads. Sixty keeps
--      the sum of every callee ceiling inside the refresh's own ten-minute
--      header; that sum is derived from source by
--      the-field-curve-the-page-waited-a-minute-for-joins-the-hourly-cache.
--      If sixty proves tight, the anti-join in (2) goes first.
--
--   4. Today's takedown counter -- the same body plus the doubted-batch
--      exclusion, on the same NULL-safe spelling every fill reader uses.
--
-- DROPPED FROM THE CATALOG, THEN RE-CREATED. A new output column is a change
-- of return type, which a plain replace refuses. The drop enumerates pg_proc
-- by name rather than typing a signature, because this database has held
-- functions no migration describes and a hand-listed drop would leave a
-- stray overload behind. The re-create keeps the replace spelling all the
-- same, because a dozen guards find a function's current body by that
-- spelling. A drop also removes the comment and the grants, so both are
-- restated, and the last block reads the end state back from the catalog and
-- raises if any part did not land -- a staged runner that edits a failing
-- migration into something else must not be able to report success.
--
--    REJECTED -- ADD THE FILTER AND KEEP FIVE COLUMNS. One line, and the week
--    would read on the 90-day rule. It is rejected because the excluded share
--    of the three affected weeks is around four rows in five, and an exclusion
--    nobody can size is a silent one: the page needs the doubted count to know
--    that the admitted figure describes our crawler more than it describes
--    employers, and a reader needs it to know how much was taken out.
--
--    REJECTED -- PRINT THE ADMITTED FIGURE FOR THOSE WEEKS. It would be about
--    200-265k, under the plausibility ceiling, and still wrong both ways: the
--    guard only fires when a board loses more than thirty per cent of what it
--    held, so smaller phantom batches sit inside the admitted count, and every
--    real takedown on a doubted board sits outside it. That is a page decision
--    and is taken there (src/lib/hiring-trends-trust.ts holds a week whose
--    doubted rows outnumber its admitted ones); this file supplies the two
--    numbers the decision needs.
--
--    REJECTED -- DELETE OR RE-MARK THE DOUBTED ROWS. The closure ledger is the
--    one asset here that cannot be rebuilt, and 20261001090000 stopped even the
--    roll-up prune from deleting it. A retroactive re-mark of millions of rows
--    is a one-way edit of that asset and is left to the owner.
--
--    REJECTED -- RAISE THE HEADER ONLY IF IT TIMES OUT. A timeout here does
--    not surface anywhere a person looks; it surfaces as last week's wrong
--    numbers carried forward under a fresh stamp. Paying for the headroom up
--    front is cheaper than discovering its absence from the page.
--
-- DEPLOY ORDER. Frontend first -- its verdict judges an old five-column row by
-- the plausibility ceiling alone, so it is safe whichever lands first -- then
-- this migration, then a frontend rebuild, because the prerender reads the
-- cache at build time. Judge it by behaviour, never by the runner's report:
-- after the next hourly tick every stats_cache.hiring_trends row carries a
-- numeric closed_flagged and stale_parts does not name hiring_trends.

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

-- ── 2. the weekly series, on the 90-day total's admissibility rule ──────────
--
-- SECURITY DEFINER is spelled in the header, as 20260909201000 spelled it: the
-- closure ledger is service_role-only and an INVOKER version answers 200 with
-- zeroes (20260820174500). The CTE names, the showcase exclusion inside every
-- leg before its GROUP BY, and the NULL-safe backfill predicate are unchanged
-- from that body; guards read each of them.
CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int, closed_flagged int)
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
         COALESCE(closes.closed_flagged, 0)
  FROM weeks
  LEFT JOIN posted_live   ON posted_live.w   = weeks.week_start
  LEFT JOIN posted_closed ON posted_closed.w = weeks.week_start
  LEFT JOIN closes        ON closes.w        = weeks.week_start
  ORDER BY weeks.week_start;
$$;
COMMENT ON FUNCTION public.get_hiring_trends() IS
  'Weekly new postings and takedowns over a 35-day window, for /hiring-trends. '
  'SECURITY DEFINER because job_board_closures is service_role-only and an '
  'INVOKER version answers 200 with zeroes (20260820174500). '
  '`closed` is an events-per-week RATE dated by closed_at -- the day we '
  'confirmed the posting gone, never its post date -- and it EXCLUDES batches '
  'the collector flagged as possible read failures of its own (suspect), the '
  'same filter closed_90d applies, so a week can no longer outnumber the '
  'quarter it sits inside. `closed_flagged` is the count that filter removed: '
  'closed + closed_flagged is every non-superseded, non-backfill row in the '
  'week, which is the figure this function returned before 20261002113617. A '
  'page that sees closed_flagged > closed is looking at a week that describes '
  'our crawler more than employers and should withhold it. A takedown is not '
  'a hire: a hire, a withdrawal, a cancelled requisition and a retitle are '
  'indistinguishable from a feed. '
  '`new_postings` counts DISTINCT postings dated that week and seen within '
  'three days of that date: live rows, plus closure rows whose posting is not '
  'already counted live. Flagged closure rows are kept in that leg, because '
  'the flag doubts the takedown, not that the posting was dated that week. '
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
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated, service_role;

-- ── 3. today's takedown counter, on the same rule ───────────────────────────
--
-- Same signature and return type, so this one is a plain replace and keeps its
-- grants; they are restated anyway so the reachable set is read here, not
-- inherited from 20260909201000.
CREATE OR REPLACE FUNCTION public.get_takedowns_today()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  SELECT count(*)::int FROM public.job_board_closures
  WHERE closed_at >= date_trunc('day', now()) AND NOT superseded
    AND NOT COALESCE(suspect, false)
    AND absence_basis IS DISTINCT FROM 'lap_backfill';
$$;
COMMENT ON FUNCTION public.get_takedowns_today() IS
  'Non-superseded closures logged since midnight UTC -- an events-per-day '
  'RATE, dated entirely by closed_at. SECURITY DEFINER because '
  'job_board_closures is service_role-only; as INVOKER it returns 0 with a '
  '200, which is indistinguishable from a quiet day (20260820174500). '
  'EXCLUDES batches the collector flagged as possible read failures of its '
  'own (suspect), the filter closed_90d and the weekly series apply, since '
  '20261002113617: before it this counter read 130,373 on a day the admitted '
  'rate was a fraction of that. The /v1/changes feed does not expose the flag, '
  'so a consumer rebuilding this figure from the feed will count higher. '
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
GRANT EXECUTE ON FUNCTION public.get_takedowns_today() TO anon, authenticated, service_role;

-- ── 4. the end state, read back from the catalog ────────────────────────────
--
-- Exactly one weekly series, carrying the new column, as DEFINER, with the
-- sixty-second header, executable by anon; and a ticker whose stored body
-- carries the doubted-batch exclusion. Anything else rolls the file back.
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
  SELECT p.oid, p.proargnames, p.prosecdef, p.proconfig INTO f, argn, definer, cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_hiring_trends';
  IF argn IS NULL OR NOT ('closed_flagged' = ANY(argn)) THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created without closed_flagged: %', argn;
  END IF;
  IF NOT definer THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created as INVOKER, which answers anon with zeroes';
  END IF;
  IF cfg IS NULL OR NOT ('statement_timeout=60s' = ANY(cfg)) THEN
    RAISE EXCEPTION 'get_hiring_trends: re-created without the sixty-second header: %', cfg;
  END IF;
  IF NOT has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_hiring_trends: anon cannot execute it, so the page and the cache-miss path go dark';
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_takedowns_today';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_takedowns_today: expected exactly one definition, found %', n;
  END IF;
  SELECT p.prosrc, p.prosecdef INTO src, definer
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_takedowns_today';
  IF src NOT LIKE '%COALESCE(suspect, false)%' OR NOT definer THEN
    RAISE EXCEPTION 'get_takedowns_today: the stored body does not exclude flagged batches, or is not DEFINER';
  END IF;
END $$;
