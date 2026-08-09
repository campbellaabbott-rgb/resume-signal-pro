-- THE ROLLUP NEVER FILLED, AND THE CACHE PUBLISHED THE HOLE AS HEALTHY.
--
-- Measured 2026-08-09, after 20260808190000 deployed:
--
--   get_ghost_job_index_stats   200 in 0.18s   (was 57014 at 60s — that worked)
--   job_board_stats_rollup      ghost_stats ABSENT after the :05 and :35 ticks
--   stats_cache                 computed_at 18:12, ghost_stats NULL,
--                               stale_parts []
--
-- Two separate defects, and the second is the one that did visible harm.
--
-- 1. refresh_ghost_stats() does not complete. The in-migration seed failed
--    (swallowed by design) and so did the cron, twice. It inherited the
--    loose-index-scan form from the function it replaced: two recursive CTEs
--    walking ~24k distinct company_token and ~24k distinct company, each step a
--    correlated ORDER BY … LIMIT 1 carrying a missing_since filter. That shape
--    was chosen to avoid sorting 598k rows, and on this table it is almost
--    certainly the slower of the two — ~48,000 index seeks against one
--    sequential pass. refresh_job_board_facets runs GROUP BY company_token over
--    the same table on a 15-minute cron and finishes, which is the evidence
--    that the plain aggregate is affordable and the clever one is not.
--
--    So: ONE PASS, plain aggregates, and split into pieces that fail
--    independently. Same lesson as the cache above it — a slow median must not
--    cost us the counts.
--
-- 2. refresh_stats_cache published ghost_stats: null with stale_parts: [].
--    Zero rows from the RPC is not an exception, so the per-piece handler never
--    fired: it wrote NULL over four hours of perfectly good previous values and
--    declared nothing stale. GhostJobIndex reads the cache first and falls back
--    to the RPC, so the page lost its figures entirely while every health
--    signal stayed green.
--
--    A caught error and an empty answer are different events with the same
--    consequence, and only one of them was being handled. NULL now takes the
--    same path as a raised exception: keep the previous value, name the part.

-- ── 1. the computation, in pieces, one pass each ────────────────────────────
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
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'counts';
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
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'median_days_open';
    payload := payload || jsonb_build_object('median_days_open', prev -> 'median_days_open');
  END;

  -- Closure-derived figures. A different, far smaller table.
  BEGIN
    SET LOCAL statement_timeout = '2min';
    payload := payload || jsonb_build_object(
      'closed_90d', (SELECT count(*) FROM public.job_board_closures
                      WHERE closed_at > now() - interval '90 days'),
      'observed_days', (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
                          FROM public.job_board_closures),
      'median_days_to_close', (
        SELECT round((percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
        FROM public.job_board_closures
        WHERE closed_at > now() - interval '90 days'
          AND posted_at IS NOT NULL
          AND closed_at >= posted_at));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'closures';
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

-- ── 2. an empty answer stops counting as a good one ─────────────────────────
--
-- Identical to 20260807214412 except for the NULL guards. Every scalar piece
-- now checks the value it just computed: a JSON null means the source returned
-- no rows, which is a MISSING measurement, not a measured absence. It takes the
-- same path a raised exception does — previous value kept, part named in
-- stale_parts — so the cache can no longer report itself clean while carrying a
-- hole where the headline statistic should be.
CREATE OR REPLACE FUNCTION public.refresh_stats_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  prev    jsonb := '{}'::jsonb;
  payload jsonb := '{}'::jsonb;
  stale   text[] := '{}';
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'stats_cache';

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('ghost_stats',
      (SELECT row_to_json(x) FROM public.get_ghost_job_index_stats() x LIMIT 1));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'ghost_stats';
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
  END;
  IF (payload -> 'ghost_stats') IS NULL OR jsonb_typeof(payload -> 'ghost_stats') = 'null' THEN
    stale := stale || 'ghost_stats';
    payload := payload || jsonb_build_object('ghost_stats', prev -> 'ghost_stats');
  END IF;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('date_coverage',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_date_coverage() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'date_coverage';
    payload := payload || jsonb_build_object('date_coverage', COALESCE(prev -> 'date_coverage', '[]'::jsonb));
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('entry_stats',
      (SELECT row_to_json(x) FROM public.get_entry_level_stats() x LIMIT 1));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'entry_stats';
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
  END;
  IF (payload -> 'entry_stats') IS NULL OR jsonb_typeof(payload -> 'entry_stats') = 'null' THEN
    stale := stale || 'entry_stats';
    payload := payload || jsonb_build_object('entry_stats', prev -> 'entry_stats');
  END IF;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('entry_companies',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(25) x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'entry_companies';
    payload := payload || jsonb_build_object('entry_companies', COALESCE(prev -> 'entry_companies', '[]'::jsonb));
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('hiring_trends',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_hiring_trends() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'hiring_trends';
    payload := payload || jsonb_build_object('hiring_trends', COALESCE(prev -> 'hiring_trends', '[]'::jsonb));
  END;

  BEGIN
    SET LOCAL statement_timeout = '20s';
    payload := payload || jsonb_build_object('trending_categories',
      (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_categories() x));
  EXCEPTION WHEN OTHERS THEN
    stale := stale || 'trending_categories';
    payload := payload || jsonb_build_object('trending_categories', COALESCE(prev -> 'trending_categories', '[]'::jsonb));
  END;

  payload := payload
    || jsonb_build_object('computed_at', now())
    -- Empty array, never absent: a key that only appears when something is
    -- wrong is indistinguishable from a key that stopped being written.
    || jsonb_build_object('stale_parts', to_jsonb(stale));

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('stats_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

-- Seed now. LOUD this time: the previous seed was best-effort and silent, and
-- two cron ticks then failed the same way with nothing to show for it. If this
-- raises, the deploy should say so.
SELECT public.refresh_ghost_stats();
