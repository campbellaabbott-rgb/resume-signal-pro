UPDATE public.job_board_postings
SET apply_url = 'https://' || company_token || '.recruitee.com/o/'
                || split_part(apply_url, '/o/', 2)
WHERE source = 'recruitee'
  AND apply_url LIKE '%/o/%'
  AND apply_url NOT LIKE 'https://' || company_token || '.recruitee.com/%';