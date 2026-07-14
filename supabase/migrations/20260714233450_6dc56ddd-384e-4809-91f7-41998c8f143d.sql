CREATE TABLE IF NOT EXISTS public.job_board_closures (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id text NOT NULL,
  source text NOT NULL,
  company_token text NOT NULL,
  company text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  first_seen timestamptz,
  posted_at timestamptz,
  closed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.job_board_closures TO anon, authenticated;
GRANT ALL ON public.job_board_closures TO service_role;

CREATE INDEX IF NOT EXISTS job_board_closures_company_idx
  ON public.job_board_closures (company_token, closed_at DESC);
CREATE INDEX IF NOT EXISTS job_board_closures_closed_at_idx
  ON public.job_board_closures (closed_at DESC);

ALTER TABLE public.job_board_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_board_closures_public_read" ON public.job_board_closures;
CREATE POLICY "job_board_closures_public_read"
  ON public.job_board_closures FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-closures-retention') THEN
    PERFORM cron.schedule(
      'job-board-closures-retention',
      '17 3 * * *',
      $job$ DELETE FROM public.job_board_closures WHERE closed_at < now() - interval '180 days'; $job$
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';