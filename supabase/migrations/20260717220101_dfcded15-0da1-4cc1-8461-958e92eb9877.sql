CREATE OR REPLACE FUNCTION public.get_board_velocity(days integer DEFAULT 7, top_n integer DEFAULT 40)
RETURNS TABLE (company_token text, recent bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.company_token, count(*)::bigint AS recent
  FROM public.job_board_postings p
  WHERE p.first_seen > now() - make_interval(days => GREATEST(LEAST(days, 30), 1))
  GROUP BY p.company_token
  HAVING count(*) >= 3
  ORDER BY recent DESC
  LIMIT GREATEST(LEAST(top_n, 200), 1);
$$;

REVOKE ALL ON FUNCTION public.get_board_velocity(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_velocity(integer, integer) TO service_role;