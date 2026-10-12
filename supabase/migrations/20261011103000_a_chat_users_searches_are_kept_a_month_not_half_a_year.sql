-- A CHAT USER'S SEARCHES ARE KEPT A MONTH, NOT HALF A YEAR.
--
-- OWNER DECISION 2026-10-11 (MCP economics decision 6): searches made through
-- the connector from Claude and every other non-ChatGPT surface are kept 30
-- days, without the ids of the postings they were shown; searches made inside
-- ChatGPT are not written at all. job-board .93 does the write side (an event
-- whose caller is 'mcp' keeps q and no `shown`; a list carrying noLog with the
-- reader proof writes nothing). This migration does the retention side, which
-- the Privacy page's draft MCP table states ("kept for 30 days") and which
-- until now was the demand log's general 180 days.
--
-- THE SHAPE IS roll_up_and_prune_search_demand (20260906217000), restricted
-- to one caller: summarise first, at DAY grain over whole past days, then
-- delete ONLY raw rows of that caller whose (day, route, caller) rollup row
-- exists. A day is summarised in full the first time it is touched, a re-run
-- over a pruned day groups nothing and so overwrites nothing, and when the
-- general 180-day run later reaches the same day it finds no rows of this
-- caller and leaves its summary alone. The demand series survives in
-- job_board_search_rollup; only the raw words go.
--
-- ONLY 'mcp'. Any other caller answers (0, 0): the 30 days are the owner's
-- decision for the connector's searches, and a typo must not shorten the
-- site's own log. GREATEST(p_keep_days, 30) is the same floor the general run
-- applies.
--
-- SECURITY DEFINER (it deletes from a table no client may read) and executable
-- by service_role only, revoked from PUBLIC, anon and authenticated by name.
-- Scheduled nightly at 03:47 UTC, after the general run at 03:37, with its own
-- statement_timeout inside the command (a function's SET never extends a
-- pg_cron run: project_field_curve_timeout). Safe to re-run: CREATE OR
-- REPLACE, cron.schedule by name (replaces the job of that name), and a
-- self-check that writes nothing.

CREATE OR REPLACE FUNCTION public.roll_up_and_prune_search_demand_for_caller(p_caller text, p_keep_days integer DEFAULT 30)
RETURNS TABLE (rows_rolled integer, events_pruned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_cutoff_day date := (now() AT TIME ZONE 'UTC')::date - GREATEST(coalesce(p_keep_days, 30), 30);
  v_cutoff_ts timestamptz := v_cutoff_day::timestamp AT TIME ZONE 'UTC';
  v_rows integer := 0;
  v_ev integer := 0;
BEGIN
  IF p_caller IS DISTINCT FROM 'mcp' THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- 1. Summarise every event of this caller on every whole past day before the
  -- cutoff (page one and deeper pages alike, as the general run does, so the
  -- prune below never deletes a row no summary covers).
  WITH ev AS (
    SELECT e.search_id,
           (e.at AT TIME ZONE 'UTC')::date AS d,
           e.route,
           e.caller,
           e.results,
           e.rescued,
           e.took_ms,
           e.q,
           (e.offset_n = 0) AS page_one
    FROM public.job_board_search_events e
    WHERE e.at < v_cutoff_ts
      AND e.caller = p_caller
  ),
  cl AS (
    SELECT DISTINCT c.search_id
    FROM public.job_board_search_clicks c
    WHERE c.search_id IS NOT NULL
      AND c.at < v_cutoff_ts + interval '2 days'
  )
  INSERT INTO public.job_board_search_rollup AS r
    (day, route, caller, searches, paged_requests, zero_results, rescued,
     distinct_queries, clicked_searches, p50_took_ms, p90_took_ms, rolled_at)
  SELECT ev.d,
         ev.route,
         ev.caller,
         count(*) FILTER (WHERE ev.page_one)::int,
         count(*) FILTER (WHERE NOT ev.page_one)::int,
         count(*) FILTER (WHERE ev.page_one AND ev.results = 0)::int,
         count(*) FILTER (WHERE ev.page_one AND ev.rescued IS NOT NULL)::int,
         count(DISTINCT ev.q) FILTER (WHERE ev.page_one AND ev.q <> '')::int,
         count(*) FILTER (WHERE ev.page_one AND cl.search_id IS NOT NULL)::int,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY ev.took_ms)
            FILTER (WHERE ev.page_one))::int,
         (percentile_cont(0.9) WITHIN GROUP (ORDER BY ev.took_ms)
            FILTER (WHERE ev.page_one))::int,
         now()
  FROM ev LEFT JOIN cl ON cl.search_id = ev.search_id
  GROUP BY ev.d, ev.route, ev.caller
  ON CONFLICT (day, route, caller) DO UPDATE SET
    searches         = EXCLUDED.searches,
    paged_requests   = EXCLUDED.paged_requests,
    zero_results     = EXCLUDED.zero_results,
    rescued          = EXCLUDED.rescued,
    distinct_queries = EXCLUDED.distinct_queries,
    clicked_searches = EXCLUDED.clicked_searches,
    p50_took_ms      = EXCLUDED.p50_took_ms,
    p90_took_ms      = EXCLUDED.p90_took_ms,
    rolled_at        = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- 2. Prune only this caller's rows whose own (day, route, caller) summary
  -- exists. A day step 1 skipped keeps its raw rows for the next run.
  DELETE FROM public.job_board_search_events e
  WHERE e.at < v_cutoff_ts
    AND e.caller = p_caller
    AND EXISTS (
      SELECT 1 FROM public.job_board_search_rollup rr
      WHERE rr.day = (e.at AT TIME ZONE 'UTC')::date
        AND rr.route = e.route
        AND rr.caller = p_caller
    );
  GET DIAGNOSTICS v_ev = ROW_COUNT;

  RETURN QUERY SELECT v_rows, v_ev;
END;
$$;

REVOKE ALL ON FUNCTION public.roll_up_and_prune_search_demand_for_caller(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_search_demand_for_caller(text, integer) TO service_role;

COMMENT ON FUNCTION public.roll_up_and_prune_search_demand_for_caller(text, integer) IS
  'Owner decision 2026-10-11: the connector''s searches (caller mcp) are kept 30 days. Rolls every event of the caller on whole past days before the cutoff into job_board_search_rollup, then deletes only that caller''s raw rows whose (day, route, caller) summary exists. Any caller but mcp answers (0, 0). Service role only (20261011103000).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'search-demand-mcp-retention', '47 3 * * *',
      $job$ SET statement_timeout = '5min'; SELECT public.roll_up_and_prune_search_demand_for_caller('mcp', 30); $job$);
  END IF;
END $$;

-- ── self-check: the catalogue, the grants and the job; writes nothing ───────
DO $$
DECLARE
  v_fn oid := to_regprocedure('public.roll_up_and_prune_search_demand_for_caller(text, integer)');
  v_cmd text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '20261011103000: roll_up_and_prune_search_demand_for_caller(text, integer) is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION '20261011103000: the prune must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261011103000: the prune is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261011103000: service_role cannot execute the prune';
  END IF;
  IF to_regclass('public.job_board_search_rollup') IS NULL THEN
    RAISE EXCEPTION '20261011103000: job_board_search_rollup is missing, so nothing could be summarised before a prune';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    EXECUTE 'SELECT command FROM cron.job WHERE jobname = $1' INTO v_cmd USING 'search-demand-mcp-retention';
    IF v_cmd IS NULL THEN
      RAISE EXCEPTION '20261011103000: the search-demand-mcp-retention job is not scheduled';
    END IF;
    IF v_cmd !~ 'statement_timeout' THEN
      RAISE EXCEPTION '20261011103000: the job command does not set its own statement_timeout';
    END IF;
  END IF;
END
$$;
