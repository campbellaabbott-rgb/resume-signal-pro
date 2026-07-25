-- Work-mode filtering is CORRECT since search_jobs v3.4 but slow: measured
-- 2026-07-25, workMode=remote + q=engineer took 5.3s and workMode=hybrid +
-- q=manager took 12.0s, and the RPC called directly hits 57014 (statement
-- timeout) — the edge function only survives by falling back to the recency
-- path. Working by fallback is not working well.
--
-- Cause: work_mode is populated on just 9.7% of the corpus and has no index, so
-- filtering it next to a text query scans a large candidate set. This partial
-- index covers ONLY the ~55k rows that state a mode, so it is small and cheap
-- to build relative to the 570k table.
--
-- Column order is deliberate: (work_mode, effective_posted DESC) serves the
-- recency path's "work_mode = X ORDER BY effective_posted DESC" directly, and
-- gives the planner a cheap bitmap side to AND against the GIN title_tsv index
-- on the ranked path. One index, both routes.
--
-- CONCURRENTLY because job_board_postings is ~570k live rows behind a board
-- that serves reads continuously — a plain CREATE INDEX takes an ACCESS
-- EXCLUSIVE lock and stalls every query against the table while it builds.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Run this file on its own (the Supabase SQL editor executes it unwrapped). If
-- a migration runner wraps it in BEGIN/COMMIT it will fail with 25001 — that is
-- the runner, not this statement, and the fix is to run it standalone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_work_mode_posted_idx
  ON public.job_board_postings (work_mode, effective_posted DESC)
  WHERE work_mode IS NOT NULL;
