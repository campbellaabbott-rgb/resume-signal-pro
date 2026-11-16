-- SUB-HOURLY CRON REVIEW MARKER: not required. This file creates or changes no
-- cron schedule (reviewed 2026-11-16 by the project owner).
--
-- TWO JOBS PAGE AGGREGATES ANSWER FROM A ROW, ONCE ITS WRITER IS SCHEDULED.
--
-- Cost audit 2026-11-08, "Live aggregates on /jobs". Every render of /jobs
-- by a person calls two aggregate RPCs over the whole board:
--   get_country_facet()      count of open postings per country (the picker)
--   get_salary_benchmarks()  per-category median salary floor, 30 days
-- Both group the serving set on every call under a 20-second budget and are
-- the page's 57014 path.
--
-- WHAT THIS FILE DOES. One writer, refresh_jobs_live_aggregates(), runs the
-- two functions and stores their answers, in their own order, in ONE row:
-- job_board_stats_rollup k = 'jobs_live_aggregates' {country_facet,
-- salary_benchmarks, as_of}. Each reader answers from that row while it is
-- younger than two hours, and otherwise runs exactly what it ran before.
--
-- WHAT IT DOES NOT DO (review of 2026-11-15):
--   * IT SCHEDULES NO WRITER. A writer run costs about what one call of each
--     reader costs, so an hourly writer saves work only while each reader is
--     called more than 24 times a day, and nobody has read that figure: the
--     audit made it this item's precondition, /jobs now skips both reads for
--     a scraper, and the referred traffic measured in 2026-09 was tens of
--     visits a month. Until the owner reads the calls for both functions in
--     pg_stat_statements and schedules the writer (the NOTICE below prints
--     the command, at a minute no pinned job uses), the row never exists and
--     every call counts live, as today: this file changes nothing a reader
--     sees and costs one primary-key probe a call.
--   * get_takedowns_today() is NOT re-issued. It is an indexed count of one
--     day of the closure log, cheap, and the Data API promises a feed walk
--     can come out lower than it, never higher, which a figure up to two
--     hours old would break.
--
-- WHAT IS KEPT EXACTLY:
--   * signatures, return types, LANGUAGE sql STABLE SECURITY DEFINER,
--     search_path, each function's own statement_timeout, and the grants
--     (client-callable, as the allowlist records);
--   * every predicate. The live arm of each function IS the previous body --
--     the country facet's `missing_since IS NULL` with no 30-day window, the
--     benchmarks' 30-day window and n >= 30 -- and the writer fills the row
--     by calling the two functions themselves (with the cached arm switched
--     off for its own transaction), so the row cannot drift from the live
--     answer's definition;
--   * the order rows come back in.
-- WHAT CHANGES ONCE THE WRITER RUNS: a cached answer is up to an hour old
-- (two if a run fails).
--
-- THE CACHED ARM ONLY. When the row is fresh, the live arm is gated by a
-- one-time filter and its scan is never executed (the test for this file
-- reads EXPLAIN ANALYZE); when the row is missing, stale or malformed, the
-- function is the old one, so this file applies in any order relative to the
-- frontend.
--
-- A cron command for the writer must set its own statement_timeout, equal
-- to the writer's header: a function's SET never extends a pg_cron run
-- (20261003220000). The printed command does.
--
-- Re-runnable (CREATE OR REPLACE; a job the owner scheduled is left as it
-- is). Self-verifying below.

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
  '(written by refresh_jobs_live_aggregates once the owner schedules it) when that row is under two '
  'hours old, else counts live exactly as before 20261109170000.';

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

-- ── 3. the writer ───────────────────────────────────────────────────────────
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
  -- The two readers answer live for the rest of this transaction: the row
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
  'Writer of job_board_stats_rollup k = ''jobs_live_aggregates'': the answers of get_country_facet() '
  'and get_salary_benchmarks(), in their order, computed by those functions with their cached arm '
  'switched off for this transaction. NOT SCHEDULED by 20261109170000: the owner schedules it once '
  'pg_stat_statements shows each reader called more than 24 times a day. All or nothing: if it '
  'raises, the previous row stands and the readers count live once it is two hours old. '
  'service_role and the scheduler only.';

REVOKE ALL ON FUNCTION public.refresh_jobs_live_aggregates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_jobs_live_aggregates() TO service_role;

-- ── 4. no schedule: the command, for the owner ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; refresh_jobs_live_aggregates() is not scheduled and the readers stay live';
    RETURN;
  END IF;
  RAISE NOTICE 'refresh_jobs_live_aggregates() is not scheduled, so get_country_facet() and get_salary_benchmarks() count live as before. Once pg_stat_statements shows each called more than 24 times a day, schedule it with: SELECT cron.schedule(''refresh-jobs-live-aggregates'', ''52 * * * *'', $c$SET statement_timeout = ''3min''; SELECT public.refresh_jobs_live_aggregates();$c$);';
END $$;

-- ── 5. the end state, read back from the catalogue ─────────────────────────
DO $verify$
DECLARE
  r record;
  w oid := to_regprocedure('public.refresh_jobs_live_aggregates()');
BEGIN
  FOR r IN
    SELECT x.sig, x.timeout, p.oid AS f, p.prosrc, p.proconfig, p.prosecdef, p.prolang
      FROM (VALUES ('public.get_country_facet()', 'statement_timeout=20s'),
                   ('public.get_salary_benchmarks()', 'statement_timeout=20s')) AS x(sig, timeout)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(x.sig)
  LOOP
    IF r.f IS NULL THEN
      RAISE EXCEPTION '% is missing', r.sig;
    END IF;
    IF NOT r.prosecdef OR NOT (r.timeout = ANY (r.proconfig)) THEN
      RAISE EXCEPTION '% lost SECURITY DEFINER or its % header', r.sig, r.timeout;
    END IF;
    IF position('jobs_live_aggregates' IN r.prosrc) = 0 OR position('rb.live_aggregates' IN r.prosrc) = 0 THEN
      RAISE EXCEPTION '% does not read the cached row', r.sig;
    END IF;
    IF NOT has_function_privilege('anon', r.f, 'EXECUTE') OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION '% lost its client grant (/jobs calls it)', r.sig;
    END IF;
  END LOOP;
  IF w IS NULL OR has_function_privilege('anon', w, 'EXECUTE') OR has_function_privilege('authenticated', w, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh_jobs_live_aggregates is missing or callable by a client role';
  END IF;
  IF position('takedowns_today' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = w)) > 0 THEN
    RAISE EXCEPTION 'refresh_jobs_live_aggregates still caches the takedown count, which stays live';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
