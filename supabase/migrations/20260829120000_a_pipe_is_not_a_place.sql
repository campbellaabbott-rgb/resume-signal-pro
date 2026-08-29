-- A PIPE IS NOT A PLACE, and a lockdown that lists names leaves the name it
-- forgot.
--
-- TWO FIXES, both found by the 2026-08-29 six-lens accuracy sweep and both
-- confirmed by refutation agents against the live definitions.
--
-- 1) fuzzy_title_search treated the pipe-joined location alias list as ONE
--    literal substring. The edge function expands aliased locations before
--    binding ("texas" -> "Texas|, TX", "nyc" -> "NYC|New York", "bay area" ->
--    three names — index.ts rankedLocationParam), and search_jobs /
--    count_jobs_capped split that value on '|' with an EXISTS-over-unnest.
--    The 20260828122000 fuzzy definition instead bound
--        p.location ILIKE '%' || p_location || '%'
--    — a single pattern containing a literal pipe, which matches zero rows.
--    So q="nurrse" + location "texas": the ranked path finds nothing, the
--    trigram rescue and the thin-page closeMatch augmentation both silently
--    return zero, and the visitor sees an empty page while nurse jobs in Texas
--    exist. EVERY US state code/name and every multi-name metro disabled the
--    entire fuzzy tier this way — invisibly, because zero rows is
--    indistinguishable from no close matches. The predicate below is the same
--    EXISTS the other two functions use.
--
--    CREATE OR REPLACE, no DROPs: the signature is byte-identical to the live
--    20260828122000 one, so no overload can be added and the
--    one-function-one-signature rule holds without touching the other two.
--
-- 2) search_jobs_semantic was still GRANTed to anon and authenticated
--    (20260827160000:131). The 2026-08-28 lockdown revoked the three TEXT
--    search RPCs by a catalog walk keyed to their names — and this fourth
--    name, which also returns full posting rows including apply_url, kept its
--    grant. Posting arbitrary 384-dim vectors at /rest/v1/rpc with the
--    published anon key walks the embedding space and reconstitutes servable
--    rows around the edge function — the same unmetered-corpus-export class
--    the lockdown exists to close. Same catalog-walk revoke, same
--    service_role-only grant; the only caller in the repo authenticates with
--    the service key.

CREATE OR REPLACE FUNCTION public.fuzzy_title_search(
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
  p_employment_type text DEFAULT NULL
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, country text, remote boolean, work_mode text,
  employment_type text, department text, category text, posted_at timestamptz, apply_url text,
  salary text, salary_min_annual numeric, salary_max_annual numeric,
  salary_period text, salary_currency text, experience_band text,
  min_years integer, last_seen timestamptz, missing_since timestamptz,
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
      -- The alias list, split exactly as search_jobs and count_jobs_capped
      -- split it. A '|'-joined value matched whole can never be true.
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
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY m.sim DESC, m.effective_posted DESC;
$$;

-- REVOKED FROM THE CATALOG, NOT BY LISTING SIGNATURES — the same walk the
-- 20260828122000 lockdown used for the three text RPCs, keyed to the name it
-- missed. Signature drift cannot un-revoke what a walk revokes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_jobs_semantic'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
