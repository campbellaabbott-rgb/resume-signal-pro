-- Closure log: the ONLY record that a job_board_postings row was ever open.
-- The live table hard-deletes on prune (a role a company's feed stops listing
-- disappears within one refresh cycle), so without this log all lifecycle
-- history is lost. The refresh writes a row here for every posting it prunes,
-- giving honest per-company "hiring health": which companies actually CLOSE /
-- fill roles over time vs. perpetually collect applications.
--
-- This is an EVENT log (surrogate PK, not keyed by posting id) on purpose: a
-- role that is reposted and then closed again logs each closure, and that churn
-- is itself a signal. Numbers accrue from the first refresh after deploy — there
-- is no retroactive history, and we never fabricate one.

CREATE TABLE IF NOT EXISTS public.job_board_closures (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posting_id text NOT NULL,               -- source:token:externalId (not unique: reposts re-close)
  source text NOT NULL,
  company_token text NOT NULL,
  company text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  first_seen timestamptz,                 -- when we first saw the posting (days-open = closed_at - COALESCE(posted_at, first_seen))
  posted_at timestamptz,                  -- the company's stated post date, when the feed provides one
  closed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_board_closures_company_idx
  ON public.job_board_closures (company_token, closed_at DESC);
CREATE INDEX IF NOT EXISTS job_board_closures_closed_at_idx
  ON public.job_board_closures (closed_at DESC);

-- Aggregate hiring-health stats are public, and the raw log holds only
-- already-public posting metadata: world-readable, service-role-writable
-- (no anon insert/update/delete policies keeps writes function-only).
ALTER TABLE public.job_board_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_board_closures_public_read" ON public.job_board_closures;
CREATE POLICY "job_board_closures_public_read"
  ON public.job_board_closures FOR SELECT USING (true);

-- Retention: keep ~180 days (comfortably covers 90-day hiring-health windows)
-- so the table stays bounded. Daily prune at 03:17, guarded like the other
-- cron jobs: idempotent, no-ops where pg_cron is absent.
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
