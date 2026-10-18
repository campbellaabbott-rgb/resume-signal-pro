-- A FIX-PLAN MAIL QUEUED BEFORE THE PAUSE IS ARCHIVED, NOT SENT (S12-010,
-- plan CP-016 and CP-038; owner decision 2026-10-12; wave 4 round 2,
-- account-compliance).
--
-- WHAT WAS WRONG. Marketing mail now waits for a seller with a legal name and
-- a postal address (_shared/marketing-pause.ts): while both are empty,
-- send-scan-report offers no fix-plan button and confirm-drip queues nothing.
-- But a sequence confirmed BEFORE this round queued its four mails at once,
-- up to fourteen days ahead, on transactional_emails, labelled
-- 'fix-plan-drip' and marked transactional, with an empty text part and no
-- seller line. R1's drain (20261014100000) sends that queue every ten
-- seconds, so those mails would go out as they fall due, as transactional
-- mail, while marketing is paused.
--
-- WHAT THIS DOES. Every message still on transactional_emails whose label is
-- 'fix-plan-drip' is archived with pgmq.archive: it moves to the queue's
-- archive table (pgmq.a_transactional_emails), where it is kept and can be
-- read, and the drain never reads it. A sequence started after this round is
-- queued as marketing with its text part, and only once the seller is named.
-- No other message is touched. A database with no pgmq or no such queue has
-- nothing to archive.
--
-- Safe to re-run: a second run finds nothing to archive. Verify: the DO block
-- below raises if a fix-plan message is still queued, and
-- src/test/w4b-a-fix-plan-mail-queued-before-the-pause-is-archived.test.ts
-- runs this file twice in pglite.

SET LOCAL statement_timeout = '2min';

DO $archive$
DECLARE
  v_ids bigint[];
  v_id bigint;
  v_n integer := 0;
BEGIN
  IF to_regclass('pgmq.q_transactional_emails') IS NULL
     OR to_regprocedure('pgmq.archive(text,bigint)') IS NULL THEN
    RAISE NOTICE 'fix-plan pause: no transactional_emails queue here, nothing to archive';
    RETURN;
  END IF;
  EXECUTE $q$SELECT coalesce(array_agg(q.msg_id ORDER BY q.msg_id), '{}')
               FROM pgmq.q_transactional_emails q
              WHERE q.message ->> 'label' = 'fix-plan-drip'$q$
     INTO v_ids;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF pgmq.archive('transactional_emails', v_id) THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'fix-plan pause: archived % queued fix-plan message(s)', v_n;
END
$archive$;

DO $check$
DECLARE
  v_left bigint;
BEGIN
  IF to_regclass('pgmq.q_transactional_emails') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $q$SELECT count(*) FROM pgmq.q_transactional_emails q WHERE q.message ->> 'label' = 'fix-plan-drip'$q$ INTO v_left;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check: % fix-plan message(s) are still queued for the drain while marketing mail is paused', v_left;
  END IF;
END
$check$;
