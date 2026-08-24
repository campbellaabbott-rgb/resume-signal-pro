UPDATE public.job_board_postings
SET country = 'US'
WHERE country = 'MX'
  AND location ~* '\mnew mexico\M';