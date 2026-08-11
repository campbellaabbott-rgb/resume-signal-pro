-- "WILL ACTUALLY HIRE ME" WAS RANKING BY SIZE AND CALLING IT A FILL RECORD.
--
-- get_actively_hiring_companies orders by `f.filled DESC` — the ABSOLUTE number
-- of roles an employer filled. Under a chip that promises "will actually hire
-- me", that is a list of the biggest employers on the board wearing a lifecycle
-- badge. An employer that filled 40 of its 60 open roles cannot outrank one
-- that filled 400 of 12,000, though it is dramatically more likely to hire you.
--
-- Worse, it could not even enter the running. The `fills` CTE applied
--
--     ORDER BY 3 DESC LIMIT GREATEST(p_limit, 1) * 3
--
-- BEFORE the open-roles lateral ran, so the candidate pool was already cut to
-- the 60 employers with the most raw fills. Re-sorting those 60 by any ratio
-- would change the order of a list that had already excluded every small
-- employer. The truncation, not the ORDER BY, is what made the tail impossible.
--
-- THREE CHANGES.
--
-- 1. ONE GROUPED SCAN INSTEAD OF N LATERAL COUNTS. `open_now` aggregates served
--    postings per company in a single pass, so the pre-truncation is not needed
--    to keep the query affordable — it existed to bound how many lateral counts
--    ran. Every qualifying employer now reaches the ranking. One hash aggregate
--    over the served slice costs less than sixty index lookups, and vastly less
--    than the thousands the honest version would have needed.
--
-- 2. RANK BY FILLS PER 100 OPEN ROLES, with a >=10 open-roles floor. Below that
--    the ratio is noise (3 fills against 4 open roles is not a 75% hiring rate,
--    it is an employer winding down), and the >=3 completed fills and
--    churn-disqualification floors from the original are untouched.
--
-- 3. THE CARD GETS A CLOCK. p50_days_open is the median days a FILLED role
--    stayed up before coming down — "half the roles this employer filled came
--    down within 18 days" is the most decision-changing sentence available
--    here, and it requires having owned the fetch on both days, which is
--    precisely what no competitor can copy.
--
--    Computed from posted_at ALONE, never COALESCE(posted_at, first_seen).
--    The COALESCE is correct as a FILTER — it is how the 7-day floor tolerates
--    undated rows — but as the source of a published median it silently
--    substitutes our discovery time for the employer's posting date, which is
--    exactly the 2.8-day-median incident. dated_n rides alongside so the card
--    can state its own sample, and the frontend shows the clock only when the
--    sample is real.
--
-- AND A FOURTH, FOUND WHILE READING: `span` computed tracking_days from
-- min(closed_at) over the ENTIRE closure log with no company filter, so every
-- card reported the same window. "479 filled in 27d tracked" reads as a fact
-- about that employer and was a fact about our log. Same defect as
-- get_company_hiring_health carried until 20260811223000 — the second place it
-- was written, found by looking rather than by a failure.
CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (
  company text, company_token text, closed_90d bigint, open_roles bigint,
  tracking_days int, p50_days_open numeric, dated_n int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
-- Raised from 15s: the grouped scan replaces the lateral, and this now runs
-- over every qualifier rather than a pre-cut 60. Still cron-side, still inside
-- refresh_explore_cache's 10-minute budget.
SET statement_timeout = '60s'
AS $$
  WITH open_now AS (
    -- SERVED postings only, matching what /jobs/company/{token} shows, so the
    -- card's "open now" and its destination are one number.
    SELECT company_token, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  fills AS (
    SELECT c.company_token, max(c.company) AS company,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) AS filled,
           -- PER COMPANY. This was min(closed_at) over the whole table.
           LEAST(GREATEST(EXTRACT(DAY FROM now() - min(c.closed_at))::int, 1), 30) AS tracking_days,
           -- posted_at only. See the note above on the 2.8-day median.
           round((percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (c.closed_at - c.posted_at)) / 86400.0
           ) FILTER (
             WHERE NOT c.superseded
               AND c.posted_at IS NOT NULL
               AND c.closed_at - c.posted_at >= interval '7 days'
           ))::numeric, 0) AS p50_days_open,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.posted_at IS NOT NULL
               AND c.closed_at - c.posted_at >= interval '7 days'
           )::int AS dated_n
    FROM public.job_board_closures c
    WHERE c.closed_at > now() - interval '30 days'
      AND c.company <> ''
      AND c.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY c.company_token
    HAVING count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) >= 3
       AND count(*) FILTER (WHERE c.superseded)
           <= count(*) FILTER (
                WHERE NOT c.superseded
                  AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
              )
    -- NO pre-truncation. Cutting to the top 60 by raw fills here is what made
    -- every small employer unrankable no matter how the final ORDER BY read.
  )
  SELECT f.company, f.company_token, f.filled AS closed_90d, o.n::bigint AS open_roles,
         f.tracking_days, f.p50_days_open, f.dated_n
  FROM fills f
  JOIN open_now o ON o.company_token = f.company_token
  -- >=100 OPEN ROLES, AND THE NUMBER IS MEASURED, NOT CHOSEN.
  --
  -- The first draft floored at 10, which fixed "ranks by size" into something
  -- that ranked by SMALLNESS: a small denominator makes the ratio explode, so
  -- the answer to "who will actually hire me" became a list of the tiniest
  -- boards on it. Measured over the 300 top-filling employers before setting
  -- this:
  --
  --     floor   eligible   top ratio   of the top 12, how many had <100 open
  --       10        300        580%              12 of 12
  --       25        121        468%              10 of 12
  --       50         64        456%               8 of 12
  --      100         25        251%               0 of 12
  --      150          7          —        too few to fill twelve slots
  --
  -- Median open_roles among qualifiers is 21, so a floor of 10 admits nearly
  -- everyone and hands the ranking to whoever has the fewest live roles.
  -- 100 is the only value that both fills the list and leaves no card that a
  -- reader would find trivially small. 25 is a LOWER bound on the eligible
  -- pool: the sample was the top 300 by absolute fills, so employers with 100+
  -- open roles and modest fill counts were never in it.
  WHERE o.n >= 100
  -- THE RATIO ORDERS THE LIST; IT IS NEVER PRINTED. "251 fills per 100 open
  -- roles" is arithmetically true and reads as nonsense — it is a throughput-
  -- to-inventory ratio, not a probability, and a reader would take it as one.
  -- The card states both raw numbers ("342 filled in 27d tracked · 75 open
  -- now") and lets them judge. A number good enough to sort by is not
  -- automatically a number worth publishing.
  ORDER BY (f.filled * 100.0 / o.n) DESC, f.filled DESC
  LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.get_actively_hiring_companies(int) IS
  'Employers ranked by FILLS PER 100 SERVED OPEN ROLES, not by absolute fills — '
  'the latter ranked by size under a chip promising a fill record, and its '
  'pre-truncation to the top 60 meant no small employer could place at all. '
  'p50_days_open is the median days a filled role stayed up, from posted_at '
  'ALONE (COALESCE with first_seen publishes our discovery time as the '
  'employer''s posting date). tracking_days is per company; it was the age of '
  'the entire closure log.';

NOTIFY pgrst, 'reload schema';
