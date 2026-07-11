-- Job board cache: postings aggregated from official company ATS feeds
-- (Greenhouse/Lever/Ashby) by the job-board edge function's refresh pass.
-- SQL is the read path (fast, consistent across isolates); refresh upserts
-- by id and prunes rows a successful board no longer lists, so dead
-- postings disappear within one cycle.

CREATE TABLE IF NOT EXISTS public.job_board_postings (
  id text PRIMARY KEY,                    -- source:token:externalId
  source text NOT NULL,
  company_token text NOT NULL,
  company text NOT NULL,
  title text NOT NULL,
  location text NOT NULL DEFAULT '',
  remote boolean NOT NULL DEFAULT false,
  department text,
  category text NOT NULL DEFAULT 'other',
  posted_at timestamptz,
  apply_url text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_board_postings_posted_at_idx
  ON public.job_board_postings (posted_at DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS job_board_postings_category_idx
  ON public.job_board_postings (category);
CREATE INDEX IF NOT EXISTS job_board_postings_company_idx
  ON public.job_board_postings (company_token);

CREATE TABLE IF NOT EXISTS public.job_board_meta (
  k text PRIMARY KEY,
  v jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Public job data: world-readable, service-role-writable (no anon policies
-- for insert/update/delete means writes stay function-only).
ALTER TABLE public.job_board_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_board_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_board_postings_public_read" ON public.job_board_postings;
CREATE POLICY "job_board_postings_public_read"
  ON public.job_board_postings FOR SELECT USING (true);

DROP POLICY IF EXISTS "job_board_meta_public_read" ON public.job_board_meta;
CREATE POLICY "job_board_meta_public_read"
  ON public.job_board_meta FOR SELECT USING (true);

-- Refresh every 10 minutes, offset from the heartbeat sentinel's */10 so the
-- two never stampede together. Guarded like the other cron jobs: idempotent,
-- no-ops where pg_cron is absent. The function also self-refreshes on read
-- (stale-while-revalidate), so cron dying degrades freshness, not the board.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-refresh') THEN
    PERFORM cron.schedule(
      'job-board-refresh',
      '4-59/10 * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"refresh"}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
