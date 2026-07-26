-- Three indexes for the board's measured slow tail (2026-07-26 wave-2 scan,
-- all figures from live curl batteries):
--
-- 1) location ILIKE list: 4.40s p50 across all samples — the location filter
--    seq-scans 573k rows. The title trigram GIN (20260720) proved this shape;
--    location gets the same treatment.
-- 2) sort:salary: 4.37s p50 vs 1.48s recency. The existing partial index
--    (salary_rank_usd DESC, 20260716) stores DESC with NULLS FIRST — the
--    query orders NULLS LAST, so the planner can never use it and sorts the
--    full window every time. This one matches the ORDER BY exactly.
-- 3) category+remote cold combos: 3.6-4.9s first-hit. A partial composite
--    serves the hottest filter intersection directly.
--
-- CONCURRENTLY + standalone file per the postings-table protocol (these build
-- without blocking the refresh pipeline's writes).

CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_location_trgm_idx
  ON public.job_board_postings USING gin (location gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_salary_sort_idx
  ON public.job_board_postings (salary_rank_usd DESC NULLS LAST, id ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_category_remote_idx
  ON public.job_board_postings (category, effective_posted DESC)
  WHERE remote;
