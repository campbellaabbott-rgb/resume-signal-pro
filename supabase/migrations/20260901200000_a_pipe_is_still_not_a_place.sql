-- I REVERTED A FIX BY COPYING A BODY FROM THE WRONG MIGRATION.
--
-- 20260901090000 re-issued all three search functions together (the rule that
-- keeps them from drifting) by extracting their bodies programmatically from
-- 20260828122000. For search_jobs and count_jobs_capped that file WAS the
-- live definition. For fuzzy_title_search it was not: 20260829120000 had
-- since fixed its location clause, and copying the older body silently put
-- the bug back.
--
-- WHAT IT COST, from the moment 20260901090000 applied: p_location arrives as
-- a '|'-joined alias list ("New York|NYC|Manhattan"), and the reverted clause
-- matched that whole string against p.location with ILIKE — true for no row
-- that has ever existed. So the typo-rescue tier returned nothing whenever a
-- location filter was active. A search for "nurse practicioner" in NYC lost
-- its rescue results entirely, silently, and looked like a board with no
-- matching jobs.
--
-- THE GENERAL LESSON, now pinned by a test: "extract the current body" must
-- read the LATEST migration that defines that function, not the latest
-- migration that defines the group. The three functions ship together; they
-- do not necessarily last change together.
--
-- Only fuzzy_title_search is re-issued here. search_jobs and count_jobs_capped
-- had no intervening definition (verified across every migration between the
-- two files), so 20260901090000's copies of them are correct and are left
-- alone — re-issuing them would risk exactly the error this file exists to
-- correct.
-- TWO FIXES, ONE RE-ISSUE. The location revert above is a body change, but
-- the agency opt-out needs a new PARAMETER and a new projected COLUMN, so the
-- arity moves and CREATE OR REPLACE cannot carry it. Dropped explicitly (the
-- legacy signatures too, so no stale overload answers PGRST203) and re-granted
-- below, because DROP discards grants.
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text);
DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer, text, boolean, text, text, text[], numeric, text[], timestamptz, integer, text, text[], boolean, boolean, numeric, text, integer, text, text);
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc
           WHERE pronamespace = 'public'::regnamespace AND proname = 'fuzzy_title_search'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $$;
CREATE FUNCTION public.fuzzy_title_search(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_limit integer DEFAULT 40,
  p_location text DEFAULT NULL,
  p_remote boolean DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_experience text[] DEFAULT NULL,
  p_salary_floor numeric DEFAULT NULL,
  p_companies text[] DEFAULT NULL,
  p_posted_after timestamptz DEFAULT NULL,
  p_max_age_days integer DEFAULT NULL,
  p_work_mode text DEFAULT NULL,
  p_vendors text[] DEFAULT NULL
,
  p_pay_stated boolean DEFAULT NULL,
  p_include_unstated boolean DEFAULT false,
  p_salary_ceiling numeric DEFAULT NULL,
  p_pay_basis text DEFAULT NULL,
  p_max_years integer DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_employment_type text DEFAULT NULL,
  p_exclude_agencies boolean DEFAULT false
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text,
  employment_type text, department text, category text, posted_at timestamptz, apply_url text,
  salary text, salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text, experience_band text,
  min_years integer, last_seen timestamptz, missing_since timestamptz,
  agency boolean,
  total_rows bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
  WITH m AS (
    SELECT p.*, similarity(p.title, p_q) AS sim
    FROM public.job_board_postings p
    WHERE p.title % p_q
      AND p.effective_posted >= p_fresh_cutoff
      AND p.missing_since IS NULL
      -- A '|'-JOINED ALIAS LIST MATCHED WHOLE CAN NEVER BE TRUE (20260829120000).
      -- The opt-out reaches the RESCUE tier too. Binding it only in
      -- search_jobs meant a searcher who asked to hide staffing agencies got
      -- a page of them the moment the exact tier came back empty and the
      -- fuzzy rescue took over — undisclosed, because these rows carried no
      -- agency column for the badge or the integrity sensor to read.
      AND (NOT p_exclude_agencies OR p.agency = false)
      AND (p_location IS NULL OR EXISTS (
            SELECT 1 FROM unnest(string_to_array(p_location, '|')) AS alias(x)
            WHERE p.location ILIKE '%' || alias.x || '%'))
      AND (p_remote IS NOT TRUE OR p.remote)
      AND (p_country IS NULL OR p.country = ANY(string_to_array(p_country, ',')))
      AND (p_category IS NULL OR p.category = ANY(string_to_array(p_category, ',')))
      AND (p_experience IS NULL OR p.experience_band = ANY(p_experience))
      AND (p_salary_floor IS NULL
           OR p.salary_rank_usd >= p_salary_floor
           OR (p_include_unstated AND p.salary_rank_usd IS NULL))
      AND (p_pay_stated IS NOT TRUE OR p.salary_min_annual IS NOT NULL)
      AND (p_companies IS NULL OR p.company_token = ANY(p_companies))
      AND (p_posted_after IS NULL OR p.posted_at > p_posted_after)
      AND (p_max_age_days IS NULL OR p.posted_at >= now() - make_interval(days => p_max_age_days))
      AND (p_vendors IS NULL OR p.source = ANY(p_vendors))
      AND (p_salary_ceiling IS NULL
           OR p.salary_rank_usd <= p_salary_ceiling
           OR (p_include_unstated AND p.salary_rank_usd IS NULL))
      AND (p_pay_basis IS NULL
           OR (p_pay_basis = 'hourly' AND p.salary_period = 'hour')
           OR (p_pay_basis = 'salaried' AND p.salary_period IN ('year', 'month')))
      AND (p_max_years IS NULL OR p.min_years <= p_max_years)
      AND (p_department IS NULL OR p.department ILIKE '%' || p_department || '%')
      -- Multi-select, same as the two functions above. string_to_array on a
      -- single value yields a one-element array, so a caller that sends one
      -- mode is unaffected.
      AND (p_work_mode IS NULL OR p.work_mode = ANY(string_to_array(p_work_mode, ',')))
      AND (p_employment_type IS NULL OR p.employment_type = ANY(string_to_array(p_employment_type, ',')))
    ORDER BY similarity(p.title, p_q) DESC, p.effective_posted DESC
    LIMIT GREATEST(LEAST(p_limit, 60), 1)
  )
  SELECT m.id, m.source, m.company_token, m.company, m.title, m.location,
         m.country, m.remote, m.work_mode, m.employment_type, m.department, m.category,
         m.posted_at, m.apply_url, m.salary, m.salary_min_annual,
         m.salary_max_annual, m.salary_period, m.salary_currency,
         m.experience_band, m.min_years::integer, m.last_seen, m.missing_since,
         m.agency,
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY m.sim DESC, m.effective_posted DESC;
$$;

-- DROP discards grants; the definer posture is restored from the catalog.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname IN ('fuzzy_title_search')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
