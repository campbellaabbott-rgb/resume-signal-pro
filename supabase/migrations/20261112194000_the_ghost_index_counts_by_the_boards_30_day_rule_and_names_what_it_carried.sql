-- THE GHOST INDEX COUNTS BY THE BOARD'S 30-DAY RULE AND NAMES WHAT IT CARRIED
-- (S14X-273, S14X-160).
--
-- 1. THE OPEN COUNT WAS TAKEN OVER A WIDER SET THAN THE BOARD SERVES.
--    refresh_ghost_stats (20260909201000) counted every stored row with
--    missing_since IS NULL as open, and took the posting-age median over the
--    same rows, while the board and chip_coverage serve only rows whose
--    effective_posted is within 30 days. On 2026-11-08 the two counts were
--    19,194 roles apart; on 2026-11-15 the gap was small, and its size moves
--    with the stale tail. The four counts and the median now carry the
--    board's window, and the row states it as open_window_days = 30. A part
--    that falls back to the previous row keeps the window that row was taken
--    over (none, for a row written before this file).
--
-- 2. THE READER DROPPED WHAT THE WRITER SAID IT CARRIED. refresh_ghost_stats
--    always wrote stale_parts into the row; get_ghost_job_index_stats
--    (20260808191630, made SECURITY DEFINER by 20260820174500) returned the
--    eight figures and computed_at and dropped it, so neither the page nor
--    the hourly cache (which copies row_to_json of this reader) could say a
--    figure was carried forward. It now returns stale_parts and
--    open_window_days after computed_at; the shape changes, so it is dropped
--    by name and re-created with the header it has live (SECURITY DEFINER,
--    search_path public, five seconds) and its grants restated: all three
--    client grantees revoked by name, EXECUTE given back to anon,
--    authenticated and service_role. Its census entry names the same
--    signature.
--
-- refresh_ghost_stats is otherwise its live text: the same parts, budgets,
-- fallbacks and closure figures, and its grants. Its cron job is not touched
-- (20261109122000 set its schedule and the SET statement_timeout in its
-- command). The next hourly run writes the window; until then the reader
-- answers open_window_days NULL, which the page reads as "not stated". Safe
-- to run twice; the last block reads the end state back and raises.

SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.job_board_stats_rollup (
  k text PRIMARY KEY,
  v jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- 1. the writer.
CREATE OR REPLACE FUNCTION public.refresh_ghost_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15min'
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
  open_n   bigint;
  dated_n  bigint;
  tokens_n bigint;
  names_n  bigint;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_stats_rollup WHERE k = 'ghost_stats';

  -- The four postings counts, in a single sequential pass.
  --
  -- SAME DEFINITIONS AS EVER, and two of them were incidents:
  --   * every count filters missing_since IS NULL — a column headed "open
  --     postings" must mean postings the board will actually serve;
  --   * and, since 20261112194000, the board's own 30-day window on
  --     effective_posted, the rule the board and chip_coverage serve by: a
  --     row past it is stored but never served, so it is not open;
  --   * total_company_names groups on the RAW company string, the same key
  --     get_size_segments uses, so the headline and the segments page cannot
  --     disagree about what one employer is.
  BEGIN
    SET LOCAL statement_timeout = '8min';
    SELECT
      count(*) FILTER (WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days'),
      count(posted_at) FILTER (WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days'),
      count(DISTINCT company_token) FILTER (WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days'),
      count(DISTINCT company) FILTER (WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days' AND company <> '')
    INTO open_n, dated_n, tokens_n, names_n
    FROM public.job_board_postings;

    payload := jsonb_build_object(
      'total_open',          open_n,
      'total_companies',     tokens_n,
      'total_company_names', names_n,
      -- The window the four counts and the age median were taken over.
      'open_window_days',    30,
      -- Kept in the payload because GhostJobIndex gates its coverage caveat on
      -- it; when the column went missing the caveat never rendered once.
      'posted_coverage_pct',
        CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'counts'::text;
    payload := jsonb_build_object(
      'total_open',          prev -> 'total_open',
      'total_companies',     prev -> 'total_companies',
      'total_company_names', prev -> 'total_company_names',
      'open_window_days',    prev -> 'open_window_days',
      'posted_coverage_pct', prev -> 'posted_coverage_pct');
    WHEN OTHERS THEN
    stale := stale || 'counts'::text;
    payload := jsonb_build_object(
      'total_open',          prev -> 'total_open',
      'total_companies',     prev -> 'total_companies',
      'total_company_names', prev -> 'total_company_names',
      'open_window_days',    prev -> 'open_window_days',
      'posted_coverage_pct', prev -> 'posted_coverage_pct');
  END;

  -- Posting-age median. From the EMPLOYER's stated posted_at and never from
  -- first_seen, which is when WE noticed: on 4,179 rows carrying both, the two
  -- bases differ by 17.6 days at the median and the published figure was the
  -- flattering one. Sorts only the dated, still-served subset.
  BEGIN
    SET LOCAL statement_timeout = '5min';
    payload := payload || jsonb_build_object('median_days_open', (
      SELECT round(percentile_cont(0.5) WITHIN GROUP (
               ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0)
             )::numeric, 1)
      FROM public.job_board_postings
      WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days' AND posted_at IS NOT NULL));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'median_days_open'::text;
    payload := payload || jsonb_build_object('median_days_open', prev -> 'median_days_open');
    WHEN OTHERS THEN
    stale := stale || 'median_days_open'::text;
    payload := payload || jsonb_build_object('median_days_open', prev -> 'median_days_open');
  END;

  -- Closure-derived figures. A different, far smaller table.
  BEGIN
    SET LOCAL statement_timeout = '2min';
    payload := payload || jsonb_build_object(
      'closed_90d', (SELECT count(*) FROM public.job_board_closures
                      WHERE closed_at > now() - interval '90 days'
                        AND NOT superseded
                        AND NOT COALESCE(suspect, false)
                        AND absence_basis IS DISTINCT FROM 'lap_backfill'),
      'observed_days', (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
                          FROM public.job_board_closures
                         WHERE absence_basis IS DISTINCT FROM 'lap_backfill'),
      'median_days_to_close', (
        SELECT round((percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
        FROM public.job_board_closures
        WHERE closed_at > now() - interval '90 days'
          AND NOT superseded
          AND NOT COALESCE(suspect, false)
          AND posted_at IS NOT NULL
          AND absence_basis IS DISTINCT FROM 'lap_backfill'
          AND closed_at >= posted_at));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'closures'::text;
    payload := payload || jsonb_build_object(
      'closed_90d',           prev -> 'closed_90d',
      'observed_days',        prev -> 'observed_days',
      'median_days_to_close', prev -> 'median_days_to_close');
    WHEN OTHERS THEN
    stale := stale || 'closures'::text;
    payload := payload || jsonb_build_object(
      'closed_90d',           prev -> 'closed_90d',
      'observed_days',        prev -> 'observed_days',
      'median_days_to_close', prev -> 'median_days_to_close');
  END;

  -- ALWAYS write. A row that says "these three parts are stale" is worth far
  -- more than no row, which is what the previous all-or-nothing version left
  -- behind through two cron ticks and a migration seed.
  payload := payload || jsonb_build_object('stale_parts', to_jsonb(stale));

  INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
  VALUES ('ghost_stats', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
END $$;
COMMENT ON FUNCTION public.refresh_ghost_stats() IS
  'Recomputes the Ghost Job Index payload into job_board_stats_rollup '
  'k = ''ghost_stats'', in parts, each part falling back to its previous '
  'value and naming itself in stale_parts rather than losing the whole row. '
  'get_ghost_job_index_stats() serves what this writes and computes nothing '
  'itself, so the admissibility rule lives here -- the surface it feeds '
  '(/ghost-job-index) cannot state a basis its writer did not apply. DATE '
  'BASIS: median_days_open is the age of still-served postings from the '
  'employer''s stated posted_at alone; median_days_to_close is '
  'closed_at - posted_at on the same basis. '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist. '
  'Both, plus closed_90d and observed_days, exclude it. observed_days is '
  'the one that would have gone backwards: it is the age of the log, and a '
  'backfilled board arriving with today''s closed_at cannot shorten it, '
  'but a future prune that left backfill rows as the OLDEST surviving ones '
  'would have lengthened it with a date nobody may trust. '
  'OPEN WINDOW (20261112194000): total_open, total_companies, '
  'total_company_names, posted_coverage_pct and the median_days_open '
  'population count only rows the board serves -- missing_since IS NULL and '
  'effective_posted within 30 days -- and the row says so in '
  'open_window_days; a part carried forward keeps the window it was taken '
  'over.';
REVOKE ALL ON FUNCTION public.refresh_ghost_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ghost_stats() TO service_role;

-- 2. the reader, with what the writer carried.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'get_ghost_job_index_stats'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

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
  computed_at timestamptz,
  stale_parts text[],
  open_window_days integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
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
         r.computed_at,
         ARRAY(SELECT jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(r.v->'stale_parts') = 'array' THEN r.v->'stale_parts' ELSE '[]'::jsonb END)),
         (r.v->>'open_window_days')::integer
  FROM public.job_board_stats_rollup r
  WHERE r.k = 'ghost_stats' AND (r.v->>'total_open') IS NOT NULL;
$$;
COMMENT ON FUNCTION public.get_ghost_job_index_stats() IS
  'Serves precomputed Ghost Job Index stats from job_board_stats_rollup. The '
  'computation lives in refresh_ghost_stats() -- median_days_open is measured '
  'from the employer stated posted_at and never from first_seen, and every '
  'count filters missing_since IS NULL and the board''s 30-day window '
  '(open_window_days, 20261112194000). Never aggregates on the request path. '
  'stale_parts names the parts the last run carried forward from the run '
  'before (counts, median_days_open, closures); computed_at is when the row '
  'was written, so a carried part is older than it.';
REVOKE ALL ON FUNCTION public.get_ghost_job_index_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ghost_job_index_stats() FROM anon;
REVOKE ALL ON FUNCTION public.get_ghost_job_index_stats() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated, service_role;

-- 3. the end state, read back.
DO $verify$
DECLARE
  src  text;
  cols text;
BEGIN
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = to_regprocedure('public.refresh_ghost_stats()');
  IF src IS NULL THEN
    RAISE EXCEPTION 'refresh_ghost_stats() is missing';
  END IF;
  IF (length(src) - length(replace(src, 'effective_posted >= now() - interval ''30 days''', '')))
       / length('effective_posted >= now() - interval ''30 days''') <> 5 THEN
    RAISE EXCEPTION 'refresh_ghost_stats: the four counts and the age median are not all on the board''s 30-day window';
  END IF;
  IF position('''open_window_days'',    30' IN src) = 0 THEN
    RAISE EXCEPTION 'refresh_ghost_stats: the row does not state the window it was counted over';
  END IF;
  IF position('VALUES (''ghost_stats'', payload, now())' IN src) = 0
     OR position('''stale_parts'', to_jsonb(stale)' IN src) = 0 THEN
    RAISE EXCEPTION 'refresh_ghost_stats: no longer writes the row the reader serves, or no longer names what it carried';
  END IF;
  IF has_function_privilege('anon', 'public.refresh_ghost_stats()', 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh_ghost_stats: anon can run the recomputation';
  END IF;

  SELECT pg_get_function_result(p.oid) INTO cols FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.get_ghost_job_index_stats()');
  IF cols IS NULL OR cols NOT LIKE '%posted_coverage_pct numeric, computed_at timestamp with time zone, stale_parts text[], open_window_days integer)' THEN
    RAISE EXCEPTION 'get_ghost_job_index_stats: does not return stale_parts and open_window_days after its earlier columns: %', cols;
  END IF;
  IF NOT (SELECT p.prosecdef AND 'search_path=public' = ANY (p.proconfig)
            FROM pg_proc p WHERE p.oid = 'public.get_ghost_job_index_stats()'::regprocedure) THEN
    RAISE EXCEPTION 'get_ghost_job_index_stats: not SECURITY DEFINER with a pinned search_path, so anon reads nothing';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_ghost_job_index_stats()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_ghost_job_index_stats()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_ghost_job_index_stats: the page''s roles cannot execute it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = 'public.get_ghost_job_index_stats()'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'get_ghost_job_index_stats: granted to PUBLIC';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
