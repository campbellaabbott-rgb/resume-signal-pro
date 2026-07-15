-- Pipeline integrity: (1) daily ground-truth audit — the board samples ~100 of
-- its own postings and confirms each live at the vendor source, producing the
-- measured accuracy stat; (2) per-board verification ceiling — every posting's
-- board must be re-verified within 48h or its postings are swept, closing the
-- last "stale by accident" hole (a cursor gap or selection bug).

-- ── (2) per-board verification stamps ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_board_verifications (
  company_token text PRIMARY KEY,
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_board_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_board_verifications_public_read" ON public.job_board_verifications;
CREATE POLICY "job_board_verifications_public_read"
  ON public.job_board_verifications FOR SELECT USING (true);

-- Heartbeat probe: boards that still have live postings but were last
-- re-verified >24h ago (or never stamped since this table appeared).
CREATE OR REPLACE FUNCTION public.get_stale_board_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT count(*)::int FROM (
    SELECT DISTINCT p.company_token
    FROM public.job_board_postings p
    LEFT JOIN public.job_board_verifications v ON v.company_token = p.company_token
    WHERE v.verified_at IS NULL OR v.verified_at < now() - interval '24 hours'
  ) stale;
$$;
GRANT EXECUTE ON FUNCTION public.get_stale_board_count() TO anon, authenticated;

-- Nightly sweep at 03:41: drop postings from any board not re-verified in 48h.
-- Only boards with an EXISTING stale stamp are swept — boards with no stamp yet
-- (table just created / brand-new board mid-first-pass) are left alone until
-- stamps accrue, so the ceiling can never mass-delete on day zero.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-verification-sweep') THEN
    PERFORM cron.schedule(
      'job-board-verification-sweep',
      '41 3 * * *',
      $job$
      DELETE FROM public.job_board_postings p
      WHERE EXISTS (
        SELECT 1 FROM public.job_board_verifications v
        WHERE v.company_token = p.company_token
          AND v.verified_at < now() - interval '48 hours'
      );
      $job$
    );
  END IF;
END $$;

-- ── (1) daily ground-truth audit at 04:23 ──────────────────────────────────
-- The audit action is self-throttled (~1/day) and returns the cached result to
-- any extra trigger, so a redundant fire is harmless.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-audit') THEN
    PERFORM cron.schedule(
      'job-board-audit',
      '23 4 * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"audit"}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
