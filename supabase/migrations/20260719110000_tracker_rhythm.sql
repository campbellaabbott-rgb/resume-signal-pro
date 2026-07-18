-- Tracker rhythm: the pipeline tracked WHAT stage an application is in but
-- not WHEN it last moved — so the dashboard couldn't say "this one's gone
-- quiet, follow up" or "interview Thursday". Three columns:
--   status_changed_at — stamped by the app on every stage change (old rows
--     fall back to applied_at, the user's own stated date — honest basis).
--   followed_up_at    — "I nudged them" marker; resets the quiet clock.
--   interview_at      — scheduled interview date (drives the upcoming strip).
ALTER TABLE public.user_applications
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS followed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_at date;
