-- THE ENTIRE DEMAND ASSET IS RAW ROWS WITH NO SUMMARY AND NO RETENTION.
--
-- job_board_search_events and job_board_search_clicks have accrued since
-- 2026-08-21 with NO rollup and NO prune of any kind. That is two failures at
-- once, pulling in opposite directions:
--
--   * they grow without bound, and the first person to notice will write the
--     obvious `DELETE FROM ... WHERE at < now() - interval '30 days'` — which
--     is exactly the cron 20260727140000 caught pointed at the closure log,
--     the one asset a competitor cannot reconstruct;
--   * and there is nothing anywhere that survives such a delete. What people
--     searched for, what we showed them and what they clicked is a
--     longitudinal record of labour-market demand. One cleanup migration ends
--     it retroactively.
--
-- THE SHAPE IS COPIED FROM roll_up_and_prune_closures: summarise first, then
-- delete ONLY what is provably summarised. If the rollup fails or skips a
-- period, its raw rows survive to be rolled on the next run. The log is never
-- destroyed ahead of its summary.
--
-- ONE DELIBERATE DIVERGENCE FROM THE CLOSURE VERSION, AND IT FIXES A REAL BUG
-- IN IT. roll_up_and_prune_closures rolls up by MONTH but cuts at an INSTANT
-- (now() - 180 days), which lands mid-month. So a month is rolled from the
-- part of it that has crossed the cutoff, those rows are pruned, and the next
-- run re-rolls the SAME month from only the newly-crossed rows and OVERWRITES
-- the stored counts (ON CONFLICT ... DO UPDATE SET fills = EXCLUDED.fills) —
-- the summary ends up holding the last slice of the month rather than the
-- month. This function rolls at DAY grain and only ever touches days that are
-- entirely in the past, so a period is complete the first time it is
-- summarised and a re-run of an already-pruned day groups zero rows and
-- therefore writes nothing. The closure bug is reported, not fixed here:
-- another workflow is editing job_board_closures this week and replacing that
-- function from this file would silently overwrite their work.

-- ── the search side: one row per day, route and caller ───────────────────
CREATE TABLE IF NOT EXISTS public.job_board_search_rollup (
  day              date    NOT NULL,
  route            text    NOT NULL,
  caller           text    NOT NULL,
  searches         integer NOT NULL DEFAULT 0,
  paged_requests   integer NOT NULL DEFAULT 0,
  zero_results     integer NOT NULL DEFAULT 0,
  rescued          integer NOT NULL DEFAULT 0,
  distinct_queries integer NOT NULL DEFAULT 0,
  clicked_searches integer NOT NULL DEFAULT 0,
  p50_took_ms      integer,
  p90_took_ms      integer,
  rolled_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, route, caller)
);

COMMENT ON TABLE public.job_board_search_rollup IS
  'Immutable daily summary of job_board_search_events, written before the raw '
  'rows are pruned and never after. EVERY event of the day is covered by a row '
  'here — that is what makes the prune safe — but the two kinds are counted '
  'separately: `searches` counts page one (offset_n = 0), which is a distinct '
  'search, and `paged_requests` counts deeper pages, which are the same search '
  'continued. Every other measure on this row describes page-one events only, '
  'and says so.';
COMMENT ON COLUMN public.job_board_search_rollup.searches IS
  'Page-one requests (offset_n = 0) on this day/route/caller: one per distinct '
  'search. The denominator for clicked_searches and zero_results.';
COMMENT ON COLUMN public.job_board_search_rollup.paged_requests IS
  'Requests for a deeper page (offset_n > 0) on this day/route/caller. Counted '
  'so that no raw event is deleted without being summarised somewhere — the '
  'first version of this function rolled page one and pruned everything, which '
  'destroyed roughly a fifth of the log unsummarised. Not a search count: add '
  'it to `searches` for request volume, never for demand.';
COMMENT ON COLUMN public.job_board_search_rollup.day IS
  'OUR observation date (the day the searches happened, UTC). Not an employer '
  'date and not a posting age.';
COMMENT ON COLUMN public.job_board_search_rollup.caller IS
  'The traffic class from job_board_search_events.caller. A NULL there — a row '
  'written before the column existed, or a request that declared no caller and '
  'sent no Origin/Referer — is grouped under ''unknown''. That bucket is '
  'honest about traffic whose contamination by our own monitoring can never be '
  'separated out, and it MUST NOT be read as ''web'' or added to it.';
COMMENT ON COLUMN public.job_board_search_rollup.clicked_searches IS
  'Searches on this day/route/caller that produced at least one click. The '
  'CTR numerator; searches is its denominator. Counted at rollup time while '
  'the raw clicks still exist, so it is exact rather than reconstructed.';
COMMENT ON COLUMN public.job_board_search_rollup.p50_took_ms IS
  'Median server-side latency in milliseconds for this day/route/caller, '
  'computed at rollup time from the raw rows and therefore exact for that '
  'day. Our clock, measured inside the edge function; it excludes network.';
COMMENT ON COLUMN public.job_board_search_rollup.p90_took_ms IS
  'As p50_took_ms, at the 90th percentile.';

-- ── the click side: one row per day and employer ─────────────────────────
CREATE TABLE IF NOT EXISTS public.job_board_click_rollup (
  day                   date    NOT NULL,
  company_token         text    NOT NULL,
  category              text    NOT NULL,
  clicks                integer NOT NULL DEFAULT 0,
  apply_clicks          integer NOT NULL DEFAULT 0,
  salary_present_clicks integer NOT NULL DEFAULT 0,
  salary_known_clicks   integer NOT NULL DEFAULT 0,
  p50_position          numeric,
  rolled_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, company_token, category)
);

COMMENT ON TABLE public.job_board_click_rollup IS
  'Immutable daily summary of job_board_search_clicks by employer board, '
  'written before the raw rows are pruned. This is the employer-level demand '
  'series; it survives the raw retention and the deletion of the postings '
  'themselves.';
COMMENT ON COLUMN public.job_board_click_rollup.day IS
  'OUR observation date (the day the clicks arrived, UTC).';
COMMENT ON COLUMN public.job_board_click_rollup.company_token IS
  'The BOARD, not the employer — one employer may hold several tokens. Clicks '
  'whose posting could not be resolved at insert time are grouped under '
  '''(unknown)'' rather than dropped.';
COMMENT ON COLUMN public.job_board_click_rollup.salary_present_clicks IS
  'Clicks on postings that DISCLOSED pay. Its denominator is '
  'salary_known_clicks, not clicks: a click whose posting could not be looked '
  'up has salary_present NULL and belongs in neither.';
COMMENT ON COLUMN public.job_board_click_rollup.salary_known_clicks IS
  'Clicks where disclosure was determinable at all (salary_present IS NOT '
  'NULL). The honest denominator for the disclosure ratio.';
COMMENT ON COLUMN public.job_board_click_rollup.p50_position IS
  'Median 1-based ABSOLUTE rank of the clicked result (offset + index + 1), '
  'computed at rollup time. Reading demand without it re-introduces the '
  'confound this whole wave exists to remove: a board clicked often may be '
  'wanted, or may simply have been ranked high.';

CREATE INDEX IF NOT EXISTS job_board_search_rollup_day_idx
  ON public.job_board_search_rollup (day DESC);
CREATE INDEX IF NOT EXISTS job_board_click_rollup_day_idx
  ON public.job_board_click_rollup (day DESC);

ALTER TABLE public.job_board_search_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_board_click_rollup  ENABLE ROW LEVEL SECURITY;
-- No policy, no anon grant. These are aggregates of visitor behaviour, and the
-- raw tables they summarise are locked for the same reason.
GRANT ALL ON public.job_board_search_rollup TO service_role;
GRANT ALL ON public.job_board_click_rollup  TO service_role;

-- ── summarise, then prune only what is provably summarised ───────────────
CREATE OR REPLACE FUNCTION public.roll_up_and_prune_search_demand(p_keep_days integer DEFAULT 180)
RETURNS TABLE (rows_rolled integer, events_pruned integer, clicks_pruned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  -- A WHOLE DAY, not an instant: every day strictly before this is complete,
  -- so a period is never summarised from a partial slice of itself. That is
  -- the property the closure rollup lacks.
  v_cutoff_day date := (now() AT TIME ZONE 'UTC')::date - GREATEST(p_keep_days, 30);
  -- The same boundary as a timestamptz, so every scan below can use the
  -- existing (at DESC) indexes instead of seq-scanning to evaluate a cast.
  v_cutoff_ts timestamptz := v_cutoff_day::timestamp AT TIME ZONE 'UTC';
  v_rows integer := 0;
  v_ev   integer := 0;
  v_cl   integer := 0;
BEGIN
  -- 1. the search side. Percentiles are exact here: the raw rows still exist.
  --
  -- EVERY EVENT OF THE DAY IS ROLLED, not only page one. Step 3 deletes on the
  -- strength of a rollup row existing for the day, so anything excluded here
  -- would be deleted having been summarised nowhere — which is precisely the
  -- invariant this function was copied from roll_up_and_prune_closures to
  -- keep. Deep pages are separated by FILTER instead, so `searches` still
  -- means distinct searches and no row is destroyed uncounted. (The excluded
  -- shape also never got pruned in the other direction: a day whose events
  -- were all deep pages produced no rollup row and so accumulated forever.)
  WITH ev AS (
    SELECT e.search_id,
           (e.at AT TIME ZONE 'UTC')::date AS d,
           e.route,
           COALESCE(e.caller, 'unknown') AS caller,
           e.results,
           e.rescued,
           e.took_ms,
           e.q,
           (e.offset_n = 0) AS page_one
    FROM public.job_board_search_events e
    WHERE e.at < v_cutoff_ts
  ),
  cl AS (
    -- Bounded by the same clock so this is an index range and not a full scan
    -- of the click table. One day of slack: a click can land just after the
    -- midnight the search it belongs to fell on.
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

  -- 2. the click side.
  INSERT INTO public.job_board_click_rollup AS r
    (day, company_token, category, clicks, apply_clicks,
     salary_present_clicks, salary_known_clicks, p50_position, rolled_at)
  SELECT (c.at AT TIME ZONE 'UTC')::date,
         COALESCE(NULLIF(c.company_token, ''), '(unknown)'),
         COALESCE(NULLIF(c.category, ''), 'other'),
         count(*)::int,
         count(*) FILTER (WHERE c.kind = 'apply')::int,
         count(*) FILTER (WHERE c.salary_present)::int,
         count(*) FILTER (WHERE c.salary_present IS NOT NULL)::int,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c.position)::numeric, 1),
         now()
  FROM public.job_board_search_clicks c
  WHERE c.at < v_cutoff_ts
  GROUP BY 1, 2, 3
  ON CONFLICT (day, company_token, category) DO UPDATE SET
    clicks                = EXCLUDED.clicks,
    apply_clicks          = EXCLUDED.apply_clicks,
    salary_present_clicks = EXCLUDED.salary_present_clicks,
    salary_known_clicks   = EXCLUDED.salary_known_clicks,
    p50_position          = EXCLUDED.p50_position,
    rolled_at             = now();

  -- 3. PRUNE ONLY A DAY THAT IS PROVABLY SUMMARISED. The EXISTS below is an
  -- honest proof only because step 1 rolls every event of the day rather than
  -- a subset of it — if it ever goes back to filtering, this clause must grow
  -- the same filter or it deletes rows no summary covers. If step 1 or 2
  -- failed or skipped a day, that day's raw rows survive to the next run.
  -- Because the
  -- cutoff is a whole date, a day is summarised in full the first time it is
  -- touched, and a re-run over an already-pruned day groups zero rows and so
  -- writes nothing — the summary cannot be overwritten with a remainder.
  DELETE FROM public.job_board_search_clicks c
  WHERE c.at < v_cutoff_ts
    AND EXISTS (
      SELECT 1 FROM public.job_board_click_rollup rr
      WHERE rr.day = (c.at AT TIME ZONE 'UTC')::date
    );
  GET DIAGNOSTICS v_cl = ROW_COUNT;

  DELETE FROM public.job_board_search_events e
  WHERE e.at < v_cutoff_ts
    AND EXISTS (
      SELECT 1 FROM public.job_board_search_rollup rr
      WHERE rr.day = (e.at AT TIME ZONE 'UTC')::date
    );
  GET DIAGNOSTICS v_ev = ROW_COUNT;

  RETURN QUERY SELECT v_rows, v_ev, v_cl;
END;
$$;

REVOKE ALL ON FUNCTION public.roll_up_and_prune_search_demand(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_search_demand(integer) TO service_role;

-- Nightly, in the same 03:xx band as the closure rollup and away from the
-- 02:30-02:55 snapshot block.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'search-demand-rollup-retention', '37 3 * * *',
      $job$ SELECT public.roll_up_and_prune_search_demand(180); $job$);
  END IF;
END $$;
