SET LOCAL lock_timeout = '20s';
SET LOCAL statement_timeout = '20min';
SET LOCAL maintenance_work_mem = '256MB';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS public.job_board_postings_company_trgm_idx;
CREATE INDEX job_board_postings_company_trgm_idx
  ON public.job_board_postings USING gin (company gin_trgm_ops);

DROP INDEX IF EXISTS public.job_board_postings_department_trgm_idx;
CREATE INDEX job_board_postings_department_trgm_idx
  ON public.job_board_postings USING gin (department gin_trgm_ops);

ANALYZE public.job_board_postings;