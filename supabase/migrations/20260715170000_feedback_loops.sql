-- Feedback loops: (1) zero-result search telemetry — what job seekers looked
-- for and didn't find (the honest demand signal for catalog growth), and
-- (2) user reports on individual postings. Both tables are written ONLY by
-- the edge function (service role): RLS is enabled with no public policies,
-- so there is no client write surface to spam and nothing readable publicly.

CREATE TABLE IF NOT EXISTS public.job_board_search_misses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  q text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,   -- category/experience/remote/salaryFloor snapshot
  src text NOT NULL DEFAULT 'list',             -- 'list' (user search) | 'count' (saved-search count)
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_board_search_misses ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.job_board_posting_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id text NOT NULL,
  company_token text NOT NULL DEFAULT '',
  reason text NOT NULL CHECK (reason IN ('gone', 'misleading', 'other')),
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_board_posting_reports_posting_idx
  ON public.job_board_posting_reports (posting_id, at DESC);
ALTER TABLE public.job_board_posting_reports ENABLE ROW LEVEL SECURITY;

-- Retention: telemetry is a rolling demand signal, not an archive.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-feedback-retention') THEN
    PERFORM cron.schedule(
      'job-board-feedback-retention',
      '41 3 * * *',
      $job$
        DELETE FROM public.job_board_search_misses WHERE at < now() - interval '30 days';
        DELETE FROM public.job_board_posting_reports WHERE at < now() - interval '180 days';
      $job$
    );
  END IF;
END $$;
