-- THE VENDOR WALL READS A SMALL HEAD ROW.
--
-- Cost audit 2026-11-08, "Small facets_head row". get_board_vendor_counts()
-- (20260810161607) answers the home page, /pricing and the résumé checker's
-- vendor wall -- about 600 bytes: the open count per vendor, the open total
-- and the as_of. It reads them out of job_board_meta k = 'facets', a
-- 2.5-3 MB value (every company on the board), and decompresses that value
-- three times per call, once per key it extracts.
--
-- THE FIX. refresh_job_board_facets() writes a second, small row in the SAME
-- INSERT statement as the big one: k = 'facets_head', {sourcesFacet,
-- openTotal, as_of}, taken from the very value it just built. The two rows
-- are written together or not at all, so the head can never describe a
-- different pass than the facets row. get_board_vendor_counts() reads the
-- head row and falls back to the big row when the head is absent (as before
-- this file's seed, or on a database that never ran it), so its answer is the
-- same object, key for key, either way.
--
-- Everything else in refresh_job_board_facets() -- every facet, the federal
-- feed's name, carriedEmployers, the 30-day window shared by the category rail,
-- the vendor counts and the open total, the ten-minute header and the
-- service-role grant -- is byte-for-byte 20261009100200's. The seed below
-- copies the head out of the facets row the last refresh wrote, so the wall
-- reads the small row from the moment this file applies.
--
-- Re-runnable (CREATE OR REPLACE, an upsert that never moves a head row
-- backwards). Self-verifying below.

CREATE OR REPLACE FUNCTION public.refresh_job_board_facets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  v jsonb;
BEGIN
  WITH open_by_token AS MATERIALIZED (
    SELECT company_token, count(*)::int AS n
    FROM job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
      AND company_token IS NOT NULL
    GROUP BY company_token
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM job_board_postings),
    'companiesFacet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token', company_token, 'name', company, 'count', n) ORDER BY company)
      FROM (
        SELECT company_token,
               CASE company_token WHEN 'usajobs' THEN 'USAJOBS' ELSE max(company) END AS company,
               count(*) AS n
        FROM job_board_postings
        GROUP BY company_token
      ) c(company_token, company, n)
    ), '[]'::jsonb),
    'companiesOpen', COALESCE((
      SELECT jsonb_object_agg(company_token, n) FROM open_by_token
    ), '{}'::jsonb),
    'companiesOpenCount', (SELECT count(*)::int FROM open_by_token),
    'categoriesFacet', COALESCE((
      SELECT jsonb_object_agg(category, n)
      FROM (
        SELECT category, count(*) AS n
        FROM job_board_postings
        WHERE missing_since IS NULL
          AND effective_posted >= now() - interval '30 days'
        GROUP BY category
      ) k(category, n)
    ), '{}'::jsonb),
    'sourcesFacet', COALESCE((
      SELECT jsonb_object_agg(source, n)
      FROM (
        SELECT source, count(*) AS n
        FROM job_board_postings
        WHERE missing_since IS NULL
          AND effective_posted >= now() - interval '30 days'
          AND source IS NOT NULL AND source <> ''
        GROUP BY source
      ) s(source, n)
    ), '{}'::jsonb),
    'carriedEmployers', COALESCE((
      SELECT jsonb_object_agg(company_token, names)
      FROM (
        SELECT company_token, jsonb_agg(DISTINCT company) AS names
        FROM job_board_postings
        WHERE company_token = ANY (ARRAY['usajobs'])
          AND missing_since IS NULL
          AND effective_posted >= now() - interval '30 days'
          AND company IS NOT NULL AND company <> ''
        GROUP BY company_token
      ) e(company_token, names)
    ), '{}'::jsonb),
    'openTotal', (
      SELECT count(*) FROM job_board_postings
      WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days'
    ),
    'as_of', now()
  ) INTO v;

  -- Both rows in one statement: the head is cut from the value just built.
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('facets', v, now()),
         ('facets_head', jsonb_build_object('sourcesFacet', v -> 'sourcesFacet',
                                            'openTotal',    v -> 'openTotal',
                                            'as_of',        v -> 'as_of'), now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_job_board_facets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_job_board_facets() TO service_role;

-- The vendor wall: the head row, else the big row exactly as before, else the
-- empty answer.
CREATE OR REPLACE FUNCTION public.get_board_vendor_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'sourcesFacet', COALESCE(h.v -> 'sourcesFacet', '{}'::jsonb),
       'openTotal',    h.v -> 'openTotal',
       'as_of',        h.v -> 'as_of',
       'cached',       true
     )
     FROM public.job_board_meta h WHERE h.k = 'facets_head'),
    (SELECT jsonb_build_object(
       'sourcesFacet', COALESCE(f.v -> 'sourcesFacet', '{}'::jsonb),
       'openTotal',    f.v -> 'openTotal',
       'as_of',        f.v -> 'as_of',
       'cached',       true
     )
     FROM public.job_board_meta f WHERE f.k = 'facets'),
    jsonb_build_object(
      'sourcesFacet', '{}'::jsonb, 'openTotal', NULL,
      'as_of', NULL, 'cached', false)
  );
$$;

COMMENT ON FUNCTION public.get_board_vendor_counts() IS
  'Vendor-wall subset of the cached board facets: sourcesFacet + openTotal + as_of only. Reads the '
  'small job_board_meta k = ''facets_head'' row refresh_job_board_facets() writes in the same '
  'statement as k = ''facets'' (20261109175000), and the big row when the head is absent.';

REVOKE ALL ON FUNCTION public.get_board_vendor_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_vendor_counts() TO anon, authenticated, service_role;

-- The seed: the head of the facets row the last refresh wrote, never older
-- than a head already there.
INSERT INTO public.job_board_meta (k, v, updated_at)
SELECT 'facets_head',
       jsonb_build_object('sourcesFacet', m.v -> 'sourcesFacet',
                          'openTotal',    m.v -> 'openTotal',
                          'as_of',        m.v -> 'as_of'),
       m.updated_at
  FROM public.job_board_meta m
 WHERE m.k = 'facets'
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at
 WHERE job_board_meta.updated_at < EXCLUDED.updated_at;

-- The end state, read back.
DO $verify$
DECLARE
  r   text := pg_get_functiondef('public.refresh_job_board_facets()'::regprocedure);
  g   text := pg_get_functiondef('public.get_board_vendor_counts()'::regprocedure);
  big jsonb;
  hd  jsonb;
BEGIN
  IF position('''facets_head''' IN r) = 0 OR position('WHEN ''usajobs'' THEN ''USAJOBS''' IN r) = 0
     OR position('carriedEmployers' IN r) = 0 THEN
    RAISE EXCEPTION 'refresh_job_board_facets does not write the head row beside the unchanged facets';
  END IF;
  IF position('''facets_head''' IN g) = 0 OR position('f.k = ''facets''' IN g) = 0 THEN
    RAISE EXCEPTION 'get_board_vendor_counts does not read the head row with the big row behind it';
  END IF;
  IF has_function_privilege('anon', 'public.refresh_job_board_facets()', 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh_job_board_facets is callable by anon';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_board_vendor_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_board_vendor_counts lost its anon grant (the vendor wall calls it)';
  END IF;
  SELECT m.v INTO big FROM public.job_board_meta m WHERE m.k = 'facets';
  SELECT m.v INTO hd FROM public.job_board_meta m WHERE m.k = 'facets_head';
  IF big IS NOT NULL AND (hd IS NULL OR (hd -> 'as_of') IS DISTINCT FROM (big -> 'as_of')) THEN
    RAISE EXCEPTION 'facets_head was not seeded from the facets row';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
