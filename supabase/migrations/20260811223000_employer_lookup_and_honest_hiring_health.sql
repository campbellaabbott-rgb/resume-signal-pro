-- EXPLORE SHOWS 85 EMPLOYERS. THE BOARD CARRIES 24,931.
--
-- Measured today: the six answers surface 85 distinct companies out of 24,931 —
-- about one employer in 293. The lifecycle data that makes this product
-- different (who actually fills roles, who re-lists forever, who states pay) is
-- tracked for ALL of them and exposed only for the handful that happen to top a
-- twelve-row list. A visitor cannot ask the one question the data is uniquely
-- able to answer: "is THIS employer worth an hour of my life?"
--
-- This adds the lookup, and repairs the page it points at.

-- ── 1. the suggest RPC ────────────────────────────────────────────────────
--
-- Reads the SINGLE cached facets row — a PK lookup, not an aggregate. Same
-- shape and cost as get_explore_cache.
--
-- Deliberately independent of pg_cron: the 'facets' row is rewritten by the
-- edge-function refresh pass on every completed rotation, not by a scheduled
-- job. pg_cron died today for five hours; this feature would have kept working
-- throughout, which is part of why it is first.
--
-- COUNT IS NEVER RETURNED. companiesFacet.count is count(*) GROUP BY
-- company_token with NEITHER serving predicate — no missing_since, no 30-day
-- window (20260808160000). It may rank and it may match, but publishing it
-- would put a number on screen that the click-through contradicts, which is the
-- defect this codebase has paid for repeatedly. The lookup returns names and
-- tokens only; every number the reader sees comes from the company page, which
-- applies the real predicates.
CREATE OR REPLACE FUNCTION public.get_company_suggest(p_q text)
RETURNS TABLE(name text, tokens text[])
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  WITH q AS (SELECT lower(btrim(coalesce(p_q, ''))) AS s),
  rows AS (
    SELECT e ->> 'name' AS name,
           e ->> 'token' AS token,
           COALESCE((e ->> 'count')::int, 0) AS c
    FROM public.job_board_meta m,
         LATERAL jsonb_array_elements(m.v -> 'companiesFacet') AS e
    WHERE m.k = 'facets'
  ),
  hit AS (
    SELECT r.name, r.token, r.c
    FROM rows r, q
    -- 3-char minimum is enforced here as well as in the client: a 1-char query
    -- would scan and return the alphabet.
    WHERE length(q.s) >= 3 AND lower(r.name) LIKE '%' || q.s || '%'
  )
  -- MERGED BY DISPLAY NAME, because an employer with several ATS feeds appears
  -- once per feed (PwC has four; every eu~ mirror is its own token). Showing
  -- four identical "PwC" rows is a worse answer than one. The client gets every
  -- token so it can decide where to send the reader.
  SELECT h.name,
         array_agg(h.token ORDER BY h.c DESC, h.token) AS tokens
  FROM hit h
  GROUP BY h.name
  -- Ordered by best-match then size: an exact prefix beats a substring hit, so
  -- typing "next" surfaces Next before Nextdoor.
  ORDER BY (lower(h.name) LIKE (SELECT s FROM q) || '%') DESC,
           length(h.name),
           max(h.c) DESC
  LIMIT 8;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_suggest(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_company_suggest(text) IS
  'Typeahead over the cached companiesFacet, merged by display name. Returns '
  'names and tokens ONLY — never companiesFacet.count, which applies neither '
  'serving predicate and would contradict the destination page. Reads one '
  'job_board_meta row; never aggregates on the request path.';

-- ── 2. the page the lookup points at, repaired ────────────────────────────
--
-- get_company_hiring_health is about to receive thousands of readers who
-- arrived asking a yes/no question about a named employer. Two defects make its
-- answer wrong, and both are the kind that read as a verdict:
--
--   (a) `live` filtered on missing_since IS NULL and NOTHING ELSE, so open_roles
--       counted postings outside the 30-day serving window. The card would state
--       a bigger number than the board it links to — the exact mismatch removed
--       from six Explore RPCs in 20260811013000.
--
--   (b) `span` computed tracking_days from min(closed_at) over the ENTIRE
--       closure log with NO company filter. Every employer therefore reported
--       the same tracking window — the age of the whole log. For a board we
--       began carrying last week that renders "90 days tracked, 0 filled", and
--       a reader cannot tell "this employer does not fill roles" from "we have
--       barely watched them". Silence reading as a verdict is the worst
--       available failure for a page whose purpose is judging an employer.
CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE(company_token text, open_roles integer, closed_90d integer, superseded_90d integer, median_days_open numeric, median_days_to_close numeric, tracking_days integer, feed_total integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH toks AS (SELECT DISTINCT unnest(p_tokens) AS t),
  -- PER COMPANY, not the whole log. Falls back to how long we have carried the
  -- board at all when it has no closures yet, so a new board reports a short
  -- window rather than borrowing the log's full age.
  span AS (
    SELECT t.t AS company_token,
           LEAST(GREATEST(COALESCE(
             EXTRACT(DAY FROM now() - (SELECT min(c.closed_at) FROM public.job_board_closures c WHERE c.company_token = t.t))::int,
             EXTRACT(DAY FROM now() - (SELECT min(p.first_seen) FROM public.job_board_postings p WHERE p.company_token = t.t))::int,
             0), 0), 90) AS days
    FROM toks t
  ),
  live AS (
    SELECT company_token, count(*)::int AS open_roles,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0))
             FILTER (WHERE posted_at IS NOT NULL))::numeric AS median_days_open
    FROM public.job_board_postings
    WHERE company_token = ANY (p_tokens)
      AND missing_since IS NULL
      -- The board's other serving predicate. Without it this count exceeds what
      -- /jobs/company/{token} shows, on the very page a reader opened to decide
      -- whether to trust us.
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  closed AS (
    SELECT company_token,
           count(*) FILTER (
             WHERE closed_at > now() - interval '90 days'
               AND NOT superseded
               AND closed_at - COALESCE(posted_at, first_seen) >= interval '7 days'
           )::int AS closed_90d,
           count(*) FILTER (WHERE closed_at > now() - interval '90 days' AND superseded)::int AS superseded_90d,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0)
             FILTER (WHERE closed_at > now() - interval '90 days'
                       AND NOT superseded
                       AND posted_at IS NOT NULL
                       AND closed_at - posted_at >= interval '7 days'))::numeric AS median_days_to_close
    FROM public.job_board_closures WHERE company_token = ANY (p_tokens) GROUP BY company_token
  ),
  ver AS (
    SELECT company_token, feed_total FROM public.job_board_verifications
    WHERE company_token = ANY (p_tokens)
  )
  SELECT toks.t AS company_token,
         COALESCE(live.open_roles, 0),
         COALESCE(closed.closed_90d, 0),
         COALESCE(closed.superseded_90d, 0),
         live.median_days_open,
         closed.median_days_to_close,
         span.days,
         ver.feed_total
  FROM toks
  LEFT JOIN live   ON live.company_token   = toks.t
  LEFT JOIN closed ON closed.company_token = toks.t
  LEFT JOIN ver    ON ver.company_token    = toks.t
  LEFT JOIN span   ON span.company_token   = toks.t;
$$;

COMMENT ON FUNCTION public.get_company_hiring_health(text[]) IS
  'Per-employer lifecycle summary. open_roles applies BOTH serving predicates so '
  'it matches /jobs/company/{token}. tracking_days is PER COMPANY (its own '
  'first closure, falling back to when we first saw its board) — it was the age '
  'of the entire closure log, which made every new board report a long window '
  'with no fills, and silence read as a verdict.';

NOTIFY pgrst, 'reload schema';
