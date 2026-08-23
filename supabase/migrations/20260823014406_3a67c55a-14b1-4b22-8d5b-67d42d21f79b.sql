UPDATE public.job_board_postings p
SET apply_url = 'https://job-boards.greenhouse.io/' || p.company_token
                || '/jobs/' || split_part(p.id, ':', 3)
WHERE p.source = 'greenhouse'
  AND (p.company_token, p.apply_url) IN (
    SELECT company_token, apply_url
    FROM public.job_board_postings
    WHERE source = 'greenhouse'
    GROUP BY company_token, apply_url
    HAVING count(DISTINCT title) >= 5
  );