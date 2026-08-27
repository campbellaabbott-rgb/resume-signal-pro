-- A ONE-SHOT IS STILL FIRING EVERY MINUTE.
--
-- 20260821214919 scheduled 'oneshot_company_simple_fts_idx' and nothing
-- unschedules it. The index it builds already EXISTS — verified with the anon
-- key at four concurrent callers, company_token and company=wfts(simple) both
-- answering 200 in 0.21-0.47s where the same shapes returned 500 500 500 500
-- this morning — so every run is a no-op that costs a worker slot and a log
-- line, forever.
--
-- This is the third time this pattern has needed cleaning up today and the
-- second time in this repo overall (20260817230000 is the first). The schedule
-- and the unschedule keep being written as a PAIR in one push, which cannot
-- work: pg_cron ticks once a minute, so an unschedule applied alongside its
-- schedule lands before the job has ever run, and the index never gets built.
-- Splitting them means someone has to remember the second half.
--
-- THE RULE THAT ACTUALLY HOLDS: schedule in one push, verify the index exists,
-- unschedule in the next. Never both at once, and never neither.

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
