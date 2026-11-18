-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- THE FIX-PLAN MAILS NOTHING WOULD SEND LEAVE THE QUEUE (S14X-012, the
-- owner's option B of 2026-11-15, with the purge approved).
--
-- WHAT WAS WRONG. send-scan-report queued each fix-plan sequence's four mails
-- on the pgmq queue transactional_emails, labelled 'fix-plan-drip', and no job
-- drains that queue (the only drain, rb-auth-mail-drain, reads auth_emails).
-- Every sequence a person started is still sitting there, unsent.
--
-- WHAT HOLDS NOW. The owner withdrew the sequence (send-scan-report no longer
-- offers or queues it) and approved taking out what is stranded: this file
-- deletes every message labelled 'fix-plan-drip' from the queue and its
-- dead-letter queue. send-scan-report is the queue's only sender, and nothing
-- else is touched: auth_emails, the sign-in mail, is another queue.
--
-- Re-runnable. Where pgmq or either queue is absent it takes out nothing and
-- says so. The DO block at the end raises if a fix-plan message is left.

DO $purge$
DECLARE
  v_t text;
  v_n bigint;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['q_transactional_emails', 'q_transactional_emails_dlq'] LOOP
    IF to_regclass('pgmq.' || v_t) IS NULL THEN
      RAISE NOTICE 'S14X-012: pgmq.% does not exist here, so nothing was taken out of it', v_t;
      CONTINUE;
    END IF;
    EXECUTE format('WITH gone AS (DELETE FROM pgmq.%I WHERE message->>''label'' = ''fix-plan-drip'' RETURNING 1) SELECT count(*) FROM gone', v_t) INTO v_n;
    RAISE NOTICE 'S14X-012: % fix-plan message(s) taken out of pgmq.%', v_n, v_t;
  END LOOP;
END
$purge$;

DO $check$
DECLARE
  v_t text;
  v_left bigint;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['q_transactional_emails', 'q_transactional_emails_dlq'] LOOP
    IF to_regclass('pgmq.' || v_t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM pgmq.%I WHERE message->>''label'' = ''fix-plan-drip''', v_t) INTO v_left;
      IF v_left > 0 THEN
        RAISE EXCEPTION 'S14X-012 self-check failed: % fix-plan message(s) are still in pgmq.%', v_left, v_t;
      END IF;
    END IF;
  END LOOP;
END
$check$;
