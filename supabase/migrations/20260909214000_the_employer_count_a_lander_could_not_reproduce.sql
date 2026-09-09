-- THE NUMBER IN 500 SERP TITLES WAS NOT THE NUMBER THE PAGE SERVES.
--
-- companiesFacet is `count(*) GROUP BY company_token` with NO WHERE CLAUSE. It
-- applies NEITHER serving predicate — not `missing_since IS NULL`, not
-- `effective_posted >= now() - interval '30 days'` — so it counts postings the
-- employer has already withdrawn and postings aged past the freshness window
-- that the sweep has not deleted yet.
--
-- THIS FILE DOES NOT FILTER IT, AND THE GUARD THAT PINS THAT IS THE POINT.
-- 20260825190000 gave categoriesFacet, sourcesFacet and openTotal the serving
-- rule and deliberately left companiesFacet alone, because the refresh pass
-- diffs this array against sources.ts and DELETES every token missing from it
-- (job-board/index.ts, the orphan prune). A board whose postings have all gone
-- missing, or all aged past the cap, would vanish from a filtered facet, read
-- as an orphan, and take its history with it. That is a data-loss path, and a
-- destructive path must compute its own input. So the fix is a SECOND number
-- published alongside, never an edit to the first.
--
-- THE DATABASE ALREADY STATED THE RULE AND FIVE SURFACES BROKE IT.
-- 20260908136000's COMMENT ON get_company_suggest: "NEVER returns
-- companiesFacet.count: that number applies NEITHER serving predicate and
-- would contradict the page each hit links to." get_company_suggest honours it
-- and counts under both predicates. Meanwhile the edge function's own
-- typeahead returned companiesFacet.count verbatim, /jobs printed it in the
-- company dropdown and in "{{n}} more open roles at {{company}}", the
-- prerenderer baked it into ~500 crawlable <title>s, H1s and meta
-- descriptions, and /v1/companies served it as `open_postings`.
--
-- THE MAGNITUDE, MEASURED 2026-09-09 against the board's own filtered count
-- (the exact query the destination page runs): median gap ~1% — Dollar Tree
-- 5299 vs 5296, JCPenney 3434 vs 3425 — and a severe tail: PwC 3254 vs 2119
-- (+54%, 1,135 phantom roles in a SERP title), AECOM 2874 vs 2229 (+29%),
-- Hilton 3312 vs 3159 (+5%). Most landers were close. A minority were badly
-- wrong, and nothing on the page told a reader which kind they were looking at.
--
-- WHAT THIS ADDS
--
--   companiesOpen       jsonb map company_token -> count, under BOTH serving
--                       predicates. A token with zero open postings is ABSENT
--                       from the map, so `map[token] ?? 0` is the correct read
--                       and the map stays proportional to what is actually
--                       open rather than to the catalog.
--   companiesOpenCount  how many distinct company_token have at least one open
--                       posting. This is the SERVABLE denominator for
--                       "N openings from N company feeds", whose numerator has
--                       been serving-filtered all along while its denominator
--                       was the length of the unfiltered token grouping.
--
-- BOTH ARE COMPUTED IN THE SAME STATEMENT AS companiesFacet, so the two
-- numbers describe one instant. A second pass would let a token appear in one
-- and not the other, which is the failure mode that produces "at least N" out
-- of thin air.
--
-- A MAP, NOT A SECOND ARRAY OF OBJECTS, and the shape is a size decision.
-- index.ts:7218 records `v` at 1.3-1.6MB, essentially all companiesFacet
-- (~24k entries at ~60 bytes). Repeating token+name+count per employer would
-- have roughly doubled a row that already forced the serving path onto a
-- separate small row. `{"token": n}` carries no name (companiesFacet already
-- has every name) and no repeated key structure, and it is the same shape
-- categoriesFacet and sourcesFacet already use.
--
-- companiesOpenCount IS STORED EXPLICITLY rather than left to be derived from
-- the map's length, for the reason index.ts gives for companiesCount: the
-- serving path carries a TRUNCATED slice, and a length taken from a slice
-- publishes the slice size as a fact.
--
-- TOKENS ARE NOT EMPLOYERS, and this file does not pretend otherwise.
-- clusters.ts records 76 employers in the top 1,500 running several tokens
-- (PwC ships five Workday sub-sites). The merge is a display-name fold that
-- lives in TypeScript and happens AFTER this count, so companiesOpenCount is a
-- count of BOARDS WITH OPEN ROLES and every surface that prints it must use
-- that noun. It is published under a name that says `companies` only because
-- companiesFacet already did; the reader-facing copy says "company job boards".

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
  -- ONE SCAN OF THE SERVABLE SET, read twice. companiesOpen and
  -- companiesOpenCount are the same rows counted two ways; computing them from
  -- one CTE is what makes "at least one open posting" and "how many open
  -- postings" agree by construction.
  --
  -- company_token IS NOT NULL is not defensive tidying: jsonb_object_agg
  -- raises 22004 on a null key, so a single untokened posting would fail the
  -- whole refresh — and the pass that fails is the pass that also feeds the
  -- freshness sweep and the orphan prune.
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
    -- UNFILTERED ON PURPOSE — feeds the orphan prune. See header. Do not add a
    -- predicate here; add a sibling key, which is what this migration is.
    'companiesFacet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token', company_token, 'name', company, 'count', n) ORDER BY company)
      FROM (
        SELECT company_token, max(company) AS company, count(*) AS n
        FROM job_board_postings
        GROUP BY company_token
      ) c(company_token, company, n)
    ), '[]'::jsonb),
    -- THE SERVABLE SIBLING. Same instant, same statement, both predicates.
    'companiesOpen', COALESCE((
      SELECT jsonb_object_agg(company_token, n) FROM open_by_token
    ), '{}'::jsonb),
    'companiesOpenCount', (SELECT count(*)::int FROM open_by_token),
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
  'Rebuilds the cached facet row. categoriesFacet, sourcesFacet, openTotal, '
  'companiesOpen and companiesOpenCount all carry the FULL serving rule '
  '(missing_since IS NULL AND effective_posted within 30 days) so their counts '
  'match what /jobs actually serves and the parts sum to the whole. '
  'companiesFacet is intentionally UNFILTERED because the refresh pass uses it '
  'to drive an orphan prune that deletes postings; filtering it would let a '
  'freshness window delete live rows. THAT IS WHY THERE ARE TWO COMPANY '
  'NUMBERS: companiesFacet.count is the PRUNE INPUT and must never reach a '
  'reader, and companiesOpen is the servable per-board count every reader '
  'surface publishes. companiesOpen is a map company_token -> open count with '
  'zero-open tokens ABSENT (read it as map[token] ?? 0), computed in the same '
  'statement as companiesFacet so the two describe one instant. '
  'companiesOpenCount is the number of distinct company_token with at least '
  'one open posting — a count of BOARDS, not of employers: one employer can '
  'run several tokens (PwC ships five Workday sub-sites) and that fold is a '
  'display-name merge in clusters.ts that happens after this count.';

-- ── the reader, carried forward with the new keys' COLD shape ─────────────
--
-- Restated because the cold-cache shape is hand-written and this file is now
-- the newest definition of it. A migration that adds a key to the writer and
-- not to the cold reader leaves a consumer reading `undefined` on a cold
-- database and no file saying what it should have found.
--
-- companiesOpen and companiesOpenCount are NULL when cold, NOT '{}' and NOT 0.
-- An empty map would read as "every employer has zero open roles" and 0 would
-- read as "no board is hiring" — both are confident falsehoods about the board
-- from an instrument that has measured nothing. The rule is the one
-- 20260808160000 set for openTotal, applied to the shape each new key's
-- consumer will actually read: absence must be distinguishable from zero,
-- because these consumers publish NOTHING on absence and a number on zero.
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

-- Rebuild once now so the servable company number exists on the first page
-- view after this applies, rather than waiting for the timer — and so the
-- deploy window in which consumers publish nothing is as short as possible.
SELECT public.refresh_job_board_facets();
