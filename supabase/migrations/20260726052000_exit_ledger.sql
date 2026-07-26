-- Exit ledger (wave-2 rank 12): the Ghost Job Index's namesake number — what
-- share of postings are still advertised after 30 days — has never been
-- publishable because rows hitting the freshness cap are deleted WITHOUT any
-- log (index.ts: "freshness cap — no grace, no log"), while feed-removals go
-- to job_board_closures. You cannot compute a rate whose numerator is
-- systematically unrecorded.
--
-- DELIBERATELY A SEPARATE TABLE, not a flag on job_board_closures: every
-- existing fill-speed stat (employer benchmarks, hiring health, ghost index
-- medians) reads closures as "the feed removed it" — pouring aged-out rows in
-- would poison those medians with 30+ day non-fills unless every consumer was
-- simultaneously re-shipped. A ledger of BOTH exit kinds, written alongside,
-- risks nothing and starts the accrual clock today. The public stat ("X% of
-- postings in <field> are still advertised after 30 days") ships only after
-- ~30 days of accrual and only with n >= 500 per published segment.
CREATE TABLE IF NOT EXISTS public.job_board_exits (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id text NOT NULL,
  source text NOT NULL,
  company_token text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  -- 'removed' = the company's feed stopped listing it (filled or withdrawn).
  -- 'aged_out' = still advertised when it crossed OUR 30-day serving cap.
  exit_reason text NOT NULL CHECK (exit_reason IN ('removed', 'aged_out')),
  -- Days from the company-stated post date (fallback: our first_seen) to exit.
  days_on_board numeric,
  exited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_board_exits_exited_idx
  ON public.job_board_exits (exited_at DESC);
CREATE INDEX IF NOT EXISTS job_board_exits_category_idx
  ON public.job_board_exits (category, exit_reason, exited_at DESC);

-- Service-role only until the accrual clears the publishing floor; the public
-- reads a vetted aggregate RPC later, never the raw ledger.
ALTER TABLE public.job_board_exits ENABLE ROW LEVEL SECURITY;

-- 90-day retention: the published stat uses a rolling window; raw events
-- older than that serve nothing.
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
