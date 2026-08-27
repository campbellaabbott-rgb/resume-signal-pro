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

DO $guard$
BEGIN
  -- GUARDED: cron.unschedule RAISES when the job is absent, and several of these
  -- names are unscheduled by more than one migration. Unguarded, a fresh replay
  -- of this folder (supabase db reset, a staging rebuild, disaster recovery)
  -- aborts at the second one and no later migration applies. Production ran each
  -- of these once, successfully, which is why it was never noticed.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot_company_simple_fts_idx') THEN
    PERFORM cron.unschedule('oneshot_company_simple_fts_idx');
  END IF;
END
$guard$;
