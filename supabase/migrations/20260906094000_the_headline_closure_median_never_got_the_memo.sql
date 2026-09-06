-- THE MOST WIDELY PUBLISHED CLOSURE NUMBER WAS THE ONE SURFACE THAT COUNTED
-- OUR OWN OUTAGES AS FILLS.
--
-- 20260906093000 re-issued five read functions so that relists and suspect
-- batches stop being counted as employer takedowns, and 20260906091000 and
-- 20260906092000 built the two curve RPCs on the same rule. refresh_ghost_stats
-- was not among them, and it writes the `ghost_stats` cache row behind
-- /v1/stats and the /ghost-job-index headline: public-api serves its
-- median_days_to_close as lifecycle.medianDaysToClose, and the page renders
-- closed_90d beside it.
--
-- Its two closure figures had NEITHER a superseded test NOR a suspect test. So
-- a dark feed logging 400 removals in one second at about a day since posting
-- was excluded from get_company_hiring_health, get_actively_hiring_companies,
-- get_category_fill_speed, get_employer_benchmarks and both curves, and counted
-- in full by the one number the most people see. Two published figures over the
-- same table, disagreeing by construction, with no column anywhere saying why.
-- That is the claim-drift failure this repository has had before: copy and code
-- go out of step the moment the thing being described moves and one of its
-- readers is missed.
--
-- WHAT CHANGES FOR THE READER, STATED RATHER THAN DISCOVERED IN TRIAGE.
-- closed_90d gets SMALLER on two counts -- relists and dark batches leave it --
-- and its meaning tightens from "closure rows written" to "roles an employer
-- took down", which is what every other surface has meant by it since
-- 20260906093000 and what the page's own copy already claims. It also gets
-- larger by the fast fills the seven-day floor used to delete, though that floor
-- never applied here. median_days_to_close moves UP, because a dark batch's rows
-- sit at roughly one day since posting and were dragging it down.
--
-- WHAT DOES NOT CHANGE. observed_days still counts every closure row, because
-- it measures how long WE have been watching, not what employers did; filtering
-- it would shorten our own tracking history on the strength of a bad feed.
--
-- THE BODY IS THE 20260812220000 BODY VERBATIM apart from those two subqueries.
-- That file recorded, at length, that an earlier attempt to "re-assert the
-- latest body" picked up an older all-or-nothing version because the search
-- sorted by file mtime, which git checkouts scramble. The per-piece handlers and
-- their QUERY_CANCELED arms are reproduced here exactly, character for
-- character, and nothing else in the function is touched.
--
-- Same signature, so CREATE OR REPLACE is sufficient and no grant is disturbed.
-- The REVOKE is re-issued to keep the closed posture explicit rather than
-- inherited: this is a writer, not a public read.

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
  --   * total_company_names groups on the RAW company string, the same key
  --     get_size_segments uses, so the headline and the segments page cannot
  --     disagree about what one employer is.
  BEGIN
    SET LOCAL statement_timeout = '8min';
    SELECT
      count(*) FILTER (WHERE missing_since IS NULL),
      count(posted_at) FILTER (WHERE missing_since IS NULL),
      count(DISTINCT company_token) FILTER (WHERE missing_since IS NULL),
      count(DISTINCT company) FILTER (WHERE missing_since IS NULL AND company <> '')
    INTO open_n, dated_n, tokens_n, names_n
    FROM public.job_board_postings;

    payload := jsonb_build_object(
      'total_open',          open_n,
      'total_companies',     tokens_n,
      'total_company_names', names_n,
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
      'posted_coverage_pct', prev -> 'posted_coverage_pct');
    WHEN OTHERS THEN
    stale := stale || 'counts'::text;
    payload := jsonb_build_object(
      'total_open',          prev -> 'total_open',
      'total_companies',     prev -> 'total_companies',
      'total_company_names', prev -> 'total_company_names',
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
      WHERE missing_since IS NULL AND posted_at IS NOT NULL));
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
                        AND NOT COALESCE(suspect, false)),
      'observed_days', (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
                          FROM public.job_board_closures),
      'median_days_to_close', (
        SELECT round((percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
        FROM public.job_board_closures
        WHERE closed_at > now() - interval '90 days'
          AND NOT superseded
          AND NOT COALESCE(suspect, false)
          AND posted_at IS NOT NULL
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
REVOKE ALL ON FUNCTION public.refresh_ghost_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ghost_stats() TO service_role;

NOTIFY pgrst, 'reload schema';
