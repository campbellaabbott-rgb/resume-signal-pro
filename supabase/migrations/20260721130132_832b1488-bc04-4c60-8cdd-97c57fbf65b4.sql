DELETE FROM public.job_board_closures
WHERE company_token IN (
  SELECT company_token
  FROM public.job_board_postings
  WHERE company_token LIKE '%~wd%'
  GROUP BY company_token
  HAVING count(*) >= 450
);

DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;