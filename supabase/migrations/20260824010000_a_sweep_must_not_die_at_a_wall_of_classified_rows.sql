-- A SWEEP MUST NOT DIE AT A WALL OF CLASSIFIED ROWS.
--
-- The recategorize sweep pages the "other" pile by keyset:
--   WHERE category = 'other' AND id > cursor ORDER BY id LIMIT 1000
-- With no index shaped for that predicate, Postgres walks the primary key
-- and FILTERS — and in a region of the id space where nearly every row is
-- already classified, filling a single 1,000-row page means skipping
-- through hundreds of thousands of wide rows. Past a density threshold the
-- page outruns the statement timeout, the invocation throws, and the chain
-- dies AT THE SAME CURSOR on every revival: a wall, not a crash.
--
-- Observed live 2026-08-23→24: the re-armed v9 sweep moved briskly through
-- the bamboohr-dense early ids (400+ rows re-filed per 100s), then went
-- flat overnight at a fixed frontier while its progress stamp stayed
-- fresh-ish from revivals that each died on their first page. The count of
-- rows in "other" did not move; 531 known-reclassifiable personio rows sat
-- untouched past the wall.
--
-- The partial index makes the page a pure range read of a ~140k-entry
-- index regardless of how the classified rows around it are distributed.
-- It also shrinks as the sweep succeeds — rows leaving "other" leave the
-- index. Plain CREATE INDEX (not CONCURRENTLY — migrations run in a
-- transaction); the build over ~580k rows takes seconds, and a briefly
-- blocked refresh upsert surfaces as one failed board that the next
-- rotation retries.

CREATE INDEX IF NOT EXISTS idx_job_board_postings_other_by_id
  ON public.job_board_postings (id)
  WHERE category = 'other';
