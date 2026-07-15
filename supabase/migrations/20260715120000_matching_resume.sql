-- Matching résumé: a first-class, user-controlled "this is my résumé" on the
-- account. Every matcher (board fit ranking, fit-threshold digests, apply-agent
-- grounding) previously used the LATEST scan implicitly; now an explicit pin —
-- either a chosen scan or pasted text — wins, with latest-scan as the unchanged
-- default. Owner-only via the existing user_profiles RLS.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS matching_scan_id uuid,
  ADD COLUMN IF NOT EXISTS matching_resume_text text,
  ADD COLUMN IF NOT EXISTS matching_resume_updated_at timestamptz;
