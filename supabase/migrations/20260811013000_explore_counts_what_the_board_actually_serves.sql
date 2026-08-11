-- EXPLORE COUNTS A POPULATION NO READER CAN REACH, AND ONE HEADING IS ARITHMETICALLY FALSE.
--
-- The board serves `missing_since IS NULL AND effective_posted >= now() - 30
-- days`. get_transparent_employers was corrected to match on 2026-08-10; its
-- five siblings on the same page were not. Measured against production today,
-- none of them carry either predicate, so every count on Explore is taken over
-- postings the board itself refuses to show. A card reads "412 open now", the
-- reader clicks it, and /jobs/company/{token} — which does apply both
-- predicates — shows fewer, with nothing explaining the gap.
--
-- THE BAND HEADINGS ARE THE WORST CASE, AND THAT ONE IS MINE. On 2026-08-10 I
-- replaced the false "Enterprise — 1,000+ employees" labels with "1,000+ open
-- roles" and wrote a blurb promising "how many roles each company currently has
-- open on our board". I did not change the banding, which is still
--
--     GREATEST(sum(on_board), sum(feed_total))   -- feed_total = the company's
--                                                -- OWN ADVERTISED total
--
-- so the heading describes one quantity and the stat line under it renders
-- another. Live, right now:
--
--     mega: 223 companies · 133,129 open roles   = 597 roles per company
--
-- 597 average, printed immediately beneath "1,000+ open roles". Companies enter
-- the band with as few as 3 on-board postings. I fixed the label and left the
-- measurement, which is the same defect wearing the other shoe.
--
-- Banding now uses sum(on_board) — what we serve, which is what the label and
-- the blurb both say. `company_total` still rides on each card as "· N
-- company-wide", so the advertised figure is not lost, merely stopped from
-- deciding a heading it contradicts.
--
-- NOT INCLUDED, DELIBERATELY: get_trending_companies and get_newest_companies.
-- Their open_roles comes from job_board_company_snapshots, not from postings,
-- so the fix belongs in the snapshot writer. Changing it would make today's
-- snapshot served-only while every prior row still counts everything, and
-- trending is a DIFFERENCE across those rows (n.open_roles - b.open_roles) —
-- every company would show a fabricated collapse for 7-14 days until the
-- baseline aged out. That needs a backfill plan, not a predicate.

-- ── 1. size segments: serve-only, banded on what the label claims ─────────
CREATE OR REPLACE FUNCTION public.get_size_segments()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH co AS (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int AS on_board,
           -- work_mode = 'remote', NOT the legacy `remote` boolean. The board's
           -- own serving code records that remote=true is a strict SUBSET of
           -- work_mode='remote' (job-board/index.ts:5424-5429, measured 5.2%-
           -- 11.3% narrower). The sentence this feeds says "% remote of the N
           -- that state a work mode", so the numerator must be drawn from the
           -- same column as the denominator or the ratio is of two populations.
           count(*) FILTER (WHERE p.work_mode = 'remote')::int AS remote_n,
           count(*) FILTER (WHERE p.work_mode IS NOT NULL)::int AS disclosed_n,
           count(*) FILTER (WHERE p.experience_band = 'entry')::int AS entry_n,
           COALESCE(v.feed_total, 0) AS feed_total
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    WHERE p.company <> ''
      AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY p.company_token, v.feed_total
    HAVING count(*) >= 3
  ),
  named AS (
    SELECT company,
           (array_agg(company_token ORDER BY on_board DESC))[1] AS company_token,
           sum(on_board)::int AS on_board,
           -- THE NUMBER THE CLICK ACTUALLY DELIVERS.
           -- This CTE merges an employer's several ATS feeds by display name so
           -- PwC (four feeds) appears once, summing on_board but keeping ONE
           -- token — and the card links to /jobs/company/{that token}, which
           -- filters on it alone. So the card promised the summed figure and
           -- the destination showed one feed's worth, with nothing explaining
           -- the gap. The band still uses the summed count (the employer really
           -- is that big); the CARD now states the lead feed's own count, which
           -- is what the reader will find. Because the token is picked
           -- ORDER BY on_board DESC, that count is max(on_board).
           max(on_board)::int AS lead_on_board,
           sum(remote_n)::int AS remote_n,
           sum(disclosed_n)::int AS disclosed_n,
           sum(entry_n)::int AS entry_n,
           NULLIF(sum(feed_total), 0)::int AS company_total,
           -- WAS GREATEST(sum(on_board), sum(feed_total)). That put a company
           -- with 180 served postings and a 1,200-job advertised feed under a
           -- heading reading "1,000+ open roles", beside its own badge reading
           -- "180 on our board".
           sum(on_board)::int AS effective
    FROM co GROUP BY company
  ),
  banded AS (
    SELECT *, CASE
      WHEN effective >= 1000 THEN 'mega'
      WHEN effective >= 200  THEN 'large'
      WHEN effective >= 50   THEN 'mid'
      ELSE 'small' END AS band
    FROM named
  ),
  sal AS (
    SELECT b.band,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS median_usd_floor,
           count(*)::int AS usd_n
    FROM public.job_board_postings p
    JOIN co ON co.company_token = p.company_token
    JOIN banded b ON b.company = co.company
    WHERE p.salary_currency = 'USD' AND p.salary_min_annual IS NOT NULL AND p.salary_min_annual > 0
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
    GROUP BY b.band
  ),
  agg AS (
    SELECT band,
           count(*)::int AS companies,
           sum(on_board)::int AS open_roles,
           sum(disclosed_n)::int AS disclosed_n,
           CASE WHEN sum(disclosed_n) > 0
                THEN round(100.0 * sum(remote_n) / sum(disclosed_n), 0) END AS remote_pct,
           CASE WHEN sum(on_board) > 0
                THEN round(100.0 * sum(disclosed_n) / sum(on_board), 0) END AS disclosed_pct,
           round(100.0 * sum(entry_n) / GREATEST(sum(on_board), 1), 0) AS entry_pct
    FROM banded GROUP BY band
  ),
  top AS (
    SELECT band, jsonb_agg(jsonb_build_object(
             'company', company, 'company_token', company_token,
             -- lead_on_board, not on_board: see the note in `named`. The card
             -- and the page it links to must state one number.
             'on_board', lead_on_board, 'company_total', company_total)
             ORDER BY effective DESC) AS top
    FROM (
      SELECT *, row_number() OVER (PARTITION BY band ORDER BY effective DESC) AS rn
      FROM banded
    ) r WHERE rn <= 12
    GROUP BY band
  )
  SELECT jsonb_object_agg(a.band, jsonb_build_object(
           'companies', a.companies, 'open_roles', a.open_roles,
           'remote_pct', a.remote_pct, 'disclosed_pct', a.disclosed_pct,
           'disclosed_n', a.disclosed_n, 'entry_pct', a.entry_pct,
           'median_usd_floor', s.median_usd_floor, 'usd_n', s.usd_n,
           'top', COALESCE(t.top, '[]'::jsonb)))
  FROM agg a
  LEFT JOIN sal s ON s.band = a.band
  LEFT JOIN top t ON t.band = a.band;
$$;

-- ── 2. actively hiring: the open-roles lateral had no predicate at all ────
CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (company text, company_token text, closed_90d bigint, open_roles bigint, tracking_days int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH span AS (
    SELECT LEAST(GREATEST(EXTRACT(DAY FROM now() - min(closed_at))::int, 1), 30) AS days
    FROM public.job_board_closures
  ),
  fills AS (
    SELECT c.company_token, max(c.company) AS company,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) AS filled,
           count(*) FILTER (WHERE c.superseded) AS churn
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
    ORDER BY 3 DESC
    LIMIT GREATEST(p_limit, 1) * 3
  )
  SELECT f.company, f.company_token, f.filled AS closed_90d, o.n AS open_roles,
         (SELECT days FROM span) AS tracking_days
  FROM fills f
  JOIN LATERAL (
    -- This lateral was `WHERE p.company_token = f.company_token` and nothing
    -- else, so the "open now" figure beside a fill count included every dropped
    -- and expired posting the company had ever carried.
    SELECT count(*) AS n FROM public.job_board_postings p
    WHERE p.company_token = f.company_token
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  ) o ON true
  WHERE o.n > 0
  ORDER BY f.filled DESC, o.n DESC
  LIMIT GREATEST(p_limit, 1);
$$;

-- ── 3. entry level ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_entry_level_companies(p_limit int DEFAULT 25)
RETURNS TABLE (company text, company_token text, entry_roles int, open_roles int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT company, company_token,
    (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_roles, count(*)::int AS open_roles
  FROM public.job_board_postings
  WHERE company <> ''
    AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    AND missing_since IS NULL
    AND effective_posted >= now() - interval '30 days'
  GROUP BY company, company_token
  HAVING count(*) FILTER (WHERE experience_band = 'entry') >= 5
  ORDER BY 3 DESC LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

-- ── 4. salary benchmarks ─────────────────────────────────────────────────
--
-- REPLACED FROM THE LIVE DEFINITION, NOT FROM THE LATEST FILENAME. The
-- highest-sorting migration defining this function
-- (20260716001421_c46696e9…, a Lovable hash-stamped re-stamp) carries an OLDER
-- body with no currency column at all. Production emits `currency` — verified
-- by reading the live explore cache — so the deployed function is the one from
-- 20260715200000_salary_currency.sql despite that file sorting earlier. Lovable
-- re-stamps old content with new timestamps, so filename order does not track
-- what is deployed. Rebuilding from the currency-less body would have silently
-- reverted per-currency medians and made the page's "Never converted, never
-- mixed" promise false.
CREATE OR REPLACE FUNCTION public.get_salary_benchmarks()
RETURNS TABLE (category text, currency text, n integer, median_annual_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH per AS (
    SELECT category,
           salary_currency AS currency,
           count(*)::int AS n,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_annual_min
    FROM public.job_board_postings
    WHERE salary_min_annual IS NOT NULL AND salary_currency IS NOT NULL
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY category, salary_currency
    HAVING count(*) >= 30
  )
  SELECT DISTINCT ON (category) category, currency, n, median_annual_min
  FROM per
  ORDER BY category, n DESC;
$$;

COMMENT ON FUNCTION public.get_size_segments() IS
  'Explore size bands. Counts ONLY served postings (missing_since IS NULL and '
  'effective_posted within 30 days) and bands on sum(on_board), so the heading '
  '"1,000+ open roles" describes the same quantity the stat line under it '
  'renders. Banding on GREATEST(on_board, feed_total) put 597-role-average '
  'companies under a 1,000+ heading.';

-- Recompute now so the corrected numbers serve immediately rather than at the
-- next tick. Best effort: the cron is the backstop.
DO $$
BEGIN
  SET LOCAL statement_timeout = '9min';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'explore cache refresh deferred to cron: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
