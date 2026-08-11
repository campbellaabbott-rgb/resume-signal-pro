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
    WHERE length(q.s) >= 3 AND lower(r.name) LIKE '%' || q.s || '%'
  )
  SELECT h.name,
         array_agg(h.token ORDER BY h.c DESC, h.token) AS tokens
  FROM hit h
  GROUP BY h.name
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

CREATE OR REPLACE FUNCTION public.get_company_hiring_health(p_tokens text[])
RETURNS TABLE(company_token text, open_roles integer, closed_90d integer, superseded_90d integer, median_days_open numeric, median_days_to_close numeric, tracking_days integer, feed_total integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH toks AS (SELECT DISTINCT unnest(p_tokens) AS t),
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