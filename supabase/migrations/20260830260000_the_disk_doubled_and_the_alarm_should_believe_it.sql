-- THE DISK GREW 12GB -> 20GB (operator resize, 2026-08-30) — TELL THE ALARM.
--
-- The storage heartbeat reads its plan size from this meta row (precedent:
-- 20260827220000, which made the plan size operator state precisely so a
-- resize is a one-row update). Left at 12, the 75% line sits at 9GB and the
-- corpus expansion this resize was bought FOR would trip a degraded alert
-- while real headroom stands at ~45% — and an alarm that cries early teaches
-- people to ignore it, which un-guards the one failure that takes everything
-- down at once. The governor constants step in the same commit
-- (CORPUS_CEILING 800k -> 1M), sized from measured bytes: 9.4KB/row all-in
-- (2026-08-27) puts 1M postings at ~9.4GB + ~1.4GB everything else ~= 54% of
-- the new plan, inside the alarm line with room for the alarm to still be the
-- tripwire that finds the true ceiling first.
UPDATE public.job_board_meta
   SET v = '{"gb": 20}', updated_at = now()
 WHERE k = 'plan_disk_gb'
   AND (v->>'gb')::int = 12;
-- Self-verifying: the WHERE pins the value we believe we are replacing. If the
-- row already says something else, this becomes a no-op and the discrepancy
-- surfaces in the heartbeat rather than being silently overwritten.
INSERT INTO public.job_board_meta (k, v, updated_at)
SELECT 'plan_disk_gb', '{"gb": 20}', now()
 WHERE NOT EXISTS (SELECT 1 FROM public.job_board_meta WHERE k = 'plan_disk_gb');
