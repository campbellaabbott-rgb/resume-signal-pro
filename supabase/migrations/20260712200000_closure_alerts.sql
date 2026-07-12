-- Feature 5 (tracked-job closure alerts): opt-in email when a posting the
-- user is tracking closes. Opt-in flag on the profile; a notified stamp on
-- the application so we email each closure exactly once.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS closure_alerts_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS posting_closed_notified_at timestamptz;

-- The notifier (service-role) scans for closed-but-unnotified tracked jobs
-- across all users; this partial index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS user_applications_closure_notify_idx
  ON public.user_applications (posting_closed_at)
  WHERE posting_closed_at IS NOT NULL AND posting_closed_notified_at IS NULL;
