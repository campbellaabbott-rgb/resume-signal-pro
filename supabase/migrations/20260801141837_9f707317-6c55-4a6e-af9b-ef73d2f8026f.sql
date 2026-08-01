-- get_job_board_facets is timing out. Cache it, and say when it was computed.
--
-- MEASURED 2026-08-01: HTTP 500, `57014 canceling statement due to statement
-- timeout`, after 20.3s, reproduced three times. The board itself is fine —
-- /jobs returns postings and a total of 583,206 — but the facets RPC feeds the
-- filter counts, and it now fails for every visitor and for the SEO prerender.
--
-- WHY IT BROKE. The function runs three full-table aggregations over 584k rows:
-- count(*), GROUP BY company_token (~10k groups), GROUP BY category. That grew
-- past the 20s cap. Nothing is wrong with the SQL; there is simply no amount of
-- tuning that makes three sequential scans of a table this size an
-- appropriate thing to do on every page view.
--
-- A NOTE ON THE OLD GUARD, because its comment is misleading. The previous
-- migration added `SET statement_timeout = '20s'` and described it as making
-- these functions "RETURN instead of erroring". statement_timeout does not do
-- that — it ABORTS with 57014, which is exactly the failure being seen now. Its
-- real effect was to RAISE the budget above the caller's role default. Worth
-- correcting so nobody adds another one expecting graceful degradation.
--
-- THE FIX. Compute on a schedule, serve from public.job_board_meta. Same shape
-- the Explore collections cache already uses here, which took that page from
-- 13s to sub-second.
--
-- The payload carries `as_of`. These are counts of a live, churning table, and
-- a cached number presented as current is the kind of small lie this codebase
-- has had to correct before. A caller that wants to show a facet count can now
-- also say when it was true.

-- ── the refresh, run on a schedule ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_job_board_facets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- Generous, because this runs on a timer and nobody is waiting on it. The
-- whole point is to move the cost off the request path.
SET statement_timeout = '10min'
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM job_board_postings),
    'companiesFacet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token', company_token, 'name', company, 'count', n) ORDER BY company)
      FROM (
        SELECT company_token, max(company) AS company, count(*) AS n
        FROM job_board_postings
        GROUP BY company_token
      ) c(company_token, company, n)
    ), '[]'::jsonb),
    'categoriesFacet', COALESCE((
      SELECT jsonb_object_agg(category, n)
      FROM (
        SELECT category, count(*) AS n FROM job_board_postings GROUP BY category
      ) k(category, n)
    ), '{}'::jsonb),
    'as_of', now()
  ) INTO v;

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('facets', v, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  -- Returns the FULL payload, not a summary. The refresh pass uses
  -- companiesFacet to drive an orphan prune that DELETES postings, and a
  -- destructive path must never read a cache. It calls this function — which
  -- has just computed the list — while page views read the cached row.
  --
  -- Serving cache to the prune would probably have been fine (a stale company
  -- list makes it delete less, not more), but "probably fine on my analysis" is
  -- a bad footing for a DELETE. Separating them removes the need to be right.
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_job_board_facets() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_job_board_facets() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_job_board_facets() TO service_role;

-- ── the read, on the request path ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_job_board_facets()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
-- Small on purpose. Reading one row needs milliseconds; if this ever takes
-- seconds again, something has gone wrong and should fail fast and loudly
-- rather than hold a request open for twenty seconds.
SET statement_timeout = '5s'
AS $$
DECLARE
  cached jsonb;
BEGIN
  SELECT v INTO cached FROM public.job_board_meta WHERE k = 'facets';

  IF cached IS NOT NULL AND cached ? 'total' THEN
    -- `stale` is advisory, not a refusal. A count a few hours old is far more
    -- useful to a filter sidebar than a 500, and the caller can decide whether
    -- to show the age.
    RETURN cached || jsonb_build_object(
      'cached', true,
      'stale', (SELECT updated_at < now() - interval '6 hours'
                FROM public.job_board_meta WHERE k = 'facets')
    );
  END IF;

  -- COLD CACHE ONLY. Returns a usable, honest empty shape rather than
  -- attempting the three full scans that caused the outage — the scheduled
  -- refresh fills this within the quarter-hour. Callers already treat a missing
  -- `total` as "no facet data", which is true here.
  RETURN jsonb_build_object(
    'total', NULL, 'companiesFacet', '[]'::jsonb, 'categoriesFacet', '{}'::jsonb,
    'cached', false, 'stale', true, 'as_of', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_job_board_facets() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_job_board_facets() IS
  'Serves cached board facets from job_board_meta. Carries as_of/cached/stale '
  'so a caller can say when the counts were true. Never aggregates on the '
  'request path — doing so over 584k rows is what caused the 57014 outage.';

-- ── keep it warm ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent — refresh_job_board_facets must be called by the refresh job instead';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-board-facets') THEN
    PERFORM cron.unschedule('refresh-board-facets');
  END IF;
  -- Every 15 minutes. The board changes by roughly a thousand rows a day, so
  -- this is far finer than the data actually moves; it is cheap because it is
  -- off the request path entirely.
  PERFORM cron.schedule('refresh-board-facets', '7,22,37,52 * * * *',
    $cron$ SELECT public.refresh_job_board_facets(); $cron$);
END;
$$;

-- Fill it once now, so the first visitor after this migration gets real counts
-- rather than the cold-cache shape.
SELECT public.refresh_job_board_facets();