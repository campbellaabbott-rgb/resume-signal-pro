-- Resume version text + anonymous outcome measurement.
--
-- Versions already exist as user_scans rows (applications link via scan_id,
-- and /account computes per-version interview stats). What was missing for
-- "track the exact resume version you sent" is the document itself.
--
-- Design constraints:
-- 1. "Your resume is never stored" is a core product promise for the free
--    scan. resume_text is therefore EXPLICIT OPT-IN only: it is populated
--    solely when a signed-in user clicks "Save this version". Owner-only RLS
--    already governs user_scans; account deletion cascades.
-- 2. Anonymous outcome reports are keyed by report_id (the reproducible ID
--    printed on every diagnostic) — no resume content, no PII. Writes go
--    through a rate-limited SECURITY DEFINER function; the table has no anon
--    read access. Aggregates come later via a k-anonymous reader like
--    get_public_scan_insights.

-- ── Opt-in saved document on scan/version rows ────────────────────────────
ALTER TABLE public.user_scans
  ADD COLUMN IF NOT EXISTS resume_text text,
  ADD COLUMN IF NOT EXISTS report_id text;

-- ── Per-application job-posting fit (computed by the application-fit
--    function; stored so the tracker shows coverage without re-pasting) ────
ALTER TABLE public.user_applications
  ADD COLUMN IF NOT EXISTS job_posting text,
  ADD COLUMN IF NOT EXISTS fit_pct int,
  ADD COLUMN IF NOT EXISTS fit_missing jsonb;

-- ── Anonymous outcome reports ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scan_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('interview', 'no_response', 'rejected')),
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, ip_hash)
);
ALTER TABLE public.scan_outcomes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.scan_outcomes TO service_role;
-- No policies for anon/authenticated: reads and writes only via functions.

CREATE OR REPLACE FUNCTION public.record_scan_outcome(
  p_report_id text,
  p_outcome text,
  p_ip text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  IF p_report_id IS NULL OR length(p_report_id) < 6 OR length(p_report_id) > 24 THEN
    RETURN false;
  END IF;
  IF p_outcome NOT IN ('interview', 'no_response', 'rejected') THEN
    RETURN false;
  END IF;
  -- Reuse the durable limiter: max 5 outcome reports per caller per day.
  SELECT public.check_rate_limit('scan-outcome', coalesce(p_ip, 'unknown'), 5, 1440) INTO v_allowed;
  IF v_allowed IS DISTINCT FROM true THEN
    RETURN false;
  END IF;
  -- One outcome per report per caller; a changed answer overwrites (people
  -- do hear back after reporting no_response).
  INSERT INTO public.scan_outcomes (report_id, outcome, ip_hash)
  VALUES (upper(p_report_id), p_outcome, md5(coalesce(p_ip, 'unknown')))
  ON CONFLICT (report_id, ip_hash)
  DO UPDATE SET outcome = excluded.outcome, created_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_scan_outcome(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_scan_outcome(text, text, text) TO anon, authenticated;

-- ── Delayed email enqueue (for the opt-in 7-day fix plan) ─────────────────
-- Same as enqueue_email but with pgmq's native delay: the message becomes
-- visible to process-email-queue only after delay_seconds. Service-role only.
CREATE OR REPLACE FUNCTION public.enqueue_email_delayed(
  queue_name TEXT,
  payload JSONB,
  delay_seconds INT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload, delay_seconds);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload, delay_seconds);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_email_delayed(TEXT, JSONB, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email_delayed(TEXT, JSONB, INT) TO service_role;
