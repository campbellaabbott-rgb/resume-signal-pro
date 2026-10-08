-- A FIELD IS COMPARED WITH ITS OWN WEEK BEFORE ANYTHING IN IT CLOSED.
--
-- /hiring-trends' "Which fields are hiring this week" prints, per field,
-- (last7 - prior7) / prior7 from get_trending_categories. Both windows were
-- counted over SURVIVING job_board_postings rows only, and the prior week has
-- had seven more days of takedowns removed from that table than the last one
-- -- so nearly every field read as growing (register L11-10, still open from
-- 1.29). Live: 13 to 15 of the 15 fields up, finance +84%, healthcare +29 to
-- +50%, field sums +16 to +43%, while get_hiring_trends -- which adds the
-- closed postings back -- gave +0.6% for the matching full weeks.
--
-- THE FIX COUNTS EACH WINDOW THE WAY get_hiring_trends COUNTS A WEEK
-- (20261002113617): postings dated in the window and seen within three days
-- of that date, live rows plus the DISTINCT postings among the closure rows
-- that are not already counted live, by field. Doubted (suspect) closure rows
-- stay in that leg, as there: the doubt is about the takedown, never about
-- whether the employer dated the posting that week. Same-title re-lists stay
-- out, as there. Aged-out exits are not needed: both windows sit inside the
-- 30-day fence, so nothing dated in them has aged out. A closure row's empty
-- category reads as 'other', the live table's own default.
--
-- The closure leg is bounded on closed_at as well as posted_at so it can use
-- the closed_at index: a stored posted_at is never later than the moment it
-- was read (sanePostedAt in job-board/normalize.ts clamps a future date to
-- the read), and a closure row copies it and is written after that read, so
-- a closure of a posting dated inside the last fourteen days was written
-- inside them too. The bound carries one day of margin for clock skew.
--
-- Shape, signature, SECURITY DEFINER, the tenure gate on prior7, the
-- twenty-posting floor and the fifteen-row limit are unchanged, so this is a
-- CREATE OR REPLACE that keeps the oid; the grants are restated and the
-- census status (client-callable, allowlisted) is unchanged. The header rises
-- from 20s to 60s, the weekly series' own figure, because the closure leg is
-- new work and a timeout inside the hourly refresh is silent.

CREATE OR REPLACE FUNCTION public.get_trending_categories()
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '60s' AS $$
  WITH excluded AS (SELECT company_token FROM public.showcase_excluded),
  live AS (
    SELECT p.category AS cat, p.posted_at
    FROM public.job_board_postings p
    WHERE p.posted_at IS NOT NULL AND p.posted_at > now() - interval '14 days'
      AND p.first_seen - p.posted_at < interval '3 days'
      AND p.company_token NOT IN (SELECT company_token FROM excluded)
  ),
  closed AS (
    SELECT DISTINCT ON (c.posting_id)
           COALESCE(NULLIF(c.category, ''), 'other') AS cat, c.posted_at
    FROM public.job_board_closures c
    WHERE c.posted_at IS NOT NULL AND c.posted_at > now() - interval '14 days'
      AND c.closed_at > now() - interval '15 days'
      AND NOT c.superseded
      AND c.first_seen IS NOT NULL AND c.first_seen - c.posted_at < interval '3 days'
      AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
      AND c.company_token NOT IN (SELECT company_token FROM excluded)
      AND NOT EXISTS (
        SELECT 1 FROM public.job_board_postings p
        WHERE p.id = c.posting_id
          AND p.posted_at IS NOT NULL AND p.posted_at > now() - interval '14 days'
          AND p.first_seen - p.posted_at < interval '3 days')
    ORDER BY c.posting_id, c.closed_at
  ),
  dated AS (
    SELECT l.cat, l.posted_at FROM live l
    UNION ALL
    SELECT k.cat, k.posted_at FROM closed k
  )
  SELECT d.cat AS category,
    (count(*) FILTER (WHERE d.posted_at > now() - interval '7 days'))::int AS last7,
    CASE WHEN (SELECT min(closed_at) FROM public.job_board_closures
                 WHERE absence_basis IS DISTINCT FROM 'lap_backfill') <= now() - interval '14 days'
         THEN (count(*) FILTER (WHERE d.posted_at <= now() - interval '7 days'))::int
         ELSE NULL END AS prior7
  FROM dated d
  GROUP BY d.cat
  HAVING count(*) FILTER (WHERE d.posted_at > now() - interval '7 days') >= 20
  ORDER BY 2 DESC LIMIT 15;
$$;
COMMENT ON FUNCTION public.get_trending_categories() IS
  'Fields by new postings dated in the last seven days, with the seven days '
  'before as a comparison, each window counted the way get_hiring_trends counts '
  'a week (20261008111500): postings dated in the window and seen within three '
  'days of that date, live rows plus the DISTINCT postings among closure rows '
  'not already counted live. Counted over surviving rows alone, the prior '
  'window had lost seven more days of takedowns than the last and nearly every '
  'field read as growing (finance +84% beside +0.6% overall). Same-title '
  're-lists are excluded; doubted takedowns stay, because the doubt is about '
  'the takedown, not the posting date. SECURITY DEFINER: it reads '
  'job_board_closures, which is service_role-only, and an INVOKER version '
  'publishes emptiness with a 200 (20260820174500). prior7 is NULL until the '
  'closure log is fourteen days old (min(closed_at), a TENURE). '
  'ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. It is a count of events, '
  'never a dated one -- see COMMENT ON COLUMN '
  'public.job_board_closures.absence_basis, and get_closure_population() '
  'for how many such rows exist.';
REVOKE ALL ON FUNCTION public.get_trending_categories() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trending_categories() TO anon, authenticated, service_role;

DO $$
DECLARE n int; f oid; src text; definer boolean; cfg text[];
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_trending_categories';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_trending_categories: expected exactly one definition, found %', n;
  END IF;
  SELECT p.oid, p.prosrc, p.prosecdef, p.proconfig INTO f, src, definer, cfg
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_trending_categories';
  IF NOT definer THEN
    RAISE EXCEPTION 'get_trending_categories: not SECURITY DEFINER, so anon reads an empty ledger';
  END IF;
  IF src NOT LIKE '%public.job_board_closures c%' OR src NOT LIKE '%DISTINCT ON (c.posting_id)%' THEN
    RAISE EXCEPTION 'get_trending_categories: the closed postings are not added back to each window';
  END IF;
  IF cfg IS NULL OR NOT ('statement_timeout=60s' = ANY(cfg)) THEN
    RAISE EXCEPTION 'get_trending_categories: re-created without its sixty-second header: %', cfg;
  END IF;
  IF NOT has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_trending_categories: the page''s roles cannot execute it';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
