SET LOCAL statement_timeout = '600s';

UPDATE public.job_board_postings
SET work_mode = NULL,
    remote = false
WHERE work_mode = 'remote'
  AND COALESCE(remote, false) = false
  AND COALESCE(title, '') !~* '\mremote\M|\mwork from home\M|\mwfh\M|\mtelework\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M'
  AND COALESCE(location, '') !~* '\mremote\M|\mwork from home\M|\mwfh\M|\mtelework\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M';

UPDATE public.job_board_postings
SET work_mode = NULL
WHERE work_mode = 'remote'
  AND COALESCE(remote, false) = false
  AND COALESCE(title, '') !~* '\mremote\M'
  AND COALESCE(location, '') !~* '\mremote\M';