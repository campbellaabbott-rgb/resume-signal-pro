-- Search v2: keyword search also matches the JOB DESCRIPTION text (weight D —
-- title/company/department still dominate ranking, description mentions
-- surface but never outrank a title hit). Drop/recreate is deliberate: the
-- prior migration may or may not have applied yet, and ADD COLUMN IF NOT
-- EXISTS would silently keep the old description-less expression.
DROP INDEX IF EXISTS job_board_postings_search_tsv_idx;
ALTER TABLE public.job_board_postings DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.job_board_postings
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(department, '')), 'C') ||
    setweight(to_tsvector('english', left(coalesce(description, ''), 4000)), 'D')
  ) STORED;
CREATE INDEX job_board_postings_search_tsv_idx
  ON public.job_board_postings USING gin (search_tsv);
