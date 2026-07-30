ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS linkedin text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resume_file_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS work_authorized boolean,
  ADD COLUMN IF NOT EXISTS requires_sponsorship boolean,
  ADD COLUMN IF NOT EXISTS willing_to_relocate boolean,
  ADD COLUMN IF NOT EXISTS salary_expectation text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS earliest_start text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_demographics boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apply_mode text NOT NULL DEFAULT 'review'
    CHECK (apply_mode IN ('review', 'auto')),
  ADD COLUMN IF NOT EXISTS auto_apply_daily_cap integer NOT NULL DEFAULT 5
    CHECK (auto_apply_daily_cap BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS auto_apply_sources text[] NOT NULL
    DEFAULT ARRAY['workday','smartrecruiters','breezy','oracle',
                  'teamtailor','personio','pinpoint']::text[];

COMMENT ON COLUMN public.agent_mandates.work_authorized IS
  'Trinary: NULL means not stated. Never defaulted to false.';
COMMENT ON COLUMN public.agent_mandates.apply_mode IS
  'review (default) prepares and waits; auto releases up to auto_apply_daily_cap on zero-CAPTCHA vendors only.';

CREATE OR REPLACE FUNCTION public.agent_sent_today(p_user uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.agent_submissions
  WHERE user_id = p_user
    AND submitted_at >= date_trunc('day', now());
$$;

GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;