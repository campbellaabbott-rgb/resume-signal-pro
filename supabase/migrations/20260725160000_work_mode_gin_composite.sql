-- Finishes the work-mode fix. The btree partial index from
-- 20260725140000 helped (remote + engineer went from statement timeout to
-- 1.2s) but did not close it, and measuring the full matrix showed my original
-- reasoning was wrong:
--
--            nurse   engineer  manager
--   remote    1.1s     2.2s    timeout
--   hybrid    0.4s   timeout   timeout
--   onsite    0.8s   timeout   timeout
--
-- hybrid+nurse is the SPARSEST combination (7,025 rows filtered to 123) and it
-- is the FASTEST. So this was never about work_mode being sparse. It is the
-- breadth of the search TERM: for "manager", few rows also carry a work mode,
-- so the count inside search_jobs scans every title match applying the filter
-- and never reaches its early-exit LIMIT. Capping the limit lower cannot help,
-- because the scan is driven by how many rows must be EXAMINED to find
-- qualifying ones, not by how many are wanted.
--
-- A btree index on work_mode alone leaves the planner intersecting a huge GIN
-- result with a selective btree one. btree_gin lets a single GIN index answer
-- both predicates together, so "title_tsv @@ q AND work_mode = 'hybrid'"
-- becomes one index scan instead of a scan-and-filter.
--
-- Still partial (WHERE work_mode IS NOT NULL): it covers ~55k of 570k rows, so
-- it stays small. The btree index from the previous migration is kept — it
-- serves the recency path's "work_mode = X ORDER BY effective_posted DESC",
-- which this one does not.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Run this file standalone (the Supabase SQL editor executes it unwrapped);
-- a runner that wraps it in BEGIN/COMMIT fails with 25001.
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_title_tsv_work_mode_idx
  ON public.job_board_postings
  USING gin (title_tsv, work_mode)
  WHERE work_mode IS NOT NULL;
