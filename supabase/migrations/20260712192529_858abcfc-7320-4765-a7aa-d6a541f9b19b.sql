ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS closure_alerts_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS posting_closed_notified_at timestamptz;
CREATE INDEX IF NOT EXISTS user_applications_closure_notify_idx
  ON public.user_applications (posting_closed_at)
  WHERE posting_closed_at IS NOT NULL AND posting_closed_notified_at IS NULL;