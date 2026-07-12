ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS kit jsonb;

ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS kit_generated_at timestamptz;

NOTIFY pgrst, 'reload schema';