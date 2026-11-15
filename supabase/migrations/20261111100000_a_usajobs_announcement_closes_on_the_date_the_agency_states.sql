-- A USAJOBS ANNOUNCEMENT CLOSES ON THE DATE THE AGENCY STATES.
--
-- Board .102, XR-1. Every USAJOBS announcement states the day applications
-- close (ApplicationCloseDate). The board read the announcement and dropped
-- that date, so a closed announcement stayed served until the feed stopped
-- listing it, and usajobs closed_90d read 0. job-board .102 keeps the date on
-- the row and, in the pass-end sweep step, closes a stored announcement once
-- its date has passed, through the same path a feed removal takes: a closure
-- row and an exit row with exit_reason 'removed' (which the exit CHECK
-- already allows), the exit marked with how we knew.
--
-- TWO COLUMNS, catalog-only:
--   job_board_postings.closes_at  timestamptz  the close date the employer
--                                              states; NULL where none is stated
--   job_board_exits.exit_basis    text         'stated_close' on an exit the
--                                              stated date closed; NULL otherwise
-- No default, no index and no CHECK, so neither ALTER rewrites or scans a row.
-- Each ALTER waits at most two seconds for its lock and is retried up to ten
-- times, so it never queues behind a long reader of the posting table.
--
-- ORDER: before fn:job-board. A .102 that runs first still stores its rows:
-- an insert that names a missing closes_at is retried without it, and the
-- close step reads nothing until the column exists.
--
-- Re-runnable: IF NOT EXISTS everywhere; the check below only reads the
-- catalog.

DO $$
DECLARE
  tries int := 0;
BEGIN
  LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'job_board_postings' AND column_name = 'closes_at');
    tries := tries + 1;
    BEGIN
      SET LOCAL lock_timeout = '2s';
      ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS closes_at timestamptz;
    EXCEPTION WHEN lock_not_available THEN
      IF tries >= 10 THEN
        RAISE EXCEPTION 'could not take the lock on job_board_postings in ten two-second tries; nothing was changed, apply again';
      END IF;
      RAISE NOTICE 'job_board_postings is busy (try %), waiting a second', tries;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  SET LOCAL lock_timeout TO DEFAULT;
END $$;

DO $$
DECLARE
  tries int := 0;
BEGIN
  LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'job_board_exits' AND column_name = 'exit_basis');
    tries := tries + 1;
    BEGIN
      SET LOCAL lock_timeout = '2s';
      ALTER TABLE public.job_board_exits ADD COLUMN IF NOT EXISTS exit_basis text;
    EXCEPTION WHEN lock_not_available THEN
      IF tries >= 10 THEN
        RAISE EXCEPTION 'could not take the lock on job_board_exits in ten two-second tries; nothing was changed, apply again';
      END IF;
      RAISE NOTICE 'job_board_exits is busy (try %), waiting a second', tries;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  SET LOCAL lock_timeout TO DEFAULT;
END $$;

COMMENT ON COLUMN public.job_board_postings.closes_at IS
  'The date applications close, as the employer states it (USAJOBS ApplicationCloseDate); NULL where none is stated. '
  'job-board .102 closes a stored row once it has passed (20261111100000).';
COMMENT ON COLUMN public.job_board_exits.exit_basis IS
  '''stated_close'' when the employer''s stated close date closed the posting, not a read of the feed; NULL otherwise (20261111100000).';

-- Self-check: both columns exist with those types.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'job_board_postings' AND column_name = 'closes_at')
     IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION '20261111100000: job_board_postings.closes_at is missing or not timestamptz';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'job_board_exits' AND column_name = 'exit_basis')
     IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION '20261111100000: job_board_exits.exit_basis is missing or not text';
  END IF;
END $$;
