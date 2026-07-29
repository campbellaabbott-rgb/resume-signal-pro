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

-- get_company_hiring_health: non-deterministic at the batch size the board
-- actually sends. Measured — 26 tokens (a normal 60-row page) returned
-- 500/57014 at 15.8s on one attempt and 200 at 7.1s on the retry; a 1-token
-- call is 0.59s. When it fails the client swallows it, so the "Actively hiring"
-- filter and every fill/relist badge silently vanish: 0 of 60 rows carried a
-- badge after a failure.
--
-- Same two changes as the country facet above, for the same reasons: a ceiling
-- that matches what the work actually costs, and the serving-rule filter so it
-- stops scanning postings the board will never show. The second is not only
-- cheaper — a hiring-health score computed over rows we refuse to serve is
-- describing a different board than the one on screen.
CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE (
  company_token text,
  open_now integer,
  closed_30d integer,
  median_days_to_close numeric,
  relisted_30d integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH toks AS (SELECT unnest(p_tokens) AS tok),
  opens AS (
    SELECT p.company_token, count(*)::int AS n
    FROM public.job_board_postings p
    JOIN toks ON toks.tok = p.company_token
    WHERE p.missing_since IS NULL
    GROUP BY p.company_token
  ),
  closes AS (
    SELECT c.company_token,
           count(*)::int AS n,
           count(*) FILTER (WHERE c.superseded IS TRUE)::int AS relisted,
           round((percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0
           ))::numeric, 1) AS med
    FROM public.job_board_closures c
    JOIN toks ON toks.tok = c.company_token
    WHERE c.closed_at > now() - interval '30 days'
      AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL
      AND c.closed_at >= COALESCE(c.posted_at, c.first_seen)
    GROUP BY c.company_token
  )
  SELECT toks.tok,
         COALESCE(opens.n, 0),
         COALESCE(closes.n, 0),
         closes.med,
         COALESCE(closes.relisted, 0)
  FROM toks
  LEFT JOIN opens  ON opens.company_token  = toks.tok
  LEFT JOIN closes ON closes.company_token = toks.tok;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_hiring_health(text[]) TO anon, authenticated, service_role;
