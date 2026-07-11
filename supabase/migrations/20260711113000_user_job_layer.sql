-- Account × job board layer, built ON the existing user_applications
-- tracker (not a parallel table): board saves become application rows with
-- status 'saved', clicking Apply promotes them to 'applied', and the row
-- snapshots company/title/apply_url so it survives the posting being pruned
-- from the live board. Plus user_job_searches: saved filter sets with a
-- last-seen watermark for "new since your last visit" counts.

ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS job_id text;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS apply_url text;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS location text;

-- One row per user per board posting (nulls stay distinct, so manual rows —
-- job_id null — are unlimited). Full unique index so PostgREST upsert can
-- target user_id,job_id.
CREATE UNIQUE INDEX IF NOT EXISTS user_applications_user_job_uniq
  ON public.user_applications (user_id, job_id);

CREATE TABLE IF NOT EXISTS public.user_job_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {q, category, location, remote, company}
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS user_job_searches_user_idx ON public.user_job_searches (user_id, created_at DESC);

ALTER TABLE public.user_job_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_job_searches_own" ON public.user_job_searches;
CREATE POLICY "user_job_searches_own" ON public.user_job_searches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
