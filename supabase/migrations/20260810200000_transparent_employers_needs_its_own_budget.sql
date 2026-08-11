-- MY FIX THIS MORNING WAS HALF A FIX, AND IT HAD A SECOND BUG I DID NOT SEE.
--
-- 20260810180000 moved get_transparent_employers off the request path into
-- refresh_explore_cache. That removed the real cost — every Explore page view
-- had been spending ~26s of a Postgres worker on a query guaranteed to fail —
-- but the section still does not render. Measured after deploy: the cache now
-- carries a `transparent` key, and its value is `[]`.
--
-- BUG 1 — THE TIMEOUT I RAISED WAS NEVER THE ONE IN EFFECT.
-- The wrapper set `SET LOCAL statement_timeout = '90s'` before the call. But
-- get_transparent_employers is declared with
--
--     SET statement_timeout = '25s'
--
-- in its own definition (20260722224800). A function's SET clause is applied on
-- entry and reverted on exit, so it OVERRIDES the caller's for the whole body.
-- I raised a ceiling for a statement that then lowered it again on itself. It
-- timed out at 25s exactly as before; the exception boundary caught the 57014
-- and degraded to an empty array. The degradation worked. The goal did not.
--
-- BUG 2 — THE CALL SHAPE WAS WRONG, SO SUCCESS WOULD ALSO HAVE FAILED.
-- This function returns scalar `jsonb`, not a set. The wrapper called it as
--
--     SELECT jsonb_agg(row_to_json(x)) FROM public.get_transparent_employers(12) x
--
-- Postgres accepts a non-set-returning function in FROM by treating it as a
-- one-row, one-column table, so `row_to_json(x)` is `{"x": [...]}` and the
-- aggregate wraps it again: `[{"x":[ …the real array… ]}]`. Explore gates on
-- `Array.isArray(c.transparent)`, which that passes — so had the timeout been
-- fixed alone, the section would have rendered exactly one card with every
-- field undefined. The timeout was masking a shape bug. Both are fixed here,
-- and the shape one is why this migration does not simply raise a number.
--
-- I ALSO OVERSTATED A CONTROL. I claimed get_size_segments proves a full
-- 590k-row aggregate finishes inside the cron. It does not: it aggregates the
-- ~18k-row company summary table, not job_board_postings. There is no measured
-- control for this query completing, so this migration does not rely on one —
-- it makes the query cheap AND records what actually happened.

-- ── make it cheap, not merely patient ─────────────────────────────────────
--
-- The expensive part was never the grouping. It was percentile_cont, an
-- ordered-set aggregate that must sort each group's salaries — computed for
-- EVERY qualifying company when at most 12 are ever returned. Grouping now
-- happens once with cheap hash aggregates, the top N is taken, and the median
-- is computed only for those rows via a LATERAL that rides the existing
-- job_board_postings_company_token_idx.
CREATE OR REPLACE FUNCTION public.get_transparent_employers(p_limit int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
-- Generous because the only caller left is an hourly cron with nobody waiting
-- on it (see the REVOKE below), and well inside refresh_explore_cache's own
-- 10-minute ceiling so a slow run cannot crowd out the collections that work.
SET statement_timeout = '4min'
AS $$
  WITH agg AS (
    SELECT company_token,
           max(company) AS company,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n
    FROM public.job_board_postings
    WHERE company <> ''
      AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      -- BOTH serving predicates, matching buildQuery and the sourcesFacet.
      -- Counting postings the board refuses to show would rank employers on a
      -- population no reader can reach — one quantity with two numbers, which
      -- is the defect this codebase keeps paying for. It also makes the >=20
      -- floor and the 80% ratio mean "of their open roles", which is what the
      -- section's own blurb promises.
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
    HAVING count(*) >= 20
       AND 100.0 * count(*) FILTER (WHERE salary IS NOT NULL) / count(*) >= 80
  ),
  top AS (
    SELECT * FROM agg
    ORDER BY (100.0 * pay_n / GREATEST(total, 1)) DESC, total DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', t.company,
           'company_token', t.company_token,
           'open_roles', t.total,
           'pay_pct', round(100.0 * t.pay_n / GREATEST(t.total, 1), 0),
           'median_usd_floor', m.med)
         ORDER BY (100.0 * t.pay_n / GREATEST(t.total, 1)) DESC, t.total DESC),
         '[]'::jsonb)
  FROM top t
  LEFT JOIN LATERAL (
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS med
    FROM public.job_board_postings p
    WHERE p.company_token = t.company_token
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
      AND p.salary_currency = 'USD'
      AND p.salary_min_annual > 0
  ) m ON true;
$$;

-- NOT PUBLIC ANY MORE. anon held EXECUTE so Explore could call it from the
-- browser; Explore no longer does. A four-minute aggregate any anonymous caller
-- can start is a worker-exhaustion lever, not an API. refresh_explore_cache is
-- SECURITY DEFINER and runs as the owner, so it still reaches this.
REVOKE ALL ON FUNCTION public.get_transparent_employers(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_transparent_employers(int) TO service_role;

COMMENT ON FUNCTION public.get_transparent_employers(int) IS
  'Employers stating pay on >=80% of at least 20 SERVED postings (missing_since '
  'IS NULL and effective_posted within 30 days). Returns scalar jsonb — call it '
  'as a scalar, never in FROM, which yields [{"x":[...]}] instead. Cron-only: '
  'refresh_explore_cache is the sole caller; revoked from anon because it held a '
  'worker for 26s per Explore page view until 20260810180000.';

-- ── tell an empty result from a failed one ────────────────────────────────
--
-- `transparent: []` meant two different things this morning and looked
-- identical: "no employer clears the 80% bar" and "the query could not finish".
-- That ambiguity is why the section's failure went unnoticed for weeks, and it
-- is not worth re-earning — the cache now records WHY it is empty, so the next
-- reader does not have to re-derive it from a timeout.
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  payload jsonb;
  transparent jsonb := '[]'::jsonb;
  transparent_status text := 'ok';
BEGIN
  BEGIN
    -- Scalar call. No FROM, no jsonb_agg, no row_to_json — the function already
    -- returns the finished array, and re-aggregating it was bug 2 above.
    transparent := COALESCE(public.get_transparent_employers(12), '[]'::jsonb);
    IF jsonb_typeof(transparent) <> 'array' THEN
      transparent_status := 'failed: expected array, got ' || jsonb_typeof(transparent);
      transparent := '[]'::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Degrades to empty so one slow member cannot abort the INSERT and freeze
    -- all seven collections at their previous values with nothing saying so.
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
  END;

  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x),
    'newest',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x),
    'entry',    (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'reposters',(SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_repost_churn_companies(12) x),
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'segments', (SELECT coalesce(public.get_size_segments(), '{}'::jsonb)),
    'transparent', transparent,
    'transparent_status', transparent_status,
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

-- NO INLINE RECOMPUTE HERE, DELIBERATELY.
--
-- This migration originally ended with a DO block calling
-- refresh_explore_cache() so the corrected numbers would serve immediately
-- instead of at the next tick. That block is why the whole file kept failing to
-- apply: recomputing seven collections takes minutes, and while its
-- `EXCEPTION WHEN OTHERS` catches a statement timeout, it cannot catch the SQL
-- editor's connection/gateway limit. When that killed the session mid-script,
-- the surrounding transaction rolled back — taking the DDL above with it. Three
-- attempts applied exactly nothing, and the failure was invisible because the
-- statements that mattered had already "run".
--
-- The cron refreshes explore_cache hourly at :07 (verified live), so waiting is
-- at most an hour and costs nothing. A migration should not be able to fail on
-- a stat recompute.
NOTIFY pgrst, 'reload schema';
