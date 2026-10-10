-- FEDERAL JOBS WERE CREDITED TO WHICHEVER AGENCY SORTED LAST.
--
-- Sweep S8-022 (2026-10-08). USAJOBS is one national feed, so every federal
-- posting carries the token 'usajobs' and its own agency in `company`.
-- refresh_job_board_facets named each token max(company): live,
-- {companies:['usajobs'], includeFacets} answered 7,924 roles under the facet
-- name 'Western Area Power Administration', and get_company_suggest('veterans
-- health') answered [] though 1,446 Veterans Health Administration postings
-- were open; 'western area' answered the whole federal feed.
--
-- 1. refresh_job_board_facets names the 'usajobs' token by the feed's own
--    proper name, 'USAJOBS', which every locale prints as is (the vendor menu's
--    label too; a descriptive label is the renderer's to translate). Mirrored
--    for renderers by supabase/functions/_shared/employer-names.ts
--    boardDisplayName; a test holds the two equal. It also publishes a small sibling key, carriedEmployers:
--    {token: [the employers its OPEN rows name]}, for the multi-employer feeds
--    only. companiesFacet stays unfiltered (the orphan prune's input).
-- 2. get_job_board_facets is restated unchanged (the newest definition of the
--    pair carries the cold shape).
-- 3. get_company_suggest also answers a query that names an employer a
--    multi-employer feed carries, with that feed's row (its fixed name, its
--    token, its open count, which is what /jobs/company/usajobs serves). The
--    match reads the cached facets row only, like the name match.
--
-- The facets row is rebuilt by the 'refresh-board-facets' cron within 15
-- minutes; until then the suggest's carried match finds nothing new and the old
-- name stands. Re-runnable (CREATE OR REPLACE only). Self-verifying below.

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

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('facets', v, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  RETURN v;
END;
$$;


REVOKE ALL ON FUNCTION public.refresh_job_board_facets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_job_board_facets() TO service_role;

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
    'companiesOpen', NULL, 'companiesOpenCount', NULL,
    'cached', false, 'stale', true, 'as_of', NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_job_board_facets() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_job_board_facets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_job_board_facets() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_company_suggest(p_q text)
RETURNS TABLE(name text, tokens text[], open_roles int, feed_total int, feed_total_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  WITH q AS (SELECT lower(btrim(coalesce(p_q, ''))) AS s),
  -- The two keys read, split out once: each read of the whole cached row
  -- detoasts several MB, so nothing below touches m.v again.
  facets AS MATERIALIZED (
    SELECT m.v -> 'companiesFacet' AS cf,
           COALESCE(m.v -> 'carriedEmployers', '{}'::jsonb) AS ce
    FROM public.job_board_meta m WHERE m.k = 'facets'
  ),
  -- The feeds whose carried employers match, resolved ONCE before the
  -- per-row filter (a correlated EXISTS under the OR ran per facet row).
  carried_hit AS MATERIALIZED (
    SELECT DISTINCT k.key AS token
    FROM facets f, q,
         LATERAL jsonb_each(f.ce) AS k,
         LATERAL jsonb_array_elements_text(k.value) AS n
    WHERE length(q.s) >= 3 AND lower(n.value) LIKE '%' || q.s || '%'
  ),
  rows AS (
    SELECT e ->> 'name' AS name,
           e ->> 'token' AS token,
           COALESCE((e ->> 'count')::int, 0) AS c
    FROM facets f,
         LATERAL jsonb_array_elements(f.cf) AS e
  ),
  hit AS (
    SELECT r.name, r.token, r.c
    FROM rows r, q
    WHERE length(q.s) >= 3
      AND (lower(r.name) LIKE '%' || q.s || '%'
           OR r.token = ANY ((SELECT coalesce(array_agg(token), '{}') FROM carried_hit)::text[]))
  ),
  merged AS (
    SELECT h.name,
           array_agg(h.token ORDER BY h.c DESC, h.token) AS tokens,
           (lower(h.name) LIKE (SELECT s FROM q) || '%') AS prefix_hit,
           length(h.name) AS name_len,
           max(h.c) AS top_c
    FROM hit h
    GROUP BY h.name
    ORDER BY 3 DESC, 4, 5 DESC
    LIMIT 8
  )
  SELECT m.name,
         m.tokens,
         (SELECT count(*)::int
            FROM public.job_board_postings p
           WHERE p.company_token = ANY (m.tokens)
             AND p.missing_since IS NULL
             AND p.effective_posted >= now() - interval '30 days') AS open_roles,
         CASE WHEN array_length(m.tokens, 1) = 1 THEN v.feed_total END AS feed_total,
         CASE WHEN array_length(m.tokens, 1) = 1 THEN v.verified_at END AS feed_total_at
  FROM merged m
  LEFT JOIN public.job_board_verifications v
         ON array_length(m.tokens, 1) = 1
        AND v.company_token = m.tokens[1]
  ORDER BY m.prefix_hit DESC, m.name_len, m.top_c DESC;
$$;

-- An existing client-callable lookup (the Explore check answer); grants unchanged.
REVOKE ALL ON FUNCTION public.get_company_suggest(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_suggest(text) TO anon, authenticated, service_role;

DO $verify$
DECLARE
  r text := pg_get_functiondef('public.refresh_job_board_facets()'::regprocedure);
  s text := pg_get_functiondef('public.get_company_suggest(text)'::regprocedure);
BEGIN
  IF position('WHEN ''usajobs'' THEN ''USAJOBS''' IN r) = 0 OR position('carriedEmployers' IN r) = 0 THEN
    RAISE EXCEPTION 'refresh_job_board_facets did not take the federal feed name';
  END IF;
  IF position('carriedEmployers' IN s) = 0 OR position('carried_hit AS MATERIALIZED' IN s) = 0 THEN
    RAISE EXCEPTION 'get_company_suggest does not resolve the carried match once';
  END IF;
  IF has_function_privilege('anon', 'public.refresh_job_board_facets()', 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh_job_board_facets is callable by anon';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_company_suggest(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_company_suggest lost its anon grant (the Explore lookup calls it)';
  END IF;
END
$verify$;
