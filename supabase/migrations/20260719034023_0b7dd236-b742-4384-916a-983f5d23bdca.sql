ALTER TABLE public.user_applications
  ADD COLUMN IF NOT EXISTS followed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS label text;
NOTIFY pgrst, 'reload schema';