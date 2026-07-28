-- The Ghost Job Index publishes three numbers that its own methodology text
-- describes correctly and the SQL computes wrongly. The copy is right; the
-- data is what has to change.
--
-- 1. MEDIAN POSTING AGE IS OUR DISCOVERY TIME WEARING THE COMPANY'S LABEL.
--    Rendered: "9.6d — median age of an open posting, by the company's own
--    stated post date". Computed: median(now() - first_seen) over EVERY row,
--    with no posted_at predicate at all. first_seen is when WE first saw the
--    posting, which for a board that discovers a company mid-life is an
--    arbitrarily late proxy for what the employer stated.
--    Measured on 4,179 live rows carrying BOTH fields: the two bases differ by
--    17.6 days at the median, and 89.4% of rows have a company-stated date more
--    than 7 days older than first_seen. So the published figure materially
--    UNDERSTATES the real age — it flatters us.
--    This is the same defect class as the recorded 2.8d-median incident, and
--    the methodology glossary already promises the opposite in as many words:
--    "We never use our own discovery time as a posting age."
--
-- 2. THE QUALIFIER THAT WOULD HAVE CAUGHT IT IS DEAD CODE.
--    GhostJobIndex.tsx renders "— X% of postings state one; the rest are
--    excluded, never estimated" behind `stats?.posted_coverage_pct != null`.
--    posted_coverage_pct is not in the deployed RETURNS TABLE, so the clause has
--    never rendered, and the cache cannot supply it either — refresh_stats_cache
--    builds that key as row_to_json(get_ghost_job_index_stats()), so it is
--    structurally downstream of this signature. Users have only ever seen the
--    unqualified claim. Adding the column makes the caveat appear AND makes it
--    true: with the median now stated-date-only, "the rest are excluded" is a
--    description of the query rather than an aspiration.
--
-- 3. "TYPICAL TIME TO CLOSE" SILENTLY SUBSTITUTES first_seen.
--    Rendered: "Days between the company's stated post date and the moment its
--    feed stopped serving the posting — measured only where the post date is
--    stated." Computed: COALESCE(posted_at, first_seen), which admits undated
--    closures into the sample. Because first_seen is systematically LATER than
--    the stated date, the substitution shortens the interval and makes the
--    published 6.7d look better than the truth. Three vendors holding 56,426
--    open postings state no dates at all (bamboohr 43,835, rippling 8,830,
--    pinpoint 3,761), so their closures can ONLY enter through the fallback.
--
-- 4. THE COUNTS INCLUDE ROWS THE BOARD REFUSES TO SERVE.
--    total_open and get_date_coverage's per-vendor "Open postings" column are
--    bare count(*) over job_board_postings, while every serving path filters
--    `missing_since IS NULL` (migration 20260728120000, index.ts buildQuery).
--    That is why the cached total reads 581,314 against a served catalog of
--    579,219. A column headed "Open postings" on the transparency page must
--    mean the postings we will actually show you.
--
-- Undated postings are NOT dropped from the product by any of this — they stay
-- on the board and show no age, exactly as the glossary says. They are dropped
-- only from the AGE STATISTICS, which is what the page already claims.

DROP FUNCTION IF EXISTS public.get_ghost_job_index_stats();

CREATE FUNCTION public.get_ghost_job_index_stats()
RETURNS TABLE (
  total_open bigint,
  total_companies bigint,        -- feed tokens; kept so existing readers don't break
  total_company_names bigint,    -- distinct employers, boards merged by name
  closed_90d bigint,
  observed_days integer,
  median_days_open numeric,      -- stated post date ONLY
  median_days_to_close numeric,  -- stated post date ONLY
  posted_coverage_pct numeric    -- share of served postings that state a date
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH served AS (
    -- The board's own definition of servable, mirrored: index.ts buildQuery
    -- and both search RPCs filter missing_since IS NULL.
    SELECT posted_at FROM public.job_board_postings WHERE missing_since IS NULL
  )
  SELECT
    (SELECT count(*) FROM served),
    (SELECT count(DISTINCT company_token) FROM public.job_board_postings WHERE missing_since IS NULL),
    (SELECT count(DISTINCT company)
       FROM public.job_board_postings WHERE company <> '' AND missing_since IS NULL),
    (SELECT count(*) FROM public.job_board_closures WHERE closed_at > now() - interval '90 days'),
    (SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer
       FROM public.job_board_closures),
    -- Stated post date only. No COALESCE, no first_seen — an undated posting
    -- contributes nothing to an age statistic rather than contributing our own
    -- discovery time under the employer's name.
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY GREATEST(EXTRACT(EPOCH FROM (now() - posted_at)) / 86400.0, 0)))::numeric, 1)
     FROM served WHERE posted_at IS NOT NULL),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (closed_at - posted_at)) / 86400.0))::numeric, 1)
     FROM public.job_board_closures
     WHERE closed_at > now() - interval '90 days'
       AND posted_at IS NOT NULL
       AND closed_at >= posted_at),
    -- The denominator the reader needs to weigh the two medians above.
    -- NULL, not 0, if nothing is served: the UI must distinguish "none state a
    -- date" from "we have no idea".
    (SELECT CASE WHEN count(*) > 0
              THEN round(100.0 * count(posted_at) / count(*), 1) END
       FROM served);
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_job_index_stats() TO anon, authenticated;

-- The per-vendor table on the same page, headed "Open postings". Same rule:
-- count what we will actually serve. `dated` keeps its meaning (of the served
-- rows, how many state a date), so the published "State a post date" share
-- stays the honest ratio of the column beside it.
CREATE OR REPLACE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT source, count(*) AS total, count(posted_at) AS dated
  FROM public.job_board_postings
  WHERE missing_since IS NULL
  GROUP BY source
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;
