-- get_date_coverage times out under the anon 8s statement cap at 456k rows:
-- the GROUP BY seq-scans the whole wide table. A narrow (source, posted_at)
-- covering index turns it into an index-only aggregate (count(*) and
-- count(posted_at) both answered from the index), making the same RPC safe
-- for its new public surface (the Ghost Job Index date-provenance table)
-- as well as the heartbeat/status callers.
CREATE INDEX IF NOT EXISTS job_board_postings_source_posted_idx
  ON public.job_board_postings (source, posted_at);
