-- THE CATEGORY RAIL ADDED UP TO MORE JOBS THAN THE BOARD WILL SERVE.
--
-- Measured against 2026-08-25.6, inside ONE list response: the categories
-- facet summed to 564,179 while `total` in the same payload was 556,076. A
-- visitor adding up the rail found 8,103 openings that do not exist on the
-- board, and clicking the biggest category landed on a smaller number than
-- the chip promised.
--
-- The cause is visible in 20260808160000: when `sourcesFacet` and `openTotal`
-- were added they were given the FULL serving rule, and that file's own header
-- explains why ("my first draft filtered only missing_since... NULL
-- effective_posted stays excluded, matching .gte on a NULL"). The two OLDER
-- keys were left as they were. So one cached row now carried counts under two
-- different definitions, and the front end picked the wrong one for a control
-- that sits next to a filtered result count.
--
-- categoriesFacet gains the same two predicates as sourcesFacet and openTotal.
-- Its only consumer is visibleCategories(), the user-facing rail; no
-- destructive path reads it.
--
-- companiesFacet is deliberately LEFT UNFILTERED. The refresh pass uses it to
-- drive an orphan prune that DELETES postings: a board whose postings have all
-- aged past the cap would vanish from a filtered facet and read as an orphan,
-- and the prune would delete live rows on the strength of a freshness window.
-- That is a data-loss path, not a display inconsistency, and it is the reason
-- this migration changes one key and not both.

CREATE OR REPLACE FUNCTION public.refresh_job_board_facets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- KEEP THE LONG TIMEOUT. This aggregates over ~560k rows off the request path;
-- an earlier version of this function 57014'd after 20.3s under the default.
-- Dropping this line while rewriting the body is exactly the kind of silent
-- loss a CREATE OR REPLACE invites, and it is guarded.
SET statement_timeout = '10min'
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM job_board_postings),
    -- UNFILTERED ON PURPOSE — feeds the orphan prune. See header.
    'companiesFacet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token', company_token, 'name', company, 'count', n) ORDER BY company)
      FROM (
        SELECT company_token, max(company) AS company, count(*) AS n
        FROM job_board_postings
        GROUP BY company_token
      ) c(company_token, company, n)
    ), '[]'::jsonb),
    -- NOW UNDER THE SERVING RULE, so a chip's number is the number the reader
    -- finds after clicking it, and the rail sums to openTotal rather than to
    -- the raw table count.
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
    'openTotal', (
      SELECT count(*) FROM job_board_postings
      WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days'
    ),
    'as_of', now()
  ) INTO v;

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('facets', v, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  -- Returns the FULL payload, not a summary: the orphan prune reads
  -- companiesFacet from here, and a destructive path must never read a cache.
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_job_board_facets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_job_board_facets() TO service_role;

COMMENT ON FUNCTION public.refresh_job_board_facets() IS
  'Rebuilds the cached facet row. categoriesFacet, sourcesFacet and openTotal '
  'all carry the FULL serving rule (missing_since IS NULL AND effective_posted '
  'within 30 days) so their counts match what /jobs actually serves and the '
  'parts sum to the whole. companiesFacet is intentionally UNFILTERED because '
  'the refresh pass uses it to drive an orphan prune that deletes postings; '
  'filtering it would let a freshness window delete live rows.';

-- ── the reader, carried forward unchanged ─────────────────────────────────
--
-- Restated here, not because it changes, but because this file is now the
-- newest definition of the facet pair and the COLD-cache shape is hand-written.
-- A migration that replaces half a pair leaves the other half's shape asserted
-- against an older file, and the next person to read "what does a cold cache
-- return" finds an answer two migrations back.
CREATE OR REPLACE FUNCTION public.get_job_board_facets()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  cached jsonb;
BEGIN
  SELECT v INTO cached FROM public.job_board_meta WHERE k = 'facets';

  IF cached IS NOT NULL AND cached ? 'total' THEN
    RETURN cached || jsonb_build_object(
      'cached', true,
      'stale', (SELECT updated_at < now() - interval '6 hours'
                FROM public.job_board_meta WHERE k = 'facets')
    );
  END IF;

  RETURN jsonb_build_object(
    'total', NULL, 'companiesFacet', '[]'::jsonb, 'categoriesFacet', '{}'::jsonb,
    -- Empty, not absent, and `openTotal` NULL rather than 0. A cold cache has
    -- measured nothing; every field must say so in the way its consumer will
    -- read correctly.
    'sourcesFacet', '{}'::jsonb, 'openTotal', NULL,
    'cached', false, 'stale', true, 'as_of', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_job_board_facets() TO anon, authenticated, service_role;

-- Rebuild once now so the category rail is correct on the first page view
-- after this applies, rather than waiting for the timer.
SELECT public.refresh_job_board_facets();
