WITH w AS (
  SELECT id,
         split_part(company_token, '~', 1) AS tenant,
         split_part(id, ':', 3)            AS req
  FROM public.job_board_postings
  WHERE source = 'workday'
),
dupes AS (
  SELECT d.id
  FROM w d
  JOIN w k
    ON k.tenant = d.tenant
   AND k.req = regexp_replace(d.req, '-\d{1,2}$', '')
  WHERE d.req ~ '-\d{1,2}$'
    AND regexp_replace(d.req, '-\d{1,2}$', '') ~ '\d{3}'
    AND k.id <> d.id
)
DELETE FROM public.job_board_postings
WHERE id IN (SELECT id FROM dupes);