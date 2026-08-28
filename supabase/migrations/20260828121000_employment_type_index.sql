-- Partial index for the employment-type filter, same shape as the work-mode
-- one (20260725140000): (employment_type, effective_posted DESC) WHERE NOT
-- NULL serves the browse path's filter+recency ordering, and the ranked path's
-- dynamic filter string hits it as a bitmap and.
--
-- CONCURRENTLY because job_board_postings is ~700k live rows behind a board
-- that serves reads continuously — a plain CREATE INDEX takes an ACCESS
-- EXCLUSIVE lock and stalls every query against the table while it builds
-- (the 2026-07-19 outage).
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Run this file on its own (the Supabase SQL editor executes it unwrapped). If
-- a migration runner wraps it in BEGIN/COMMIT it will fail with 25001 — that is
-- the runner, not this statement, and the fix is to run it standalone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_employment_type_posted_idx
  ON public.job_board_postings (employment_type, effective_posted DESC)
  WHERE employment_type IS NOT NULL;
