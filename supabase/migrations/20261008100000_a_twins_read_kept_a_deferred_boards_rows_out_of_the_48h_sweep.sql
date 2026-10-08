-- A TWIN'S READ KEPT A DEFERRED BOARD'S ROWS OUT OF THE 48-HOUR SWEEP.
--
-- The nightly sweep (job-board-verification-sweep, 20260827182000) stamps
-- missing_since on every live row of a board whose verification stamp is older
-- than 48 hours. The stamp was keyed by company_token, and 139 tokens are
-- carried by two or three vendors. So one vendor's read kept the other's rows
-- "verified": on 2026-10-06 greenhouse:lush was deferred by the byte bound
-- (nothing inserted, nothing closed) while personio:lush read every visit, and
-- 19 of the 73 greenhouse rows served were already gone from its feed with
-- missing_since NULL and a fresh recheckedAt.
--
-- job-board 2026-09-09.91 stamps a board on a shared token under its own key,
-- `source:token`, and the bare token too (every other reader joins on it), and
-- seeds a key for each such board from the token's stamp once per isolate (n428
-- in docs/job-board-index-notes.md). This file teaches the sweep to read them:
--
--   * a row on a token with a per-board stamp for ITS vendor is judged by that
--     stamp alone, so a twin's read no longer covers it;
--   * every other row is judged by the bare token's stamp, exactly as before.
--
-- ROLLBACK-SAFE BY A LIVENESS TEST, PER TOKEN. A token's per-board stamps
-- count only while its bare stamp is no newer than the newest of them (one
-- second of slack). Under .91 that always holds: the bare stamp and the reading
-- board's key are written in one upsert with one value, and a seeded key takes
-- the bare stamp's value. Under .90 it stops holding at the first read of any
-- board on the token, because .90 moves the bare stamp alone; from then on that
-- token's rows are judged by the bare stamp exactly as before. A rollback
-- therefore never sweeps a board whose token .90 is reading, whatever age its
-- own key reaches. Until .90 reads a token, its boards are judged by the keys
-- .91 last wrote: a board whose key passes 48h in that window was not read for
-- 48h, and its rows are swept as .91 would sweep them. Applied before .91
-- serves, no token has a key and the sweep reads bare stamps only.
--
-- CHEAPER THAN THE FORM IT REPLACES. The old command probed the stamp table
-- once per live posting (~900k probes). This one reads the stamp table once
-- (~45k rows), keeps the stale set (stamps past 48h: a few thousand at most) and
-- joins it to postings through company_token, probing the per-board key only
-- for rows on a stale bare token.
--
-- Same name, same minute ('41 3 * * *'), still never deletes, still stamps only
-- rows not already stamped (the original disappearance date is what days-open
-- is measured from). The command is changed in place with cron.alter_job, so
-- the job keeps its id, owner and active flag (20261004010000's rule); only a
-- host without the job, or without alter_job, schedules it afresh. A host
-- without pg_cron applies this file as a no-op.

DO $$
DECLARE
  v_id  bigint;
  v_cmd text := $job$
      WITH keys AS (
        SELECT split_part(k.company_token, ':', 2) AS tok, split_part(k.company_token, ':', 1) AS src, k.verified_at
        FROM public.job_board_verifications k
        WHERE strpos(k.company_token, ':') > 0
      ),
      keyed AS (
        SELECT n.tok
        FROM (SELECT kk.tok, max(kk.verified_at) AS newest FROM keys kk GROUP BY kk.tok) n
        LEFT JOIN public.job_board_verifications b ON b.company_token = n.tok
        WHERE b.verified_at IS NULL OR b.verified_at <= n.newest + interval '1 second'
      ),
      stale AS (
        SELECT kk.tok, kk.src
        FROM keys kk JOIN keyed kd ON kd.tok = kk.tok
        WHERE kk.verified_at < now() - interval '48 hours'
        UNION ALL
        SELECT v.company_token, NULL
        FROM public.job_board_verifications v
        WHERE strpos(v.company_token, ':') = 0
          AND v.verified_at < now() - interval '48 hours'
      )
      UPDATE public.job_board_postings p
         SET missing_since = now()
        FROM stale s
       WHERE p.missing_since IS NULL
         AND p.company_token = s.tok
         AND (
           (s.src IS NOT NULL AND p.source = s.src)
           OR (s.src IS NULL AND NOT (
                 EXISTS (SELECT 1 FROM keyed kd WHERE kd.tok = p.company_token)
                 AND EXISTS (SELECT 1 FROM public.job_board_verifications b
                             WHERE b.company_token = p.source || ':' || p.company_token)))
         );
      $job$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'job-board-verification-sweep';
  IF v_id IS NOT NULL AND to_regprocedure('cron.alter_job(bigint, text, text, text, text, boolean)') IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, command => v_cmd);
  ELSE
    IF v_id IS NOT NULL THEN
      PERFORM cron.unschedule('job-board-verification-sweep');
    END IF;
    PERFORM cron.schedule('job-board-verification-sweep', '41 3 * * *', v_cmd);
  END IF;
END $$;

-- Self-verifying: scheduled, never deletes, stamps missing_since, and reads
-- the per-board stamp behind its per-token liveness test.
DO $$
DECLARE cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'job-board-verification-sweep';
  IF cmd IS NULL THEN
    RAISE EXCEPTION 'the verification sweep is not scheduled';
  END IF;
  IF cmd ILIKE '%DELETE FROM public.job_board_postings%' THEN
    RAISE EXCEPTION 'the verification sweep hard-deletes postings';
  END IF;
  IF cmd NOT ILIKE '%missing_since = now()%' OR cmd NOT ILIKE '%p.missing_since IS NULL%' THEN
    RAISE EXCEPTION 'the verification sweep does not stamp only unstamped rows';
  END IF;
  IF cmd NOT ILIKE '%p.source = s.src%' OR cmd NOT ILIKE '%JOIN keyed kd ON kd.tok = kk.tok%' THEN
    RAISE EXCEPTION 'the verification sweep does not read the per-board stamp behind its per-token liveness test';
  END IF;
END $$;
