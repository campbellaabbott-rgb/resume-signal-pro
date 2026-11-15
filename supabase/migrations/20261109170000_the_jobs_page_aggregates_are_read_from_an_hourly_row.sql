-- THE JOBS PAGE AGGREGATES ARE READ FROM AN HOURLY ROW.
--
-- Cost audit 2026-11-08, "Live aggregates on /jobs". Every render of /jobs --
-- a visitor's, or a crawler's -- calls three aggregate RPCs over the whole
-- board:
--   get_country_facet()      count of open postings per country (the picker)
--   get_salary_benchmarks()  per-category median salary floor, 30 days
--   get_takedowns_today()    admitted closures in the last 24 hours
-- The first two group the serving set on every call under a 20-second budget
-- and are the page's 57014 path; the third counts a day of the closure log.
--
-- THE FIX. One writer, refresh_jobs_live_aggregates(), runs the three
-- functions hourly at :14 (clear of every heavy job: :05/:35 ghost stats,
-- :07 explore, :07/:22/:37/:52 facets, :09/:39 closure population, :12 and
-- :27 stats, :37 transparency, the :x2/:x7 ladder) and stores their answers,
-- in their own order, in ONE row: job_board_stats_rollup k =
-- 'jobs_live_aggregates' {country_facet, salary_benchmarks, takedowns_today,
-- as_of}. Each RPC now answers from that row when it is younger than two
-- hours, and otherwise runs exactly what it ran before.
--
-- WHAT IS KEPT EXACTLY:
--   * signatures, return types, LANGUAGE sql STABLE SECURITY DEFINER,
--     search_path, each function's own statement_timeout, and the grants
--     (client-callable, as the allowlist records);
--   * every predicate. The live arm of each function IS the previous body --
--     the country facet's `missing_since IS NULL` with no 30-day window, the
--     benchmarks' 30-day window and n >= 30, the takedown counter's 24 hours,
--     superseded, suspect and lap_backfill rules -- and the writer fills the
--     row by calling the three functions themselves (with the cached arm
--     switched off for its own transaction), so the row cannot drift from
--     the live answer's definition;
--   * the order rows come back in.
-- WHAT CHANGES: a cached answer is up to an hour old (two if a run fails).
-- The takedown figure is then "the last 24 hours" as of the hour's run.
--
-- THE CACHED ARM ONLY. When the row is fresh, the live arm is gated by a
-- one-time filter and its scan is never executed (the test for this file
-- reads EXPLAIN ANALYZE); when the row is missing, stale or malformed, the
-- function is the old one. Until the first :14 run every call is live, as
-- today, so this file applies in any order relative to the frontend.
--
-- The cron command sets its own statement_timeout, equal to the writer's
-- header: a function's SET never extends a pg_cron run (20261003220000).
--
-- Re-runnable (CREATE OR REPLACE, a guarded schedule). Self-verifying below.

-- ── 1. the country facet ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_country_facet()
RETURNS TABLE (country text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH cached AS MATERIALIZED (
    SELECT r.v -> 'country_facet' AS a
      FROM public.job_board_stats_rollup r
     WHERE r.k = 'jobs_live_aggregates'
       AND r.computed_at > now() - interval '2 hours'
       AND jsonb_typeof(r.v -> 'country_facet') = 'array'
       AND current_setting('rb.live_aggregates', true) IS DISTINCT FROM 'compute'
  ),
  live AS (
    SELECT country, count(*) AS n
    FROM public.job_board_postings
    WHERE country IS NOT NULL
      AND country <> ''
      AND missing_since IS NULL
    GROUP BY country
    HAVING count(*) >= 10
    ORDER BY count(*) DESC
    LIMIT 40
  )
  SELECT u.country, u.n
  FROM (
    SELECT e.j ->> 'country' AS country, (e.j ->> 'n')::bigint AS n, e.ord
      FROM cached c, jsonb_array_elements(c.a) WITH ORDINALITY AS e(j, ord)
    UNION ALL
    SELECT l.country, l.n, row_number() OVER (ORDER BY l.n DESC) AS ord
      FROM live l
     WHERE NOT EXISTS (SELECT 1 FROM cached)
  ) u
  ORDER BY u.ord;
$$;

COMMENT ON FUNCTION public.get_country_facet() IS
  'Open postings per country (missing_since IS NULL, no posting-age window), countries with at '
  'least 10, top 40 by count. Answers from job_board_stats_rollup k = ''jobs_live_aggregates'' '
  '(written hourly at :14 by refresh_jobs_live_aggregates) when that row is under two hours old, '
  'else counts live exactly as before 20261109170000.';

REVOKE ALL ON FUNCTION public.get_country_facet() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_country_facet() TO anon, authenticated, service_role;

-- ── 2. the salary benchmarks ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_salary_benchmarks()
RETURNS TABLE (category text, currency text, n integer, median_annual_min numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH cached AS MATERIALIZED (
    SELECT r.v -> 'salary_benchmarks' AS a
      FROM public.job_board_stats_rollup r
     WHERE r.k = 'jobs_live_aggregates'
       AND r.computed_at > now() - interval '2 hours'
       AND jsonb_typeof(r.v -> 'salary_benchmarks') = 'array'
       AND current_setting('rb.live_aggregates', true) IS DISTINCT FROM 'compute'
  ),
  per AS (
    SELECT category,
           salary_currency AS currency,
           count(*)::int AS n,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_annual_min
    FROM public.job_board_postings
    WHERE salary_min_annual IS NOT NULL AND salary_currency IS NOT NULL
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY category, salary_currency
    HAVING count(*) >= 30
  ),
  live AS (
    SELECT DISTINCT ON (category) category, currency, n, median_annual_min
    FROM per
    ORDER BY category, n DESC
  )
  SELECT u.category, u.currency, u.n, u.median_annual_min
  FROM (
    SELECT e.j ->> 'category' AS category, e.j ->> 'currency' AS currency,
           (e.j ->> 'n')::integer AS n, (e.j ->> 'median_annual_min')::numeric AS median_annual_min, e.ord
      FROM cached c, jsonb_array_elements(c.a) WITH ORDINALITY AS e(j, ord)
    UNION ALL
    SELECT l.category, l.currency, l.n, l.median_annual_min,
           row_number() OVER (ORDER BY l.category, l.n DESC) AS ord
      FROM live l
     WHERE NOT EXISTS (SELECT 1 FROM cached)
  ) u
  ORDER BY u.ord;
$$;

COMMENT ON FUNCTION public.get_salary_benchmarks() IS
  'Per category, the currency with the most served postings stating a salary in the last 30 days '
  '(n >= 30) and its median annual floor. SECURITY DEFINER since 20260827130000. Answers from '
  'job_board_stats_rollup k = ''jobs_live_aggregates'' when that row is under two hours old, else '
  'computes live exactly as before 20261109170000.';

REVOKE ALL ON FUNCTION public.get_salary_benchmarks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_salary_benchmarks() TO anon, authenticated, service_role;

-- ── 3. the takedown ticker ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_takedowns_today()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  SELECT COALESCE(
    (SELECT (r.v ->> 'takedowns_today')::int
       FROM public.job_board_stats_rollup r
      WHERE r.k = 'jobs_live_aggregates'
        AND r.computed_at > now() - interval '2 hours'
        AND jsonb_typeof(r.v -> 'takedowns_today') = 'number'
        AND current_setting('rb.live_aggregates', true) IS DISTINCT FROM 'compute'),
    (SELECT count(*)::int FROM public.job_board_closures
  WHERE closed_at > now() - interval '24 hours' AND NOT superseded
    AND NOT COALESCE(suspect, false)
    AND absence_basis IS DISTINCT FROM 'lap_backfill'));
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
  '20261002113617. /v1/changes leaves the same batches out by default since '
  'API version 2026-10-08.1 (include_suspect=true returns them marked '
  'suspectBatch), so a default walk of the feed, with re-listed and '
  'closedAtIsObservation rows dropped, counts on the same rules as this '
  'figure, except that this figure also counts the sources /v1 may not '
  'redistribute: the feed can count lower by those, never higher. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'AS OF 20261109170000 it answers from job_board_stats_rollup k = '
  '''jobs_live_aggregates'' when that row is under two hours old: the count '
  'of the 24 hours before that row''s hourly run (computed_at), on these '
  'same rules; otherwise it counts live.';

REVOKE ALL ON FUNCTION public.get_takedowns_today() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_takedowns_today() TO anon, authenticated, service_role;

-- ── 4. the writer ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_jobs_live_aggregates()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '3min'
AS $$
DECLARE
  v    jsonb;
  v_at timestamptz := now();
BEGIN
  -- The three readers answer live for the rest of this transaction: the row
  -- is filled by their own bodies, never by a copy of them.
  PERFORM set_config('rb.live_aggregates', 'compute', true);
  SELECT jsonb_build_object(
    'country_facet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('country', f.country, 'n', f.n) ORDER BY f.ord)
        FROM public.get_country_facet() WITH ORDINALITY AS f(country, n, ord)), '[]'::jsonb),
    'salary_benchmarks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category', s.category, 'currency', s.currency,
                                          'n', s.n, 'median_annual_min', s.median_annual_min) ORDER BY s.ord)
        FROM public.get_salary_benchmarks() WITH ORDINALITY AS s(category, currency, n, median_annual_min, ord)), '[]'::jsonb),
    'takedowns_today', public.get_takedowns_today(),
    'as_of', v_at)
  INTO v;
  PERFORM set_config('rb.live_aggregates', '', true);

  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  VALUES ('jobs_live_aggregates', v, v_at)
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.refresh_jobs_live_aggregates() IS
  'Hourly (:14) writer of job_board_stats_rollup k = ''jobs_live_aggregates'': the answers of '
  'get_country_facet(), get_salary_benchmarks() and get_takedowns_today(), in their order, computed '
  'by those functions with their cached arm switched off for this transaction. All or nothing: if '
  'it raises, the previous row stands and the readers count live once it is two hours old. '
  'service_role and the scheduler only.';

REVOKE ALL ON FUNCTION public.refresh_jobs_live_aggregates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_jobs_live_aggregates() TO service_role;

-- ── 5. the schedule ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; refresh_jobs_live_aggregates() is not scheduled and the readers stay live';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'refresh-jobs-live-aggregates', '14 * * * *',
    $job$SET statement_timeout = '3min'; SELECT public.refresh_jobs_live_aggregates();$job$);
END $$;

-- ── 6. the end state, read back from the catalogue ─────────────────────────
DO $verify$
DECLARE
  r record;
  w oid := to_regprocedure('public.refresh_jobs_live_aggregates()');
BEGIN
  FOR r IN
    SELECT x.sig, x.timeout, p.oid AS f, p.prosrc, p.proconfig, p.prosecdef, p.prolang
      FROM (VALUES ('public.get_country_facet()', 'statement_timeout=20s'),
                   ('public.get_salary_benchmarks()', 'statement_timeout=20s'),
                   ('public.get_takedowns_today()', 'statement_timeout=10s')) AS x(sig, timeout)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(x.sig)
  LOOP
    IF r.f IS NULL THEN
      RAISE EXCEPTION '% is missing', r.sig;
    END IF;
    IF NOT r.prosecdef OR NOT (r.timeout = ANY (r.proconfig)) THEN
      RAISE EXCEPTION '% lost SECURITY DEFINER or its % header', r.sig, r.timeout;
    END IF;
    IF position('jobs_live_aggregates' IN r.prosrc) = 0 OR position('rb.live_aggregates' IN r.prosrc) = 0 THEN
      RAISE EXCEPTION '% does not read the hourly row', r.sig;
    END IF;
    IF NOT has_function_privilege('anon', r.f, 'EXECUTE') OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION '% lost its client grant (/jobs calls it)', r.sig;
    END IF;
  END LOOP;
  IF w IS NULL OR has_function_privilege('anon', w, 'EXECUTE') OR has_function_privilege('authenticated', w, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh_jobs_live_aggregates is missing or callable by a client role';
  END IF;
  -- Nested: a condition naming cron.job is planned whole, so it cannot sit
  -- beside the test for the schema that holds it.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (
         SELECT 1 FROM cron.job WHERE jobname = 'refresh-jobs-live-aggregates' AND schedule = '14 * * * *' AND active
            AND position('SET statement_timeout = ''3min'';' IN command) = 1) THEN
      RAISE EXCEPTION 'refresh-jobs-live-aggregates is not scheduled at :14 with its own three-minute timeout';
    END IF;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
