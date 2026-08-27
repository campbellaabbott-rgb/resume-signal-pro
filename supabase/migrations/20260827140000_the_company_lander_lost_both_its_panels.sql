-- Two RPCs behind every company lander have been timing out, and failing invisibly.
--
-- get_similar_companies ("Also hiring in {field}") and get_company_intel both
-- answer 57014 "canceling statement due to statement timeout" on every token
-- tried, burning their full 15s budget first. Measured 2026-08-27 with the anon
-- key against real tokens sampled from the table:
--
--   get_similar_companies  meijer~wd5~Meijer_Stores_Hourly   500 57014  15.46s
--   get_company_intel      meijer~wd5~Meijer_Stores_Hourly   500 57014  15.23s
--   get_company_intel      lumafield                          500 57014  15.28s
--
-- THE COMMON ELEMENT IS AN UNINDEXABLE PREDICATE. Both filter with
--   WHERE split_part(p.company_token, '~', 1) = split_part(p_token, '~', 1)
-- which groups a company's several Workday sites under one slug
-- ('meijer~wd5~Meijer_Stores_Hourly' -> 'meijer'). It is the right rule and the
-- wrong shape: an expression predicate cannot use
-- job_board_postings_company_token_idx, the plain btree on the whole token, so
-- each call seq-scans 708k rows.
--
-- ISOLATED, not inferred. Called with a slug that matches NOTHING, the `sim`
-- CTE's `p.category = (SELECT category FROM dom)` resolves to `= NULL` and can
-- return nothing at all — so the only work left is the slug scan in `dom`:
--
--   {"p_token":"zzzz-no-such-company-zzzz"}  ->  500 57014  15.49s
--
-- The slug scan alone exhausts the budget. Confirming there is nothing to use:
-- `grep split_part supabase/migrations/*.sql | grep -i index` is empty, and an
-- eq() on the FULL token returns 1,247 rows in 0.28s while a prefix LIKE on the
-- same column times out — the plain btree is present and healthy and simply
-- cannot serve this.
--
-- IT FAILS SILENTLY, WHICH IS WHY IT SURVIVED. SimilarCompanies.tsx:29-33
-- destructures only `data` and discards `error`, and supabase-js resolves
-- rather than throws on a 500 unless throwOnError is set (it is not). So `data`
-- is null, Array.isArray(null) is false, rows stays [], and `if (rows.length
-- === 0) return null` renders nothing — pixel-identical to "this company has no
-- peers". No console line, no toast, no empty state, on all ~23,300 company
-- landers. Every lander view, Googlebot included, also pinned a backend for a
-- full 15 seconds first: a self-inflicted load generator against the database
-- that serves the board.
--
-- AND THE NUMBER IT PRINTS IS WRONG. Neither function carries either serving
-- fence, while SimilarCompanies renders the value as "{{n}} open roles".
-- Decomposed on one token (cutoff = now() - 30 days):
--
--   company_token = meijer~wd5~Meijer_Stores_Hourly ............ 1247   <- printed
--   ... AND missing_since IS NULL ..............................  645
--   ... AND effective_posted >= cutoff .........................  615   <- honest
--
-- 2.03x, and missing_since does 95% of the correction. Across eight sampled
-- tokens the inflation runs 1.00x to 2.25x — it is company-dependent, so no
-- constant could have been used to explain it away. A card would advertise more
-- roles than the lander it links to can show.

-- PLAIN CREATE INDEX, NOT CONCURRENTLY, and DROP FIRST. Both points are settled
-- policy for this table, argued at length in 20260826010000:54-68 — the
-- migration runner wraps each file in a transaction where CONCURRENTLY raises
-- 25001 and applies nothing, and the pg_cron one-shot written to work around
-- that has a bad record here (20260821190000 documents an index that silently
-- never built because a schedule and its unschedule shipped in one push, a
-- failure indistinguishable from success). DROP IF EXISTS takes no lock on a
-- nonexistent index, so it is free in the expected case and self-healing if a
-- previous attempt left an INVALID index behind.
--
-- BOTH ARE PARTIAL ON `missing_since IS NULL`. That is what makes them
-- affordable on a 708k-row table that already carries many indexes: they cover
-- only the ~593k serving rows and are maintained only for those.
SET LOCAL lock_timeout = '20s';
SET LOCAL statement_timeout = '20min';
SET LOCAL maintenance_work_mem = '256MB';

-- Serves `dom` and get_company_intel's `posts`: the slug lookup, inside the
-- serving set. split_part(text, text, integer) is IMMUTABLE, so it is indexable.
DROP INDEX IF EXISTS public.job_board_postings_slug_serving_idx;
CREATE INDEX job_board_postings_slug_serving_idx
  ON public.job_board_postings ((split_part(company_token, '~', 1)), category, effective_posted)
  WHERE missing_since IS NULL;

-- Serves `agg`: per-category grouping by token without touching the heap.
-- company is INCLUDEd because the aggregate takes max(company) over every row
-- in the category, not just the survivors — without it this is ~124k heap
-- fetches for the largest category.
DROP INDEX IF EXISTS public.job_board_postings_cat_token_serving_idx;
CREATE INDEX job_board_postings_cat_token_serving_idx
  ON public.job_board_postings (category, company_token, effective_posted)
  INCLUDE (company)
  WHERE missing_since IS NULL;

ANALYZE public.job_board_postings;

-- BOTH FENCES IN BOTH CTEs, and the company_profiles join moved AFTER the
-- aggregation so it runs on at most p_limit tokens instead of every posting in
-- the category. Everything that decides WHICH companies come back — the slug
-- exclusion, company <> '', the showcase_excluded anti-join, HAVING count(*) >= 3,
-- the ORDER BY and the LIMIT — stays inside the aggregate, so semantics are
-- unchanged apart from the intended fence correction.
--
-- CREATE OR REPLACE is correct here: RETURNS jsonb and the (text, int) signature
-- are unchanged, so no overload can be created. Every property is restated
-- explicitly, because CREATE OR REPLACE preserves only ownership and grants —
-- SECURITY DEFINER, search_path and statement_timeout all revert to whatever
-- this command says.
CREATE OR REPLACE FUNCTION public.get_similar_companies(p_token text, p_limit int DEFAULT 6)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH dom AS MATERIALIZED (
    SELECT p.category
    FROM public.job_board_postings p
    WHERE split_part(p.company_token, '~', 1) = split_part(p_token, '~', 1)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
      AND p.category IS NOT NULL AND p.category <> '' AND p.category <> 'other'
    GROUP BY p.category ORDER BY count(*) DESC LIMIT 1
  ),
  agg AS MATERIALIZED (
    SELECT p.company_token,
           max(p.company) AS company,
           count(*)::int  AS open_roles
    FROM public.job_board_postings p
    WHERE p.category = (SELECT category FROM dom)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
      AND split_part(p.company_token, '~', 1) <> split_part(p_token, '~', 1)
      AND p.company <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.showcase_excluded x WHERE x.company_token = p.company_token
      )
    GROUP BY p.company_token
    HAVING count(*) >= 3
    ORDER BY count(*) DESC
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', a.company, 'company_token', a.company_token,
           'open_roles', a.open_roles, 'employees', pr.employee_count,
           'employee_basis', pr.employee_basis,
           'category', (SELECT category FROM dom))
           ORDER BY a.open_roles DESC), '[]'::jsonb)
  FROM agg a
  LEFT JOIN public.company_profiles pr ON pr.company_token = a.company_token;
$$;
GRANT EXECUTE ON FUNCTION public.get_similar_companies(text, int) TO anon, authenticated;

-- The sibling, fenced for the same two reasons: it is the other half of the
-- lander, it shares the slug predicate that the new index now serves, and every
-- figure it publishes (category mix, country mix, salary spread) was computed
-- over postings the board will not serve. Only `posts` changes; the CTEs
-- downstream read from it and are untouched.
CREATE OR REPLACE FUNCTION public.get_company_intel(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH posts AS MATERIALIZED (
    SELECT p.company_token, p.category, p.country, p.salary_currency, p.salary_min_annual
    FROM public.job_board_postings p
    WHERE split_part(p.company_token, '~', 1) = split_part(p_token, '~', 1)
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  ),
  prof AS (
    SELECT max(pr.employee_count) AS employees,
           (array_agg(pr.employee_basis ORDER BY pr.employee_count DESC NULLS LAST))[1] AS employee_basis,
           (array_agg(pr.yc_batch ORDER BY pr.employee_count DESC NULLS LAST))[1] AS yc_batch
    FROM public.company_profiles pr
    WHERE pr.company_token IN (SELECT DISTINCT company_token FROM posts)
  ),
  sal AS (

    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min_annual))::numeric, 0) AS median_usd_floor,
           count(*)::int AS usd_n
    FROM posts
    WHERE salary_currency = 'USD' AND salary_min_annual IS NOT NULL AND salary_min_annual > 0
  ),
  cats AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT category, count(*)::int AS n FROM posts
      WHERE category IS NOT NULL AND category <> '' AND category <> 'other'
      GROUP BY category ORDER BY n DESC LIMIT 3
    ) c
  ),
  countries AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('country', country, 'n', n) ORDER BY n DESC), '[]'::jsonb) AS v
    FROM (
      SELECT country, count(*)::int AS n FROM posts
      WHERE country IS NOT NULL AND country <> ''
      GROUP BY country ORDER BY n DESC LIMIT 3
    ) c
  ),
  snaps AS MATERIALIZED (
    SELECT s.snapshot_date, sum(s.open_roles)::int AS open_roles
    FROM public.job_board_company_snapshots s
    WHERE split_part(s.company_token, '~', 1) = split_part(p_token, '~', 1)
      AND s.snapshot_date >= current_date - 7
    GROUP BY s.snapshot_date
  ),
  trend AS (
    SELECT CASE WHEN (SELECT count(*) FROM snaps) >= 2 THEN
             (SELECT open_roles FROM snaps ORDER BY snapshot_date DESC LIMIT 1)
             - (SELECT open_roles FROM snaps ORDER BY snapshot_date ASC LIMIT 1)
           END::int AS net_7d
  )
  SELECT jsonb_build_object(
    'employees', prof.employees,
    'employee_basis', prof.employee_basis,
    'yc_batch', prof.yc_batch,
    'median_usd_floor', sal.median_usd_floor,
    'usd_n', sal.usd_n,
    'categories', cats.v,
    'countries', countries.v,
    'net_7d', trend.net_7d
  )
  FROM prof, sal, cats, countries, trend;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_intel(text) TO anon, authenticated;
