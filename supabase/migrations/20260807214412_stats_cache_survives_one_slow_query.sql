-- ONE SLOW QUERY BLACKED OUT SIX STATISTICS FOR FOUR DAYS.
--
-- Measured 2026-08-07: get_ghost_job_index_stats() returns 57014 (statement
-- timeout) at 60s, reproduced live as anon. refresh_stats_cache() calls it
-- inside a single jsonb_build_object alongside five other functions, so the
-- assignment threw, the INSERT never ran, and the WHOLE cache froze at
-- 2026-08-03T10:12Z — entry_stats, hiring_trends, trending_categories and
-- date_coverage included, none of which were slow. The public Ghost Job Index
-- went on publishing 562,873 open roles against a real 590,870.
--
-- TWO SEPARATE DEFECTS, and the second is the one that turned a slow query
-- into a blackout:
--
--   1. The query outgrew its budget as the corpus passed 590k postings.
--   2. Six independent statistics shared one all-or-nothing transaction.
--
-- Fixing only (1) leaves the next slow function to do the same thing. Fixing
-- only (2) leaves the Ghost Index stats permanently stale-but-labelled. Both.
--
-- WHY NOT JUST RAISE THE TIMEOUT AGAIN: that was the fix last time. 20260727190000
-- set it to 25s to make the anon fallback reachable, and the query has since
-- crossed even the gateway's 60s. A ceiling that is raised each time the corpus
-- grows is a reminder to do this properly, not a fix.

-- NO NEW INDEX. An early draft added one on first_seen, which was only needed
-- because that draft had (wrongly) switched the median to first_seen. The
-- median is measured from posted_at, and job_board_postings_posted_at_idx
-- already exists — so the index walk below is served by what is already there.

-- --------------------------------------------------------- the statistics
--
-- SAME EIGHT COLUMNS, SAME DEFINITIONS, SAME FILTERS. Read that literally: the
-- definitions here are load-bearing and two of them were incidents.
--
--   * median_days_open is measured from posted_at — the EMPLOYER's stated date
--     — and never from first_seen, which is when WE noticed. On 4,179 rows
--     carrying both, the bases differ by 17.6 days at the median and the
--     published figure was the flattering one. The page's label says "by the
--     company's own stated post date"; first_seen would make that false.
--   * Every count filters missing_since IS NULL. A column headed "open
--     postings" must mean postings the board will actually serve.
--   * posted_coverage_pct stays in the signature. GhostJobIndex gates its
--     coverage caveat on it, and when the column was missing the caveat had
--     never rendered once.
--
-- An earlier draft of this migration rebuilt the function from 20260727190000
-- and silently reverted all three. published-claims.test.ts failed it, which is
-- exactly what that file is for.
--
-- WHAT ACTUALLY CHANGES, and only this:
--
-- LOOSE INDEX SCAN for the two DISTINCT counts. count(DISTINCT company_token)
-- reads 590k rows to find ~28k values; the recursive form seeks the next
-- distinct value through the existing index instead. The missing_since filter
-- moves into an EXISTS per candidate — ~28k index probes rather than a sort of
-- every row — and the result is EXACT, not sampled.
--
-- INDEX-ORDERED OFFSET for the posting-age median, over the same filtered set.
-- Days-since-posted_at is monotonically decreasing in posted_at, so the middle
-- row by posted_at IS the middle row by age; that turns a ~450k-row sort into
-- an index walk on job_board_postings_posted_at_idx. Exact on odd counts; on an
-- even count it takes the upper of the two middle rows instead of averaging
-- them, which moves the median by hours and changes nothing a reader could act
-- on.
--
-- The closure median KEEPS percentile_cont: it sorts a computed expression no
-- index can serve, over the 90-day subset only, and that set is an order of
-- magnitude smaller than the table that broke.
CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,
  total_company_names bigint,
  closed_90d bigint,
  observed_days integer,
  median_days_open numeric,
  median_days_to_close numeric,
  posted_coverage_pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH RECURSIVE
  -- One pass for the two plain counts, unchanged.
  counts AS (
    SELECT
      count(*) FILTER (WHERE missing_since IS NULL)         AS open_n,
      count(posted_at) FILTER (WHERE missing_since IS NULL) AS dated_n
    FROM public.job_board_postings
  ),
  -- Distinct feed tokens, by index seek rather than by sorting every row.
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
  -- CTE — the RAW company string — so the headline count and the segments page
  -- cannot disagree about what one employer is.
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
    (SELECT open_n FROM counts),
    (SELECT count(*) FROM tok WHERE v IS NOT NULL),
    (SELECT count(*) FROM nm  WHERE v IS NOT NULL),
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
       FROM public.job_board_closures),
    -- posted_at, never first_seen. See the note above.
    (SELECT round(GREATEST(EXTRACT(EPOCH FROM (now() - p.posted_at)) / 86400.0, 0)::numeric, 1)
       FROM public.job_board_postings p
      WHERE p.missing_since IS NULL AND p.posted_at IS NOT NULL
      ORDER BY p.posted_at
     OFFSET GREATEST((SELECT dated_n FROM counts) / 2, 0)
      LIMIT 1),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND posted_at IS NOT NULL
       AND closed_at >= posted_at),
    (SELECT CASE WHEN open_n > 0 THEN round(100.0 * dated_n / open_n, 1) END FROM counts);
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

-- ------------------------------------------------------------ the real repair
--
-- SIX STATISTICS, SIX FATES. Each piece is computed in its own block with its
-- own timeout. A piece that fails keeps its PREVIOUS value rather than blanking
-- the page, and names itself in `stale_parts` so the staleness is visible
-- instead of inferred. The cache row is then always written — which is the
-- whole point, because the old version wrote nothing at all when any single
-- piece threw.
--
-- 20s per piece: six pieces cannot exceed the hourly window even if every one
-- of them times out.
--
-- `computed_at` still means "when this refresh ran". Readers that want to know
-- whether a SPECIFIC number is fresh read stale_parts — a single timestamp
-- cannot describe six independently-updated statistics, and pretending it can
-- is how the page ended up captioning four-day-old figures "right now".
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

COMMENT ON FUNCTION public.refresh_stats_cache() IS
  'Rebuilds the hourly stats cache. Each of the six statistics is computed in '
  'its own block with a 20s timeout; a failing one keeps its previous value and '
  'names itself in stale_parts, so one slow query can never again blank the '
  'other five. On 2026-08-07 that is exactly what had happened, for four days.';
