-- YOU CANNOT TUNE A SEARCH YOU CANNOT SEE.
--
-- Every relevance judgement made about this board so far — mine, a reviewer's,
-- an agent's — has been a person eyeballing a result page. That is not evidence
-- and it does not scale. Today's search work found seven real defects by hand;
-- each one was invisible until somebody happened to type the right query.
--
-- WHAT EXISTED. job_board_search_misses logs queries that came back empty. Good
-- instinct, and it genuinely writes (the edge function holds a service-role
-- client, and service_role has GRANT ALL on it). But it records only MISSES, on
-- only the RANKED route, which leaves three holes that matter:
--   - no DENOMINATOR. 400 misses is meaningless without the number of searches.
--   - no SUCCESSES, so there is no view of what people actually look for.
--   - no CLICKS. Nothing anywhere records which posting a searcher opened.
-- I enumerated every job_board_* table to be sure of that last one.
--
-- Without a click there is no way to measure whether a change helped, no way to
-- rank by engagement, no way to A/B anything, and no path to learning-to-rank
-- ever. "Best in class" is a measurement claim before it is an engineering one.
--
-- WHAT THIS ADDS: the denominator and the outcome.
--   job_board_search_events  one row per list response, every route, hit or miss
--   job_board_search_clicks  one row per posting opened, tied to the search
--
-- THE JOIN KEY IS ISSUED BY THE SERVER. Each list response carries a search_id
-- the client echoes back on click. That is what makes position-aware metrics
-- (click-through at 5) possible at all — a click with no search behind it can
-- only ever say "someone clicked something".
--
-- q IS DENORMALISED ONTO THE CLICK ON PURPOSE. It duplicates the events row,
-- and that is the point: pruning, a dropped search_id, or a client that never
-- sent one all leave the click still interpretable, and the common query
-- ("what do people click for term X") stays a single-table scan.
--
-- NEITHER TABLE IS ANON-READABLE. This is behavioural data about real visitors,
-- and it is the same class of asset as the lifecycle log that was found open
-- twice this week. Aggregates are exposed through a DEFINER function; the raw
-- rows are not exposed at all. RLS is enabled with NO policy, so anon gets an
-- empty set, and the GRANT is withheld rather than granted-then-revoked.
--
-- NOTHING HERE IS ON THE REQUEST PATH. Both inserts are fire-and-forget behind
-- waitUntil in the edge function. A logging failure must never cost a visitor
-- their results — but it must not be silent either, which is why the edge
-- function logs the error rather than swallowing it. A telemetry table that
-- records nothing while appearing healthy is this repo's most repeated failure.

CREATE TABLE IF NOT EXISTS public.job_board_search_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  search_id uuid NOT NULL,
  q text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Which of the four query paths answered. The paths behave differently enough
  -- that an aggregate mixing them would hide exactly what needs seeing.
  route text NOT NULL DEFAULT 'unknown',
  -- null when the primary tier answered; 'fuzzy'/'semantic' when it did not.
  rescued text,
  results integer NOT NULL DEFAULT 0,
  -- NULL means the board genuinely does not know, which several paths honestly
  -- report. Storing 0 for "unknown" would make the zero-result rate a lie.
  total integer,
  offset_n integer NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_board_search_clicks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Nullable: a click from a browse page with no search behind it is still a
  -- fact worth having, and dropping it would bias the numbers toward searchers.
  search_id uuid,
  posting_id text NOT NULL,
  q text NOT NULL DEFAULT '',
  -- 1-based ABSOLUTE rank (offset + index + 1), not the index on the page, or
  -- click-through-at-5 would count page two's first row as position one.
  position integer,
  kind text NOT NULL DEFAULT 'open',   -- 'open' (detail) | 'apply' (outbound)
  at timestamptz NOT NULL DEFAULT now()
);

-- Time-ordered reads are the only reads: "last 7 days", "since the deploy".
CREATE INDEX IF NOT EXISTS job_board_search_events_at_idx ON public.job_board_search_events (at DESC);
CREATE INDEX IF NOT EXISTS job_board_search_clicks_at_idx ON public.job_board_search_clicks (at DESC);
-- The attribution join, and it is a covering lookup for CTR by search.
CREATE INDEX IF NOT EXISTS job_board_search_clicks_search_idx ON public.job_board_search_clicks (search_id);

ALTER TABLE public.job_board_search_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_board_search_clicks ENABLE ROW LEVEL SECURITY;

-- No policy is created, so RLS denies everyone but service_role. The SELECT
-- grant is never issued in the first place: this repo has twice found a table
-- open because a GRANT outlived the intent behind it.
GRANT ALL ON public.job_board_search_events TO service_role;
GRANT ALL ON public.job_board_search_clicks TO service_role;

-- THE AGGREGATE SURFACE. SECURITY DEFINER deliberately: an INVOKER function
-- reading an RLS-locked table returns HTTP 200 with a zeroed aggregate, which
-- is indistinguishable from "the data says zero" — that exact mistake published
-- "0 closures" on /hiring-trends for two days this week.
CREATE OR REPLACE FUNCTION public.get_search_quality(p_days integer DEFAULT 7)
RETURNS TABLE (
  day date,
  searches bigint,
  zero_result bigint,
  zero_rate numeric,
  rescued bigint,
  clicks bigint,
  ctr numeric,
  ctr_at_5 numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.search_id, e.at::date AS d, e.results, e.rescued
    FROM public.job_board_search_events e
    WHERE e.at >= now() - make_interval(days => GREATEST(LEAST(p_days, 90), 1))
      AND e.offset_n = 0            -- page one only; deeper pages are not new searches
  ),
  cl AS (
    SELECT c.search_id, min(c.position) AS best_pos
    FROM public.job_board_search_clicks c
    WHERE c.at >= now() - make_interval(days => GREATEST(LEAST(p_days, 90), 1))
      AND c.search_id IS NOT NULL
    GROUP BY c.search_id
  )
  SELECT
    ev.d,
    count(*)::bigint,
    count(*) FILTER (WHERE ev.results = 0)::bigint,
    -- Rates are NULL, never 100 or 0, when the denominator is empty. An ELSE
    -- literal here would make a health check unable to fire on no data — the
    -- same ELSE-100 pattern four other RPCs in this schema already carry.
    CASE WHEN count(*) > 0
         THEN round(100.0 * count(*) FILTER (WHERE ev.results = 0) / count(*), 2) END,
    count(*) FILTER (WHERE ev.rescued IS NOT NULL)::bigint,
    count(cl.search_id)::bigint,
    CASE WHEN count(*) > 0
         THEN round(100.0 * count(cl.search_id) / count(*), 2) END,
    CASE WHEN count(*) > 0
         THEN round(100.0 * count(*) FILTER (WHERE cl.best_pos <= 5) / count(*), 2) END
  FROM ev LEFT JOIN cl ON cl.search_id = ev.search_id
  GROUP BY ev.d
  ORDER BY ev.d DESC;
$$;

REVOKE ALL ON FUNCTION public.get_search_quality(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_search_quality(integer) TO service_role;

-- WHAT PEOPLE SEARCH FOR AND DO NOT FIND — the queue that says what to fix next.
CREATE OR REPLACE FUNCTION public.get_top_search_misses(p_days integer DEFAULT 7, p_limit integer DEFAULT 50)
RETURNS TABLE (q text, searches bigint, zero_results bigint, clicks bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.q,
         count(*)::bigint,
         count(*) FILTER (WHERE e.results = 0)::bigint,
         count(c.id)::bigint
  FROM public.job_board_search_events e
  LEFT JOIN public.job_board_search_clicks c ON c.search_id = e.search_id
  WHERE e.at >= now() - make_interval(days => GREATEST(LEAST(p_days, 90), 1))
    AND e.q <> ''
    AND e.offset_n = 0
  GROUP BY e.q
  -- Worst first: most searched, least clicked.
  ORDER BY count(*) FILTER (WHERE e.results = 0) DESC, count(*) DESC
  LIMIT GREATEST(LEAST(p_limit, 500), 1);
$$;

REVOKE ALL ON FUNCTION public.get_top_search_misses(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_search_misses(integer, integer) TO service_role;