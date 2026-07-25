DO $$
BEGIN
  ALTER TABLE public.user_applications DROP CONSTRAINT IF EXISTS user_applications_status_check;
  ALTER TABLE public.user_applications ADD CONSTRAINT user_applications_status_check
    CHECK (status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected', 'no_response'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;