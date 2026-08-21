-- Stop the one-shot that built job_board_postings_company_simple_fts_idx.
--
-- APPLY THIS ONLY AFTER THE INDEX EXISTS. Check first:
--   company=wfts(simple).AT&T  -> HTTP 200, sub-second
-- Applying it early leaves the index unbuilt and the board no better off, since
-- the schedule is the only thing that runs the statement outside a transaction.
--
-- A one-shot left scheduled runs its statement every minute forever. It is
-- IF NOT EXISTS so each repeat is a cheap no-op, but 20260817230000 records
-- what happens when one of these is forgotten.

SELECT cron.unschedule('oneshot_company_simple_fts_idx');
