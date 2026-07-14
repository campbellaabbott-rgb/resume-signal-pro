-- Search at scale: trigram indexes for the board's keyword search.
--
-- serveList's search is `title/company/department ILIKE '%term%'` (+ location).
-- Sequential-scan ILIKE was fine at ~30-90k rows, but the corpus is heading to
-- ~200k now (capacity scale-up, 2026-07-13) with a 300k ceiling — substring
-- search over that starts to crawl. pg_trgm GIN indexes accelerate the EXACT
-- queries already running (substring ILIKE), so behavior is unchanged — same
-- results, just indexed. This is deliberately chosen over a tsvector switch,
-- which would change match semantics (word boundaries/stemming) and need a
-- careful re-test of search behavior.
--
-- Build cost at current size is seconds; runs once. Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS job_board_postings_title_trgm_idx
  ON public.job_board_postings USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS job_board_postings_company_trgm_idx
  ON public.job_board_postings USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS job_board_postings_department_trgm_idx
  ON public.job_board_postings USING gin (department gin_trgm_ops);
CREATE INDEX IF NOT EXISTS job_board_postings_location_trgm_idx
  ON public.job_board_postings USING gin (location gin_trgm_ops);
