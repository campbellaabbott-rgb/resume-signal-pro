CREATE TABLE IF NOT EXISTS public.job_board_exits (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id text NOT NULL,
  source text NOT NULL,
  company_token text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  exit_reason text NOT NULL,
  days_on_board numeric,
  exited_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.job_board_exits TO service_role;

ALTER TABLE public.job_board_exits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS job_board_exits_exited_idx
  ON public.job_board_exits (exited_at DESC);
CREATE INDEX IF NOT EXISTS job_board_exits_category_idx
  ON public.job_board_exits (category, exit_reason, exited_at DESC);

ALTER TABLE public.job_board_exits
  DROP CONSTRAINT IF EXISTS job_board_exits_exit_reason_check;

ALTER TABLE public.job_board_exits
  ADD CONSTRAINT job_board_exits_exit_reason_check
  CHECK (exit_reason IN ('removed', 'aged_out', 'backdated'));

COMMENT ON COLUMN public.job_board_exits.exit_reason IS
  'removed = the feed stopped listing it (filled or withdrawn). '
  'aged_out = still advertised when it crossed OUR 30-day cap; a tenure this '
  'board observed, and the only reason admissible in the ghost-rate numerator. '
  'backdated = the employer date predates our first sighting by more than the '
  'serving window, so the tenure was learned, not observed. Ghost-rate '
  'consumers MUST filter to aged_out.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-exits-retention') THEN
    PERFORM cron.schedule(
      'job-board-exits-retention',
      '17 4 * * *',
      $job$DELETE FROM public.job_board_exits WHERE exited_at < now() - interval '90 days'$job$
    );
  END IF;
END $$;