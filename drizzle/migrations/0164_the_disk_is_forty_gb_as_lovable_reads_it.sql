-- THE DISK IS 40GB, READ FROM LOVABLE ON 2026-10-17. TELL THE ALARM.
--
-- scan-heartbeat divides pg_database_size by job_board_meta.plan_disk_gb.
-- That row was last set by hand to 20 (20260830260000), with no dashboard
-- reading behind it. On 2026-10-17 the heartbeat printed "database at 105% of
-- the 20GB plan" while the database was still taking writes, which a 20GB disk
-- cannot do. The owner then read Lovable's own figure: More -> Cloud ->
-- Overview -> Advanced settings -> Database storage, "23.17 GB of 40 GB used".
-- The disk had grown on its own (12 -> 18 -> 27 -> 40, each step at 90% full);
-- nobody resized it.
--
-- The row now carries the reading's date and where it came from, so the next
-- person can tell a reading from a guess. The heartbeat reads only v.gb; the
-- other two keys are for people.
--
-- The WHERE pins the value we believe we are replacing. If the row already
-- says something other than 20, this changes nothing and says so in a NOTICE,
-- rather than overwriting a value someone set on purpose.
UPDATE public.job_board_meta
   SET v = jsonb_build_object(
         'gb', 40,
         'read_at', '2026-10-17',
         'source', 'Lovable Cloud advanced settings: 23.17 GB of 40 GB used'),
       updated_at = now()
 WHERE k = 'plan_disk_gb'
   AND (v->>'gb')::int = 20;

INSERT INTO public.job_board_meta (k, v, updated_at)
SELECT 'plan_disk_gb',
       jsonb_build_object(
         'gb', 40,
         'read_at', '2026-10-17',
         'source', 'Lovable Cloud advanced settings: 23.17 GB of 40 GB used'),
       now()
 WHERE NOT EXISTS (SELECT 1 FROM public.job_board_meta WHERE k = 'plan_disk_gb');

DO $$
DECLARE
  gb numeric;
BEGIN
  SELECT (v->>'gb')::numeric INTO gb FROM public.job_board_meta WHERE k = 'plan_disk_gb';
  IF gb IS NULL THEN
    RAISE EXCEPTION 'plan_disk_gb row is missing after the update';
  END IF;
  IF gb < 1 OR gb > 512 THEN
    RAISE EXCEPTION 'plan_disk_gb is %, outside the heartbeat''s 1..512 range', gb;
  END IF;
  IF gb <> 40 THEN
    RAISE NOTICE 'plan_disk_gb is % (not 20 before this file), left as it was', gb;
  END IF;
END
$$;