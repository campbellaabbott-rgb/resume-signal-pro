-- DOMINO'S JOINS THE BOARD AND LEAVES THE EDITORIAL STATS.
--
-- 24,566 postings, ~4% of the board from one franchise brand. It passes every
-- merge-protocol rule — verified feed, direct employer, corporate, strong mill
-- clear — and was held since 2026-08-07 on a judgment the protocol cannot make.
-- Measured on the live feed 2026-08-10, 400 postings sampled across four
-- offsets: 387/400 are store roles (Delivery Driver, Customer Service Rep,
-- Assistant Manager), 1/400 corporate, 318 distinct locations, ~4 real title
-- archetypes stamped with store numbers. Genuine vacancies at genuine stores —
-- and utterly unlike the rest of the corpus.
--
-- THE LINE THIS DRAWS, and it is the whole design:
--
--   SERVING surfaces stay INCLUSIVE. Search, filters, category and company
--   facets, total_open, the Ghost Job Index counts. If a person searches
--   "delivery driver" they should find these, and every published count must
--   keep agreeing with what the board actually serves. Excluding Domino's from
--   a count while serving it is precisely the two-numbers-for-one-quantity
--   bug this codebase spent yesterday removing from the homepage.
--
--   EDITORIAL surfaces EXCLUDE. Rankings, trends, segments, "who is hiring" —
--   claims ABOUT the market rather than inventory OF it. One brand posting
--   24.6k store roles would make hospitality_retail "trend" on its own and
--   bend the weekly new-postings line, which says something false about
--   hiring while every underlying row stays true.
--
-- showcase_excluded is the existing, correct mechanism ("curated, verified;
-- board/search unaffected" — 20260721330000). Two of the four editorial
-- functions already filter on it; this adds Domino's to the table and extends
-- the same filter to the two that were missing it.
--
-- A NOTE FOR WHOEVER READS THIS ROW LATER: every other token in this table is
-- excluded for being a staffing agency or a spam board. Domino's is not. Its
-- reason says so explicitly, because "found in showcase_excluded" must not be
-- misread as "judged a mill" — it would be a slur on a real employer and a
-- false precedent for the next concentration call.

INSERT INTO public.showcase_excluded (company_token, reason) VALUES
  ('dominos',
   'NOT a mill — a verified direct employer whose postings are real per-store '
   'vacancies. Excluded from editorial stats on CONCENTRATION alone: 24,566 '
   'postings, ~4% of the board, ~97% of them the same four store roles, which '
   'would make one brand look like a market trend. Fully served in search, '
   'filters and every corpus count.')
ON CONFLICT (company_token) DO UPDATE SET reason = EXCLUDED.reason;

-- ── trending categories: a brand must not be able to trend a category ──────
--
-- Unchanged except for the exclusion: same 14-day window, same 3-day
-- observation guard (first_seen - posted_at < 3 days keeps backfilled history
-- out of "new"), same >= 20 floor, same prior7 NULL until the closure record
-- spans 14 days.
CREATE OR REPLACE FUNCTION public.get_trending_categories()
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT category,
    (count(*) FILTER (WHERE posted_at > now() - interval '7 days'))::int AS last7,
    CASE WHEN (SELECT min(closed_at) FROM public.job_board_closures) <= now() - interval '14 days'
         THEN (count(*) FILTER (WHERE posted_at <= now() - interval '7 days'))::int
         ELSE NULL END AS prior7
  FROM public.job_board_postings
  WHERE posted_at IS NOT NULL AND posted_at > now() - interval '14 days'
    AND first_seen - posted_at < interval '3 days'
    -- Editorial surface: a category that "trends" because one franchise
    -- brand listed its stores is a claim about hiring that is not true.
    AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  GROUP BY category
  HAVING count(*) FILTER (WHERE posted_at > now() - interval '7 days') >= 20
  ORDER BY 2 DESC LIMIT 15;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_categories() TO anon, authenticated;

-- ── hiring trends: the weekly line describes the market, not one brand ─────
--
-- Unchanged except for the exclusion, applied to ALL THREE legs — live
-- postings, already-closed postings, and closures. Filtering only the live leg
-- would have made the survivorship correction lopsided: closures from an
-- excluded board would still count, so its weeks would show closes without the
-- posts that produced them, which reads as a hiring collapse that never
-- happened.
CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  WITH excluded AS (SELECT company_token FROM public.showcase_excluded),
  epoch AS (
    SELECT date_trunc('week', min(closed_at))::date AS w0 FROM public.job_board_closures
  ),
  weeks AS (
    SELECT date_trunc('week', d)::date AS week_start
    FROM generate_series(date_trunc('week', now() - interval '28 days'), now(), interval '1 week') d
    WHERE date_trunc('week', d)::date >= COALESCE((SELECT w0 FROM epoch), date_trunc('week', now())::date)
  ),
  posted_live AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n,
      (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_new,
      (count(*) FILTER (WHERE remote))::int AS remote_new
    FROM public.job_board_postings
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND first_seen - posted_at < interval '3 days'
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  ),
  posted_closed AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n
    FROM public.job_board_closures
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND NOT superseded
      AND first_seen IS NOT NULL AND first_seen - posted_at < interval '3 days'
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  ),
  closes AS (
    SELECT date_trunc('week', closed_at)::date AS w, count(*)::int AS closed
    FROM public.job_board_closures
    WHERE closed_at > now() - interval '35 days' AND NOT superseded
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  )
  SELECT weeks.week_start,
         COALESCE(posted_live.n, 0) + COALESCE(posted_closed.n, 0),
         COALESCE(posted_live.entry_new, 0),
         COALESCE(posted_live.remote_new, 0),
         COALESCE(closes.closed, 0)
  FROM weeks
  LEFT JOIN posted_live   ON posted_live.w   = weeks.week_start
  LEFT JOIN posted_closed ON posted_closed.w = weeks.week_start
  LEFT JOIN closes        ON closes.w        = weeks.week_start
  ORDER BY weeks.week_start;
$$;
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated;

-- ── velocity: keep a 24.6k-posting giant out of the hot tier ───────────────
--
-- The hot tier re-fetches its boards every ~10-15 minutes and is sized for
-- giants two at a time (HOT_CONCURRENCY = 2 — "two multi-MB parses at once is
-- the memory ceiling"). Domino's would enter it twice over: top of the size
-- ranking outright, and top of the velocity ranking too, since per-store roles
-- churn constantly.
--
-- The trade is deliberate. A delivery-driver vacancy does not need
-- quarter-hourly re-verification; the cold rotation's ~3-5h wrap is well
-- inside what that role's lifetime warrants, and the slot it would have taken
-- goes to a board where a stale posting costs a candidate a real application.
-- Excluded boards keep full cold-tier refresh — this caps cadence, never
-- coverage.
CREATE OR REPLACE FUNCTION public.get_board_velocity(days integer DEFAULT 7, top_n integer DEFAULT 40)
RETURNS TABLE (company_token text, recent bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.company_token, count(*)::bigint AS recent
  FROM public.job_board_postings p
  WHERE p.first_seen > now() - make_interval(days => GREATEST(LEAST(days, 30), 1))
    AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  GROUP BY p.company_token
  HAVING count(*) >= 3
  ORDER BY recent DESC
  LIMIT GREATEST(LEAST(top_n, 200), 1);
$$;
REVOKE ALL ON FUNCTION public.get_board_velocity(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_velocity(integer, integer) TO service_role;

-- Refresh the editorial half of the cache so the corrected trends serve now
-- rather than at the next :12 tick. Best effort: the cron is the backstop and
-- a migration must not fail over a stat recompute.
DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_stats_cache();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'stats cache refresh deferred to cron: %', SQLERRM;
END $$;
