UPDATE public.job_board_postings
SET location = btrim(regexp_replace(
      location,
      '\s*\|\s*-?[0-9]{1,3}\.[0-9]{3,}(\s*\|\s*-?[0-9]{1,3}\.[0-9]{3,})?\s*$',
      ''
    ))
WHERE source = 'greenhouse'
  AND location ~ '\|\s*-?[0-9]{1,3}\.[0-9]{3,}\s*(\|\s*-?[0-9]{1,3}\.[0-9]{3,}\s*)?$';