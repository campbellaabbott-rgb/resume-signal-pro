-- THE GHOST JOB INDEX STATS ARE 5.3 DAYS STALE, AND THE ROOT IS STILL A SLOW QUERY.
--
-- Measured 2026-08-08 as anon, against production:
--
--   get_ghost_job_index_stats()  ->  500, 57014, at 60.5s and 60.8s (two runs)
--   refresh_stats_cache          ->  401 (exists, service_role only)
--   stats_cache row              ->  7,665 minutes old — 5.3 days
--   job_board_stats_rollup       ->  current to the half-hour
--
-- The rollup cron is alive and the stats_cache one is not producing. Which of
-- the two possible causes it is — the old all-or-nothing refresh_stats_cache
-- still installed, or the resilient one installed but unscheduled — cannot be
-- told from outside the database, and this migration deliberately does not need
-- to know. It repairs both.
--
-- A NOTE ON A WRONG INFERENCE, recorded so it is not repeated: I argued the
-- 60s abort proved 20260807214412 had applied, because the version before it
-- used 25s. It proves nothing. 60s has been the value since 20260728215654,
-- four versions earlier. The timing distinguishes nothing at all.
--
-- WHAT ACTUALLY FIXES IT. 20260807214412 made refresh_stats_cache survive one
-- slow query — six pieces, six fates — which was the right fix for the
-- BLACKOUT and left the slow query itself in place. Ghost stats have simply
-- outgrown the request path: the loose-index-scan rewrite is not enough at
-- 598k rows, and a ceiling that gets raised each time the corpus grows is a
-- reminder to stop doing the work there, not a fix.
--
-- So it moves to the pattern that is demonstrably working on this exact table.
-- 20260806120000 did this for freshness and date coverage after both began
-- timing out; those two are current to the half-hour today while everything on
-- the request path is not. Same shape here.
--
-- WHY THIS REPAIRS stats_cache WHICHEVER CAUSE IT WAS. refresh_stats_cache
-- computes its ghost_stats piece by calling get_ghost_job_index_stats() under
-- a 20s budget. Once that call is a single-row read it cannot time out, so:
--   * if the OLD all-or-nothing version is installed, it stops throwing and the
--     whole cache — entry_stats, hiring_trends, trending_categories, all of it
--     — starts being written again;
--   * if the resilient version is installed and merely unscheduled, the
--     schedule re-assertion at the bottom starts it.
-- Neither branch needs a diagnosis first.

-- ── the computation, on its own function and its own schedule ───────────────
--
-- NOT added to refresh_job_board_stats(). That function is one plpgsql block
-- computing freshness and date coverage, so a statement that aborts inside it
-- takes the whole block down and both of those go stale — which is precisely
-- the "one slow query blacked out six statistics" incident, rebuilt. The two
-- rollups that currently work are the last thing that should be put behind this
-- one. Separate function, separate cron job, separate fate.
--
-- 10 minutes, because nobody is waiting. The whole point is that the cost is
-- off every request path; the previous ceilings (20s, 25s, 60s) were only ever
-- attempts to fit an unbounded aggregate inside a request.
CREATE OR REPLACE FUNCTION public.refresh_ghost_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
AS $$
BEGIN
  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  SELECT 'ghost_stats', to_jsonb(s), now()
  FROM (
    WITH RECURSIVE
    -- SAME EIGHT MEASUREMENTS, SAME DEFINITIONS, SAME FILTERS as the function
    -- this replaces. Read that literally: two of these definitions were
    -- incidents and published-claims.test.ts fails the build if they drift.
    --
    --   * median_days_open is measured from posted_at — the EMPLOYER's stated
    --     date — and never from first_seen, which is when WE noticed. On 4,179
    --     rows carrying both, the bases differ by 17.6 days at the median and
    --     the published figure was the flattering one.
    --   * Every count filters missing_since IS NULL. A column headed "open
    --     postings" must mean postings the board will actually serve.
    --   * posted_coverage_pct stays: GhostJobIndex gates its coverage caveat on
    --     it, and when the column was missing the caveat never rendered once.
    counts AS (
      SELECT
        count(*) FILTER (WHERE missing_since IS NULL)         AS open_n,
        count(posted_at) FILTER (WHERE missing_since IS NULL) AS dated_n
      FROM public.job_board_postings
    ),
    -- Distinct feed tokens by index seek rather than by sorting every row.
    tok AS (
        (SELECT p.company_token AS v
           FROM public.job_board_postings p
          WHERE p.company_token IS NOT NULL AND p.missing_since IS NULL
          ORDER BY p.company_token
          LIMIT 1)
      UNION ALL
        SELECT (SELECT p.company_token
                  FROM public.job_board_postings p
                 WHERE p.company_token > tok.v AND p.missing_since IS NULL
                 ORDER BY p.company_token
                 LIMIT 1)
          FROM tok
         WHERE tok.v IS NOT NULL
    ),
    -- Distinct employer names. Same grouping key as get_size_segments' `named`
    -- CTE — the RAW company string — so the headline count and the segments
    -- page cannot disagree about what one employer is.
    nm AS (
        (SELECT p.company AS v
           FROM public.job_board_postings p
          WHERE p.company <> '' AND p.missing_since IS NULL
          ORDER BY p.company
          LIMIT 1)
      UNION ALL
        SELECT (SELECT p.company
                  FROM public.job_board_postings p
                 WHERE p.company > nm.v AND p.company <> '' AND p.missing_since IS NULL
                 ORDER BY p.company
                 LIMIT 1)
          FROM nm
         WHERE nm.v IS NOT NULL
    )
    SELECT
      (SELECT open_n FROM counts)                                    AS total_open,
      (SELECT count(*) FROM tok WHERE v IS NOT NULL)                 AS total_companies,
      (SELECT count(*) FROM nm  WHERE v IS NOT NULL)                 AS total_company_names,
      (SELECT count(*) FROM public.job_board_closures
        WHERE closed_at > now() - interval '90 days')                AS closed_90d,
      (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
         FROM public.job_board_closures)                             AS observed_days,
      -- posted_at, never first_seen. See the note above.
      (SELECT round(GREATEST(EXTRACT(EPOCH FROM (now() - p.posted_at)) / 86400.0, 0)::numeric, 1)
         FROM public.job_board_postings p
        WHERE p.missing_since IS NULL AND p.posted_at IS NOT NULL
        ORDER BY p.posted_at
       OFFSET GREATEST((SELECT dated_n FROM counts) / 2, 0)
        LIMIT 1)                                                     AS median_days_open,
      (SELECT round((percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
       FROM public.job_board_closures
       WHERE closed_at > now() - interval '90 days'
         AND posted_at IS NOT NULL
         AND closed_at >= posted_at)                                 AS median_days_to_close,
      (SELECT CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END
         FROM counts)                                                AS posted_coverage_pct
  ) s
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;

REVOKE ALL ON FUNCTION public.refresh_ghost_stats() FROM PUBLIC, anon, authenticated;

-- ── the read, now a single row ──────────────────────────────────────────────
--
-- DROP before CREATE: the signature gains a trailing computed_at and Postgres
-- refuses to replace a function whose return type changed. Callers read named
-- fields off the row, so the extra column is additive for all of them — and it
-- means every surface quoting these numbers can finally say when they were
-- true, which is the same rule the facets and freshness rollups already follow.
--
-- An empty rollup returns ZERO ROWS rather than zeros. GhostJobIndex already
-- treats a missing row as "stats unavailable" and renders nothing, which is the
-- correct behaviour in the seeding window: no measurement must never render as
-- a measured zero.
DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();

CREATE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  total_company_names bigint,
  closed_90d bigint,
  observed_days integer,
  median_days_open numeric,
  median_days_to_close numeric,
  posted_coverage_pct numeric,
  computed_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
-- Small on purpose. Reading one row needs milliseconds; if this ever takes
-- seconds again, something has gone wrong and should fail fast and loudly
-- rather than hold a request open for a minute.
SET statement_timeout = '5s'
AS $$
  SELECT (r.v->>'total_open')::bigint,
         (r.v->>'total_companies')::bigint,
         (r.v->>'total_company_names')::bigint,
         (r.v->>'closed_90d')::bigint,
         (r.v->>'observed_days')::integer,
         (r.v->>'median_days_open')::numeric,
         (r.v->>'median_days_to_close')::numeric,
         (r.v->>'posted_coverage_pct')::numeric,
         r.computed_at
  FROM public.job_board_stats_rollup r
  WHERE r.k = 'ghost_stats' AND (r.v->>'total_open') IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

COMMENT ON FUNCTION public.get_ghost_job_index_stats() IS
  'Serves precomputed Ghost Job Index stats from job_board_stats_rollup. The '
  'computation lives in refresh_ghost_stats() — median_days_open is measured '
  'from the employer stated posted_at and never from first_seen, and every '
  'count filters missing_since IS NULL. Never aggregates on the request path: '
  'doing so returned 57014 at 60s for 5.3 days while the public index went on '
  'publishing stale figures.';

-- ── schedules ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent — refresh_ghost_stats must be called by the refresh job instead';
    RETURN;
  END IF;

  -- Every 30 minutes at :05/:35, deliberately off the :00/:15/:30/:45 grid the
  -- other rollups use so two heavy aggregates do not start together. These
  -- figures move over days; half an hour of staleness is far inside what any
  -- claim built on them can tolerate, and computed_at now travels with them.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-ghost-stats') THEN
    PERFORM cron.unschedule('refresh-ghost-stats');
  END IF;
  PERFORM cron.schedule('refresh-ghost-stats', '5,35 * * * *',
    $job$ SELECT public.refresh_ghost_stats(); $job$);

  -- RE-ASSERT the stats-cache schedule. If the reason stats_cache is 5.3 days
  -- old is an unscheduled or dropped job, this is the repair; if the job is
  -- present and healthy, unschedule+schedule leaves it exactly as it was. Same
  -- name and same '12 * * * *' as 20260721140000, so this cannot silently
  -- change its cadence.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-stats-cache') THEN
    PERFORM cron.unschedule('refresh-stats-cache');
  END IF;
  PERFORM cron.schedule('refresh-stats-cache', '12 * * * *',
    $job$ SELECT public.refresh_stats_cache(); $job$);
END $$;

-- Seed once so the index is live the moment this lands rather than up to half
-- an hour later.
--
-- BEST EFFORT, and the exception is swallowed on purpose: this is the same
-- aggregate that has been timing out, and while it now has a 10-minute budget
-- instead of 60 seconds, a migration that FAILS here would leave the whole
-- deploy red over a stat that the cron will fill on its next tick anyway.
DO $$
BEGIN
  PERFORM public.refresh_ghost_stats();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'refresh_ghost_stats seed failed (cron will retry): %', SQLERRM;
END $$;
