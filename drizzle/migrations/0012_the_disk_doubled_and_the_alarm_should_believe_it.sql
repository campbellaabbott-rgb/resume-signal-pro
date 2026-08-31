-- THE DISK GREW 12GB -> 20GB (operator resize, 2026-08-30) — TELL THE ALARM.
UPDATE public.job_board_meta
   SET v = '{"gb": 20}', updated_at = now()
 WHERE k = 'plan_disk_gb'
   AND (v->>'gb')::int = 12;
INSERT INTO public.job_board_meta (k, v, updated_at)
SELECT 'plan_disk_gb', '{"gb": 20}', now()
 WHERE NOT EXISTS (SELECT 1 FROM public.job_board_meta WHERE k = 'plan_disk_gb');