-- THE POSTED-DATE BACKFILL'S DRAW COULD NOT USE AN INDEX, SO IT TIMED OUT.
--
-- The sweep draws its next batch with:
--
--   source = $1 AND posted_at IS NULL AND id > $2 ORDER BY id LIMIT 500
--
-- The existing index job_board_postings_source_posted_idx (source, posted_at)
-- can satisfy the WHERE clause but CANNOT serve ORDER BY id, so Postgres sorted
-- a large filtered set on every hop. Measured live 2026-08-17 against a ~3s
-- statement timeout:
--
--   bamboohr, no id predicate ....... 3.1-3.3s  -> 57014 about 2 times in 3
--   bamboohr, id > 'bamboohr:' ...... 0.23s     (the cursor-seed fix)
--   greenhouse, WITH the id predicate 3.18s     -> 57014, 3 of 3
--
-- So seeding the cursor fixes bamboohr and rippling but NOT greenhouse, whose
-- undated rows are sparse (99% dated) and scattered — the planner has to walk a
-- long way to fill a page. That is the phase that was timing out and, because
-- it is terminal, writing a completion stamp over work nothing had done.
--
-- This index is the exact shape of the draw. Being partial, it contains only
-- undated rows (~79,000 of 594,000, and shrinking as the sweep works), so it is
-- small, and it stays useful precisely as a phase approaches done — which is
-- when the unindexed version got most expensive.
--
-- CONCURRENTLY because this table serves every board request; it cannot take an
-- ACCESS EXCLUSIVE lock. That also means this migration CANNOT run inside a
-- transaction block (Postgres raises 25001), which is why this file contains
-- exactly one statement and no BEGIN/COMMIT.
--
-- VERIFY LIVE AFTER APPLYING, do not assume: Lovable re-stamps migrations, so a
-- file present in this repo is not proof of a deployed index. Re-run the
-- greenhouse draw and require HTTP 200 comfortably under one second.

CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_undated_draw_idx
  ON public.job_board_postings (source, id)
  WHERE posted_at IS NULL;
