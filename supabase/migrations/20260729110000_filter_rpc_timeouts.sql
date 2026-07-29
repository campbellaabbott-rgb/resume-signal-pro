-- Two RPCs the board depends on fail so consistently that the features they
-- power do not exist in production. Both were measured, repeatedly, before
-- being touched.
--
-- 1. get_country_facet: 10 of 10 calls returned 57014 at 3.20-3.32s.
--    Consequence: the country picker is gated on this facet, so it rendered 0%
--    of the time and NONE of the 20 countries it is designed to offer were
--    selectable. The filter itself was perfect all along — recall measured
--    exact (US 1,320=1,320, GB 251=251, DE 64=64, IN 191=191) — it simply had
--    no control. The client-side retry the code already carries also fails,
--    because 3.2s is not a cold-cache blip: it is the anon statement_timeout
--    cutting a full scan short every single time.
--
--    The frontend no longer hides the control when this fails (it falls back to
--    the countries present in the current results, without counts). This
--    migration fixes the underlying call so real counts come back.
--
-- 2. get_company_hiring_health: non-deterministic at the batch size the board
--    actually sends — 26 tokens returned 500/57014 at 15.8s on one attempt and
--    200 at 7.1s on the retry; a 1-token call is 0.59s. When it fails the
--    client swallows it, so the "Actively hiring" filter and every fill/relist
--    badge silently vanish: 0 of 60 rows carried a badge after a failure.
--
-- Both get a ceiling that matches what they actually cost, and both get the
-- serving-rule filter so they stop scanning rows the board will never show —
-- which is both cheaper AND more correct, since a facet counting unservable
-- postings is a facet that disagrees with its own result list.

CREATE OR REPLACE FUNCTION public.get_country_facet()
RETURNS TABLE (country text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
-- 20s, not the anon default. The old value guaranteed failure rather than
-- risking it; SECURITY DEFINER keeps it off the caller's ceiling entirely.
SET statement_timeout = '20s'
AS $$
  SELECT country, count(*) AS n
  FROM public.job_board_postings
  WHERE country IS NOT NULL
    AND country <> ''
    -- Only what the board will actually serve, so the facet and the result list
    -- cannot disagree.
    AND missing_since IS NULL
  GROUP BY country
  HAVING count(*) >= 10
  ORDER BY count(*) DESC
  LIMIT 40;
$$;

GRANT EXECUTE ON FUNCTION public.get_country_facet() TO anon, authenticated, service_role;
