-- THE CHECK ANSWER HAD NO NUMBERS TO CHECK WITH — AND SAID SO ABOUT THE
-- EMPLOYER RATHER THAN ABOUT ITSELF.
--
-- /explore's first and only board-wide answer is "check an employer — and how
-- much of them we actually see". It reads three fields off each
-- get_company_suggest hit: how many of that employer's roles we hold, the
-- employer's own advertised total, and the day we read it. The function
-- returned (name, tokens) and nothing else, and no migration added the rest.
--
-- SO EVERY ONE OF THOSE THREE READS RESOLVED TO NULL, and the page did not
-- fall silent — it fell into its own refusal branch:
--
--     "We hold no dated reading of this employer's own total, so we cannot say
--      how much of their hiring is missing here."
--
-- That sentence is FALSE, and it is false about our own holdings rather than
-- about anything an employer did. job_board_verifications holds exactly that
-- dated reading; get_actively_hiring_companies already returns it as
-- feed_total / verified_at (20260907010000:442,450), which is where the
-- deleted "Hiring at scale" section read it from. An absent COLUMN is our
-- instrument; an absent READING is a fact about the record. The page had one
-- and published the other, on the answer that covers every board we carry.
--
-- WHAT open_roles IS. count(*) over the merged name's tokens under BOTH
-- serving predicates (missing_since IS NULL, effective_posted within 30 days),
-- so it is exactly what /jobs/company/{token} serves. It is NOT
-- companiesFacet.count, which this function has always refused to publish and
-- still does: that number applies neither predicate and would contradict the
-- page each hit links to. Summing across a merged name's tokens is safe in a
-- way summing feed_total is not — every token is counted in the same statement
-- at the same instant, against one definition.
--
-- WHY feed_total IS NULL FOR A MULTI-BOARD EMPLOYER, IN THE SQL AND NOT ONLY
-- IN THE PAGE. job_board_verifications keeps ONE ROW PER BOARD, UPSERTed on
-- every fetch, so it has no history: two boards' totals were read on two
-- different days and their sum is a figure with no date basis. The client
-- checks tokens.length === 1 as well. Two call sites for one rule is
-- deliberate here — the rule is the reason the number may be published at all,
-- and a later change to either side cannot quietly put a mixed-date sum on
-- screen while the other still refuses.
--
-- AND THE STAMP TRAVELS WITH THE NUMBER. feed_total without feed_total_at is a
-- figure that reads as current when it may be three weeks stale; a board that
-- went dark holds its last advertised total forever. The page's single guard
-- (feedTotalClaim) refuses on a null stamp, so returning the total without the
-- date would simply reinstate the silence this migration removes.
--
-- THIS ADDS AN AGGREGATE TO THE REQUEST PATH, WHICH THE OLD COMMENT ON
-- FORBADE, AND THE BOUND IS WHY THAT IS NOW ALLOWED. The forbidden thing was
-- the 26-second, whole-corpus aggregate that held a worker per page view. This
-- one runs over AT MOST EIGHT merged names, after the LIMIT, keyed on
-- job_board_postings_company_token_idx — the same shape and the same two
-- predicates get_company_hiring_health already runs for twelve tokens. The
-- match itself still comes off the cached facets row and still touches no
-- table but job_board_meta, so the typeahead's ranking cost is unchanged. The
-- 5s statement_timeout stays: if the count ever cannot be paid, the RPC errors,
-- and the page's tri-state lookup renders "employer lookup is unavailable"
-- rather than a claim about the employer.
--
-- DROP AND RECREATE, because the return type changes. The old signature is
-- dropped in the same statement block, so nothing can resolve to a definition
-- that returns two columns while the page reads five.

DROP FUNCTION IF EXISTS public.get_company_suggest(text);

CREATE OR REPLACE FUNCTION public.get_company_suggest(p_q text)
RETURNS TABLE(name text, tokens text[], open_roles int, feed_total int, feed_total_at timestamptz)
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
  ),
  -- THE ORDERING IS LIFTED INTO THE CTE UNCHANGED, and its three terms are
  -- carried out as columns so the outer SELECT can restate them. A LIMIT in a
  -- CTE fixes WHICH eight rows; only an ORDER BY on the outermost query fixes
  -- the order they arrive in, and the join below is free to reorder without
  -- one. The typeahead's order is the whole of its usefulness.
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
         -- OUR COUNT, UNDER BOTH SERVING PREDICATES. A FLOOR on the employer's
         -- own hiring, because paginated vendors are read a page at a time.
         (SELECT count(*)::int
            FROM public.job_board_postings p
           WHERE p.company_token = ANY (m.tokens)
             AND p.missing_since IS NULL
             AND p.effective_posted >= now() - interval '30 days') AS open_roles,
         -- SINGLE-BOARD EMPLOYERS ONLY. See the header: adding totals read on
         -- different days produces a number with no date basis.
         CASE WHEN array_length(m.tokens, 1) = 1 THEN v.feed_total END AS feed_total,
         CASE WHEN array_length(m.tokens, 1) = 1 THEN v.verified_at END AS feed_total_at
  FROM merged m
  LEFT JOIN public.job_board_verifications v
         ON array_length(m.tokens, 1) = 1
        AND v.company_token = m.tokens[1]
  ORDER BY m.prefix_hit DESC, m.name_len, m.top_c DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_suggest(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_company_suggest(text) IS
  'Typeahead over the cached companiesFacet, merged by display name, with the '
  'two counts the /explore check answer states. NEVER returns '
  'companiesFacet.count: that number applies NEITHER serving predicate and '
  'would contradict the page each hit links to. COLUMNS: name and tokens '
  '(every board we carry for that display name, worst-populated last); '
  'open_roles = count(*) across those tokens under BOTH serving predicates '
  '(missing_since IS NULL, effective_posted within 30 days), so it is exactly '
  'what /jobs/company/{token} serves — a POINT-IN-TIME count, and a FLOOR on '
  'the employer''s own hiring because paginated vendors are read a page at a '
  'time; feed_total = the employer''s OWN advertised opening count from '
  'job_board_verifications, and feed_total_at = the day we last read it. THE '
  'LAST TWO ARE NULL WHENEVER THE MERGED NAME CARRIES MORE THAN ONE TOKEN, '
  'because job_board_verifications is one row per board UPSERTed on every '
  'fetch and keeps no history, so two boards'' totals were read on two '
  'different days and their sum has no date basis. feed_total is never '
  'returned without feed_total_at for the same reason: a board that went dark '
  'holds its last advertised total forever and the bare number reads as '
  'current. THE TWO COUNTS ARE NOT DIVIDIBLE — ours is a floor on what we hold '
  'today, theirs is one dated reading of what they advertise, and their ratio '
  'is not a coverage percentage. THE AGGREGATE IS BOUNDED: the match and the '
  'ranking read one job_board_meta row, and the postings count runs only for '
  'the at-most-eight merged names that survive the LIMIT, keyed on '
  'job_board_postings_company_token_idx. It replaced a two-column version whose '
  'absent columns made the page publish "we hold no dated reading of this '
  'employer''s own total" — a false statement about our own record, on data '
  'get_actively_hiring_companies already returns.';

NOTIFY pgrst, 'reload schema';
