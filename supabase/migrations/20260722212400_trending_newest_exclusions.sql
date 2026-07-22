-- Close the exclusion gap found during post-deploy verification: the
-- snapshot-based RPCs (trending, newest) predate showcase_excluded and never
-- filtered it — kimmel-associates (executive search, excluded 2026-07-22)
-- still ranked #10 in trending. Same bodies, plus the exclusion filter.

CREATE OR REPLACE FUNCTION public.get_trending_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, recent bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH latest AS (
    SELECT max(snapshot_date) AS d FROM public.job_board_company_snapshots
  ),
  baseline AS (
    SELECT min(snapshot_date) AS d
    FROM public.job_board_company_snapshots
    WHERE snapshot_date >= (SELECT d FROM latest) - 7
      AND snapshot_date <  (SELECT d FROM latest)
  )
  SELECT n.company,
         n.company_token,
         (n.open_roles - b.open_roles)::bigint AS recent,
         n.open_roles::bigint                  AS open_roles
  FROM public.job_board_company_snapshots n
  JOIN public.job_board_company_snapshots b
    ON b.company_token = n.company_token
   AND b.snapshot_date = (SELECT d FROM baseline)
  WHERE n.snapshot_date = (SELECT d FROM latest)
    AND (n.open_roles - b.open_roles) >= 3
    AND n.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  ORDER BY recent DESC, n.open_roles DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_companies(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_newest_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, open_roles bigint, first_added timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH bounds AS (
    SELECT min(snapshot_date) AS first_day, max(snapshot_date) AS last_day
    FROM public.job_board_company_snapshots
  ),
  appearances AS (
    SELECT company_token, min(snapshot_date) AS appeared
    FROM public.job_board_company_snapshots
    GROUP BY company_token
  )
  SELECT s.company, s.company_token, s.open_roles::bigint, a.appeared::timestamptz AS first_added
  FROM appearances a
  JOIN public.job_board_company_snapshots s
    ON s.company_token = a.company_token
   AND s.snapshot_date = (SELECT last_day FROM bounds)
  WHERE a.appeared > (SELECT first_day FROM bounds)
    AND a.appeared >= (SELECT last_day FROM bounds) - 14
    AND s.open_roles >= 3
    AND s.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  ORDER BY a.appeared DESC, s.open_roles DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_newest_companies(int) TO anon, authenticated;

-- Categorization repair: the engineering regex matched the bare word
-- "technician", so clinical roles ("Registered Behavior Technician") counted
-- as engineering — polluting facets, salary benchmarks, and the new
-- similar-companies module (Centria Autism ranked as an engineering peer).
-- The regex is fixed in the function (2026-07-22.2); these updates repair
-- rows already stored. Future ingests self-heal as boards rotate.
UPDATE public.job_board_postings SET category = 'healthcare'
WHERE category = 'engineering'
  AND title ~* '\y(behavior|behavioral|behaviour|patient care|pharmacy|veterinary|vet|sterile processing|dialysis|surgical|radiologic|ultrasound|phlebotomy|medical lab\w*|clinical)\y'
  AND title ~* '\ytech(nician)?s?\y';

UPDATE public.job_board_postings SET category = 'other'
WHERE category = 'engineering'
  AND title ~* '\ytechnicians?\y'
  AND title !~* '\y(engineer\w*|developer|software|devops|network|electronics|desktop|help ?desk|service desk|sdet|qa|information technology|datacenter|data center)\y'
  AND title !~* '\yit\y';

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

NOTIFY pgrst, 'reload schema';
