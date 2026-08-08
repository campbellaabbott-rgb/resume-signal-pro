-- PER-VENDOR OPEN COUNTS, SO THE FRONT PAGE CAN NAME A NUMBER A READER CAN CHECK.
--
-- The home page lists the 15 ATS platforms we read. Names, not a percentage —
-- src/config/ats-vendors.ts explains at length why a share-of-board figure was
-- refused, and that reasoning stands. But a name is a claim and a count is
-- evidence, and this one IS measurable: "Greenhouse — 48,102 open roles" is
-- checkable in one click on /jobs, which is the whole point of putting it on a
-- credibility surface.
--
-- WHY THIS CANNOT BE DONE ON THE REQUEST PATH. Measured today, as anon:
--
--     GET /job_board_postings?select=id&source=eq.greenhouse&missing_since=is.null
--         Prefer: count=exact          ->  500, 57014 statement timeout, 3.8s
--
-- Exactly the failure 20260801141837 was written to end — an exact count over
-- 595k rows. Four of the fifteen vendors timed out that way while lever, ashby,
-- rippling, icims and workday answered, which is worth stating plainly: the
-- blanks were NOT zeros. A per-vendor count belongs in the same scheduled pass
-- as every other facet, and nowhere near a page load.
--
-- IT MUST MATCH THE SERVING RULE — BOTH HALVES OF IT.
--
-- This is the trap that already caught this project once, and the note it left
-- behind in src/pages/Jobs.tsx is what stopped me repeating it. An exact
-- per-category total was shipped from `get_job_board_facets` and reverted the
-- same day, because that function counts the whole table with NO serving-rule
-- predicate: it included postings the board itself refuses to show, and the
-- figure went out as an EXACT total. The note ends "a correct version needs a
-- serving-rule-filtered per-category count, which is a DB change, not a frontend
-- one" — which is this migration, so it had better get the rule right.
--
-- The rule is TWO unconditional predicates, both in buildQuery (index.ts:5262):
--
--     .gte("effective_posted", now() - 30 days)   -- FRESH_WINDOW_DAYS
--     .is("missing_since", null)
--
-- My first draft of this file filtered only `missing_since`. That would have
-- over-reported every vendor by exactly the rows the window drops, and shipped
-- the reverted bug back to the front page with a bigger audience. Both, or the
-- number is not the one the reader will find when they click through.
--
-- NULL effective_posted stays excluded, matching `.gte` on a NULL — which is
-- also excluded. The parts and the whole must be filtered identically or the
-- vendor counts will not sum to the total sitting next to them.
--
-- WHY NOT REUSE `total`. It stays unfiltered: the filter sidebar uses it as a
-- denominator and changing it is a separate decision with its own callers. The
-- two keys answer different questions on purpose, so `sourcesFacet` and
-- `openTotal` carry the serving rule in their own names and their own comment.
--
-- One more GROUP BY on a pass that already does two, 15 groups wide. It runs on
-- a 15-minute timer with a 10-minute budget and nobody waiting on it.

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
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM job_board_postings),
    'companiesFacet', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('token', company_token, 'name', company, 'count', n) ORDER BY company)
      FROM (
        SELECT company_token, max(company) AS company, count(*) AS n
        FROM job_board_postings
        GROUP BY company_token
      ) c(company_token, company, n)
    ), '[]'::jsonb),
    'categoriesFacet', COALESCE((
      SELECT jsonb_object_agg(category, n)
      FROM (
        SELECT category, count(*) AS n FROM job_board_postings GROUP BY category
      ) k(category, n)
    ), '{}'::jsonb),
    -- NEW. Open postings per ATS vendor. A vendor with no live postings is
    -- ABSENT from this object rather than present with 0 — the front page needs
    -- to tell "we carry none today" from "we did not measure", and an absent key
    -- is the only one of the two that cannot be misread as a measured zero.
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
    -- The denominator that belongs WITH the per-vendor counts: SAME two
    -- predicates, so the parts and the whole are one measurement and the vendor
    -- counts actually sum to it. Reading `total` next to `sourcesFacet` would
    -- compare an unfiltered count against filtered ones.
    'openTotal', (
      SELECT count(*) FROM job_board_postings
      WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days'
    ),
    'as_of', now()
  ) INTO v;

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('facets', v, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  -- Returns the FULL payload, not a summary. The refresh pass uses
  -- companiesFacet to drive an orphan prune that DELETES postings, and a
  -- destructive path must never read a cache. Unchanged from 20260801141837.
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_job_board_facets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_job_board_facets() TO service_role;

-- ── the cold-cache shape gains the same keys ──────────────────────────────
--
-- get_job_board_facets merges the cached row through `||`, so sourcesFacet
-- reaches callers with no change there. The COLD path is hand-written, and if it
-- omits the key then a consumer written against the warm shape sees `undefined`
-- on a cold cache and — depending on how carefully it was written — renders
-- nothing, or renders zeros. Declaring the empty shape removes the choice.
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

COMMENT ON FUNCTION public.get_job_board_facets() IS
  'Serves cached board facets from job_board_meta. Carries as_of/cached/stale '
  'so a caller can say when the counts were true. sourcesFacet holds per-vendor '
  'counts under the FULL serving rule (missing_since IS NULL AND '
  'effective_posted within 30 days), matching buildQuery, so a vendor count is '
  'the number the reader finds on /jobs; openTotal is their sum under the same '
  'rule. Vendors with none are OMITTED, so absence is never rendered as a '
  'measured zero. Never aggregates on the request path — doing so over 595k '
  'rows is what caused the 57014 outage, and a per-vendor count still times out '
  'there today even capped at 10k.';

-- Fill it once now, so the vendor wall has real counts on the first page view
-- after this applies rather than waiting up to 15 minutes for the timer.
SELECT public.refresh_job_board_facets();
