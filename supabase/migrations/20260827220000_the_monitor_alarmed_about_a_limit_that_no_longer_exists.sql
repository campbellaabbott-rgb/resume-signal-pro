-- THE DISK ALARM WAS HARD-CODED TO A PLAN THE PROJECT IS NOT ON.
--
-- scan-heartbeat's two disk checks divide measured bytes by a literal
-- 8 * 1024^3. The disk is 12GB now, so the endpoint reported "90% of the 8GB
-- plan" — degraded, for weeks if left alone — about headroom that actually
-- stands at 65%. A monitor that alarms about a limit that no longer exists
-- teaches people to ignore it, which un-guards the one failure mode that takes
-- every feature down at once.
--
-- The plan size becomes OPERATOR STATE: one meta row, read by the heartbeat
-- with a fallback of 8 (a fresh environment alarms early rather than never)
-- and a sanity clamp (1..512) so a typo cannot disable the alarm. The next
-- disk resize is a one-row UPDATE — no function deploy:
--
--   UPDATE job_board_meta SET v = '{"gb": 16}', updated_at = now()
--    WHERE k = 'plan_disk_gb';
INSERT INTO public.job_board_meta (k, v, updated_at)
VALUES ('plan_disk_gb', '{"gb": 12}', now())
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
