-- THE SEED MUST NOT HOLD THE INDEX LOCK.
--
-- 20260909210000 builds job_board_board_state_latest_idx and then, in its
-- original form, called refresh_closure_population() at the bottom of the same
-- file. Migrations apply one file per transaction, so that seed ran inside the
-- transaction that had just taken ACCESS EXCLUSIVE on job_board_board_state --
-- and refresh_closure_population() carries `SET statement_timeout = '10min'`.
-- The lock was therefore held for the index build PLUS up to ten minutes of
-- measurement, against a table the ingest upserts continuously (one row per
-- board per day, 24/7).
--
-- That is the shape of the 2026-07-19 wedge the index block's own comment
-- cites as the reason it takes its lock with a timeout and a retry: an index
-- build queued behind the write loop until the connection pool was exhausted.
-- Taking the lock carefully and then sitting on it for ten minutes gives back
-- everything the care bought.
--
-- Splitting the seed into its own file makes it its own transaction. The index
-- migration commits and releases the lock; this one then measures against a
-- table nothing is queued behind.
--
-- WHY SEED AT ALL. So the disclosure is loadable the moment the pair applies
-- rather than at the next :09/:39 tick. It is a convenience, not a
-- requirement -- which is why the failure path below is a NOTICE and not an
-- error. A failure leaves no row, get_closure_population() returns none, and
-- /status shows the same null it shows today until the first cron tick lands;
-- the caller already handles that case (`closurePop.error ? null : data ?? null`).
--
-- NO LOCK IS TAKEN HERE beyond what the refresh itself needs. It reads
-- job_board_closures and job_board_board_state and writes one row to
-- job_board_stats_rollup.

DO $$
BEGIN
  PERFORM public.refresh_closure_population();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'closure population seed failed (%); the :09/:39 cron will fill it', SQLERRM;
END $$;
