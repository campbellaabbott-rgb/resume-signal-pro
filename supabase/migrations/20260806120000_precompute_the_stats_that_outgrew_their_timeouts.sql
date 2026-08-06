-- The two stats RPCs behind the public status endpoint stopped answering.
--
-- Measured 2026-08-06, directly against production:
--   get_freshness_stats  → 500 "57014 canceling statement due to statement
--                          timeout" after 20.7s
--   get_date_coverage    → 500, same, 20.7s
--
-- Both are O(n) aggregates over job_board_postings, which is now ~592k rows and
-- is written continuously by the refresh sweeps. They did not break; they were
-- outgrown. The consequences were already live and silent:
--
--   1. job-board's `status` awaits both behind deadlines (2.5s / 8s), giving it
--      an ~8s floor. Status measured 8.5-26s, straddling the heartbeat's 15s
--      abort, so the job_board_deploy check FLAPPED and reported the board
--      unreachable while it was serving audits fine.
--   2. The heartbeat's job_board_freshness_claim check took its
--      RPC-unavailable path on every run and vanished from the output. Nothing
--      was watching the published "re-verified within a few hours" claim.
--
-- Neither aggregate needs to be live. Board freshness moves over hours and date
-- coverage over days, so both are precomputed on a schedule and served from a
-- one-row-per-key rollup. The RPCs keep their exact return signatures — status,
-- the Ghost Job Index and the heartbeat keep working unchanged — and gain a
-- trailing computed_at so every consumer can state how old the measurement is
-- instead of implying it is live.

CREATE TABLE IF NOT EXISTS public.job_board_stats_rollup (
  k text PRIMARY KEY,
  v jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_board_stats_rollup ENABLE ROW LEVEL SECURITY;

-- Read-only to the world: these are published stats. Writes happen only through
-- the SECURITY DEFINER refresher below, never directly.
DROP POLICY IF EXISTS job_board_stats_rollup_read ON public.job_board_stats_rollup;
CREATE POLICY job_board_stats_rollup_read
  ON public.job_board_stats_rollup FOR SELECT USING (true);

GRANT SELECT ON public.job_board_stats_rollup TO anon, authenticated;

-- The expensive work, in one place, run on a schedule rather than per request.
-- SECURITY DEFINER so the cron job can write the rollup; it takes no arguments
-- and writes only this table, so there is no injection surface to widen.
CREATE OR REPLACE FUNCTION public.refresh_job_board_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  -- Freshness: age distribution of per-board verification stamps, restricted to
  -- boards that still have postings (an orphaned stamp describes a board that
  -- is no longer served — see 20260719140000).
  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  SELECT
    'freshness',
    jsonb_build_object(
      'boards',   count(*),
      'p50_min',  round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY age_min))::numeric, 1),
      'p95_min',  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY age_min))::numeric, 1),
      'max_min',  round((max(age_min))::numeric, 1)
    ),
    now()
  FROM (
    -- aliased `ver`, not `v`: the target table's jsonb column is also named v,
    -- and ON CONFLICT ... SET v = EXCLUDED.v sits in the same statement.
    SELECT EXTRACT(EPOCH FROM (now() - ver.verified_at)) / 60.0 AS age_min
    FROM public.job_board_verifications ver
    WHERE EXISTS (
      SELECT 1 FROM public.job_board_postings p
      WHERE p.company_token = ver.company_token
    )
  ) live
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;

  -- Date coverage: per-source totals and how many state a posting date.
  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  SELECT
    'date_coverage',
    COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'dated', dated)
                       ORDER BY total DESC), '[]'::jsonb),
    now()
  FROM (
    SELECT source, count(*) AS total, count(posted_at) AS dated
    FROM public.job_board_postings
    WHERE missing_since IS NULL
    GROUP BY source
  ) s
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;

REVOKE ALL ON FUNCTION public.refresh_job_board_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_job_board_stats() FROM anon, authenticated;

-- ── The two RPCs, now instant reads of the rollup ───────────────────────────
-- Return signatures are UNCHANGED except for a trailing computed_at. Callers
-- read named fields off the row, so an added column is additive for all of
-- them. An empty rollup returns zero rows — exactly what callers already treat
-- as "not available", so the pre-seed window degrades to the behaviour they
-- were already written against.

-- DROP before CREATE, not CREATE OR REPLACE: both gain a trailing computed_at,
-- and Postgres refuses to replace a function whose return type changed
-- ("cannot change return type of existing function"). The drops also mean the
-- grants below are the ONLY grants these functions carry.
DROP FUNCTION IF EXISTS public.get_freshness_stats();
DROP FUNCTION IF EXISTS public.get_date_coverage();

-- Every column is table-qualified through the alias `r`. RETURNS TABLE names
-- are OUT parameters and are in scope inside the body, so a bare `computed_at`
-- here is ambiguous against the output column of the same name and the function
-- fails to create.
CREATE FUNCTION public.get_freshness_stats()
RETURNS TABLE (boards integer, p50_min numeric, p95_min numeric, max_min numeric, computed_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT (r.v->>'boards')::int,
         (r.v->>'p50_min')::numeric,
         (r.v->>'p95_min')::numeric,
         (r.v->>'max_min')::numeric,
         r.computed_at
  FROM public.job_board_stats_rollup r
  WHERE r.k = 'freshness' AND (r.v->>'p95_min') IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_freshness_stats() TO anon, authenticated;

CREATE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint, computed_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT e.value->>'source',
         (e.value->>'total')::bigint,
         (e.value->>'dated')::bigint,
         r.computed_at
  FROM public.job_board_stats_rollup r
  CROSS JOIN LATERAL jsonb_array_elements(r.v) AS e(value)
  WHERE r.k = 'date_coverage'
  ORDER BY (e.value->>'total')::bigint DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;

-- Every 15 minutes. Board freshness is judged against a 5-hour P95 bound and
-- date coverage moves over days, so a quarter-hour of staleness is far inside
-- what either claim can tolerate — and computed_at travels with both so the
-- staleness is stated rather than assumed away.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-stats-rollup') THEN
      PERFORM cron.unschedule('job-board-stats-rollup');
    END IF;
    PERFORM cron.schedule(
      'job-board-stats-rollup',
      '*/15 * * * *',
      $job$ SELECT public.refresh_job_board_stats(); $job$
    );
  END IF;
END $$;

-- Seed once so the rollup is populated the moment this lands rather than up to
-- 15 minutes later. BEST EFFORT: this is the same expensive aggregate that has
-- been timing out, and a migration that fails here would be worse than a table
-- that fills on the next cron tick. The exception is swallowed deliberately and
-- loudly.
DO $$
BEGIN
  PERFORM public.refresh_job_board_stats();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'job_board_stats_rollup seed failed (%), leaving it to the 15-minute cron', SQLERRM;
END $$;
