-- A PAGED CENSUS NEEDS A TOTAL ORDER, OR THE PAGE BOUNDARY MOVES.
--
-- get_apply_hosts ordered by posting count alone (ORDER BY 2 DESC). That was
-- fine while the caller read one page, and it stops being fine now that the
-- host sweep pages through the whole census: hundreds of hosts share the same
-- posting count — the long tail is a wall of 1s and 2s — and Postgres is free
-- to return tied rows in any order per call. Two calls for two pages can then
-- place the same host on both (a wasted probe, harmless) or on neither (a host
-- that is never swept, which is the entire failure this sweep exists to
-- catch).
--
-- The tiebreak on host name makes the ordering total, so page N+1 begins
-- exactly where page N ended. The caller dedupes by host as well; belt and
-- braces, because the cost of a duplicate probe is one HTTP HEAD and the cost
-- of a skipped host is a dead apply button nobody notices.
--
-- Body is otherwise unchanged from 20260823030000. Privileges survive CREATE
-- OR REPLACE, but they are re-issued below so this file states the whole
-- security posture rather than depending on what another migration left
-- behind: no anon, no PUBLIC — a host list is reconnaissance surface.

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
