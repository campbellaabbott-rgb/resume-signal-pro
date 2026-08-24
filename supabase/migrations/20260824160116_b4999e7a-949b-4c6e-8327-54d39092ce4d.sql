CREATE OR REPLACE FUNCTION public.get_apply_hosts()
RETURNS TABLE (host text, postings bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  SELECT split_part(split_part(apply_url, '://', 2), '/', 1) AS host,
         count(*)::bigint AS postings
  FROM public.job_board_postings
  WHERE missing_since IS NULL
    AND effective_posted >= now() - interval '30 days'
    AND apply_url LIKE 'https://%'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.recruitee.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.greenhouse.io'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.myworkdayjobs.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.bamboohr.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.teamtailor.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.icims.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.ashbyhq.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.lever.co'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.workable.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.smartrecruiters.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.personio.%'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.breezy.hr'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.pinpointhq.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.oraclecloud.com'
  GROUP BY 1
  HAVING count(*) >= 1
  ORDER BY 2 DESC, 1 ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_apply_hosts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_apply_hosts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_apply_hosts() TO service_role;