-- A ONE-SHOT SCHEDULED EVERY MINUTE, FOREVER.
--
-- 20260817154614 needed to create job_board_postings_undated_draw_idx, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block (Postgres
-- raises 25001) — which is what a migration is. The workaround was to hand it
-- to pg_cron:
--
--   select cron.schedule('oneshot-undated-draw-idx','* * * * *',
--     $$CREATE INDEX CONCURRENTLY IF NOT EXISTS ...$$);
--
-- That is a genuinely good trick and it worked: the index exists, and the draw
-- it unblocks went from 3.18s/HTTP 500 (57014, three times out of three) to
-- 0.20-0.48s/HTTP 200, measured live 2026-08-17.
--
-- But nothing unscheduled it. The name says one-shot; the schedule says every
-- minute. IF NOT EXISTS makes each subsequent run a cheap no-op rather than an
-- error, so nothing will break — which is exactly why it would sit there
-- unnoticed, taking a cron slot and a connection 1,440 times a day forever.
--
-- This is the same shape as the lanes elsewhere in this codebase that ran for
-- days doing nothing while reporting success: the failure of a silent no-op is
-- that it is silent, not that it is loud.
--
-- Unschedule it, and only after confirming the index it existed to create is
-- actually there. If the index is somehow missing, leave the job alone so it
-- keeps trying — removing the retry AND lacking the index would be strictly
-- worse than a wasted cron slot.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'job_board_postings_undated_draw_idx'
  ) THEN
    -- cron.unschedule raises if the job is absent, so guard on its presence
    -- too: this migration must be safe to re-run.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-undated-draw-idx') THEN
      PERFORM cron.unschedule('oneshot-undated-draw-idx');
      RAISE NOTICE 'unscheduled oneshot-undated-draw-idx (index present)';
    END IF;
  ELSE
    RAISE NOTICE 'index job_board_postings_undated_draw_idx ABSENT — leaving the cron in place to keep retrying';
  END IF;
END $$;
