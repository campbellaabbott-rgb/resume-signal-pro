ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS job_id text;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS apply_url text;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS location text;

CREATE UNIQUE INDEX IF NOT EXISTS user_applications_user_job_uniq
  ON public.user_applications (user_id, job_id);

CREATE TABLE IF NOT EXISTS public.user_job_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS user_job_searches_user_idx ON public.user_job_searches (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_job_searches TO authenticated;
GRANT ALL ON public.user_job_searches TO service_role;

ALTER TABLE public.user_job_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_job_searches_own" ON public.user_job_searches;
CREATE POLICY "user_job_searches_own" ON public.user_job_searches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';