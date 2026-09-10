-- A DEAD CHAIN SHOULD NOT WAIT FOR THE MINUTE IT DIED ON.
--
-- The refresh rotation is a self-kicking chain: each slice that completes
-- POSTs the next hop (chainNextSlice), and pg_cron exists only to start a
-- fresh chain when the running one dies. Measured 2026-09-03 (memory:
-- rotation cadence): every revival landed on a :x9 minute -- a death at 18:39Z
-- was revived at 18:49Z, a death at 19:37Z by the :39 kick -- so the live
-- kick cadence is '9-59/10 * * * *' and nothing fires in between. A chain that
-- dies at :x9+epsilon is dark for the better part of ten minutes, and at the
-- observed ~2 deaths per 40 minutes that is roughly a third of the wall clock
-- spent waiting for a tick.
--
-- 20260714170000 added 'job-board-refresh-backup' as a SECOND trigger for
-- exactly this reason, and its own comment promised "minutes 4,14,... and
-- 9,19,..." -- but the schedule it wrote was '9-59/10 * * * *', the same
-- minutes the primary actually fires on. A backup on the primary's schedule
-- is not redundancy: it lands while the primary's own hop-0 slice holds the
-- lock, is answered "skipped -- a slice ran moments ago", and adds nothing.
--
-- THIS MOVES THE BACKUP INTO THE GAP. With one job on :x9 and the other on
-- :x4, the longest a dead chain waits for a fresh kick is five minutes instead
-- of ten. Nothing else changes.
--
-- WHY THIS CANNOT DOUBLE THE CHAIN. runRefresh takes a slice lock on
-- job_board_meta.refresh_progress: a non-forced kick that arrives within
-- SLICE_LOCK_MS (3 min) of the last slice's stamp returns "skipped" without
-- fetching a board. Cron kicks never pass force=true (only the chain's own
-- hops do, and they carry a chainKey), so a backup kick that lands while a
-- chain is alive is declined at the lock, and one that lands while the chain
-- is dead starts the ONE chain that should be running. Two crons five minutes
-- apart against a three-minute lock means the second is a no-op whenever the
-- first produced a live chain.
--
-- NO THROUGHPUT CONSTANT MOVES. Slice size (MIN/MAX_BOARDS_PER_SLICE and the
-- ramp), fetch concurrency, the posting budget, the lane split and the
-- CHAIN_CAP are all untouched; the job body below is byte-for-byte the body
-- 20260715015753 scheduled. This migration changes WHEN a dead chain is
-- restarted, never how much a running one does. Judge it by chainKick.ageMin
-- and lastSliceAgeMin after a death (bounded by ~5 min, not ~10), and by
-- freshness p50 over a full pass -- never by a window inside one.
--
-- SCHEDULE-AWARE, because the migration folder and the live database
-- disagree about the primary. 20260711144159 scheduled 'job-board-refresh' at
-- '4-59/10 * * * *'; the live kicks say :x9. Whichever is true, the property
-- that matters is that the two jobs are OFFSET, so the target is chosen from
-- the primary's live row: a primary on :x4 puts the backup on :x9, a primary on
-- :x9 puts the backup on :x4.
--
-- NO ACTIVE PRIMARY IS THE CASE THAT MATTERS MOST. 20260817222227 deactivated
-- jobids 109, 207, 531 and 648 by number with no names on disk, and
-- 20260711144159's 'job-board-refresh' was among the earliest jobs this
-- database scheduled. If it is one of those four, the :x9-only revivals were
-- the BACKUP being the only kick, and moving that lone kick from :x9 to :x4
-- would leave the cadence at ten minutes while the NOTICE said "moved". So
-- with no active primary the migration re-creates 'job-board-refresh' on :x9
-- -- the minute the live kicks already land on -- with the same job body,
-- and the backup takes :x4: two offset kicks either way. A self-check at the
-- bottom refuses to end with fewer than two active kicks or with both on one
-- schedule. After apply, the proof is hop-0 chainKicks on BOTH :x4 and :x9
-- minutes within the hour; only then is the five-minute bound a claim.
--
-- GUARDED like 20260715015753 and 20260827181000: the cron namespace may be
-- absent (a local reset), and cron.unschedule RAISES when the job does not
-- exist, which would abort every later migration on a fresh replay. Idempotent:
-- a backup already on the offset schedule is left exactly as it is, so a second
-- application -- or a replay after this has run -- touches nothing.

DO $$
DECLARE
  primary_sched text;
  current_sched text;
  target text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; no refresh schedule to move';
    RETURN;
  END IF;

  SELECT j.schedule INTO primary_sched
    FROM cron.job j
   WHERE j.jobname = 'job-board-refresh' AND j.active
   LIMIT 1;

  -- No active primary (see the header): re-create it on the measured minute
  -- so two offset kicks exist. Guarded the same way as the backup below --
  -- an inactive row by that name is unscheduled first, because cron.schedule
  -- on an existing name is not documented to re-activate it.
  IF primary_sched IS NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'job-board-refresh') THEN
      PERFORM cron.unschedule('job-board-refresh');
    END IF;
    PERFORM cron.schedule(
      'job-board-refresh',
      '9-59/10 * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"refresh"}'::jsonb
      );
      $job$
    );
    primary_sched := '9-59/10 * * * *';
    RAISE WARNING 'job-board-refresh had no active row; re-created at % so two offset kicks exist', primary_sched;
  END IF;

  target := CASE
    WHEN primary_sched = '4-59/10 * * * *' THEN '9-59/10 * * * *'
    ELSE '4-59/10 * * * *'
  END;

  SELECT j.schedule INTO current_sched
    FROM cron.job j
   WHERE j.jobname = 'job-board-refresh-backup' AND j.active
   LIMIT 1;

  IF current_sched = target THEN
    RAISE NOTICE 'job-board-refresh-backup already runs at % (primary at %); untouched', target, COALESCE(primary_sched, 'none active');
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'job-board-refresh-backup') THEN
    PERFORM cron.unschedule('job-board-refresh-backup');
  END IF;

  PERFORM cron.schedule(
    'job-board-refresh-backup',
    target,
    $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"refresh"}'::jsonb
      );
      $job$
  );
  RAISE NOTICE 'job-board-refresh-backup moved from % to % (primary at %)', COALESCE(current_sched, 'none active'), target, COALESCE(primary_sched, 'none active');
END $$;

-- Self-verifying: two active refresh kicks must exist and must not share a
-- schedule. One kick, or two on one minute, is the ten-minute wait this
-- migration exists to remove -- fail loudly rather than ship a change that
-- changed nothing.
DO $$
DECLARE
  primary_sched text;
  backup_sched text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.schedule INTO primary_sched FROM cron.job j WHERE j.jobname = 'job-board-refresh' AND j.active LIMIT 1;
  SELECT j.schedule INTO backup_sched FROM cron.job j WHERE j.jobname = 'job-board-refresh-backup' AND j.active LIMIT 1;
  IF backup_sched IS NULL THEN
    RAISE EXCEPTION 'job-board-refresh-backup is not scheduled after the move';
  END IF;
  IF primary_sched IS NULL THEN
    RAISE EXCEPTION 'job-board-refresh is not active after the move; a single kick cannot give the five-minute bound';
  END IF;
  IF primary_sched = backup_sched THEN
    RAISE EXCEPTION 'job-board-refresh and job-board-refresh-backup both run at %; the backup is not offset', backup_sched;
  END IF;
END $$;
