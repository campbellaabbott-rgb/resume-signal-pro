-- Restore missing production schema for account scan history, market pulse,
-- shortlist, subscriptions, and detection telemetry.

-- Shared updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Deterministic industry pinning for scans (backend-only)
CREATE TABLE IF NOT EXISTS public.scan_industry_pins (
  resume_hash text PRIMARY KEY,
  industry text NOT NULL,
  confidence text NOT NULL DEFAULT 'high',
  source text NOT NULL DEFAULT 'detection',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.scan_industry_pins TO service_role;
ALTER TABLE public.scan_industry_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages scan industry pins" ON public.scan_industry_pins;
CREATE POLICY "service role manages scan industry pins"
  ON public.scan_industry_pins FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS scan_industry_pins_created_at_idx
  ON public.scan_industry_pins (created_at);
DROP TRIGGER IF EXISTS set_scan_industry_pins_updated_at ON public.scan_industry_pins;
CREATE TRIGGER set_scan_industry_pins_updated_at
  BEFORE UPDATE ON public.scan_industry_pins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Market pulse subscribers (backend-only)
CREATE TABLE IF NOT EXISTS public.market_pulse_subscribers (
  email text PRIMARY KEY,
  industry text NOT NULL DEFAULT 'general',
  last_score int,
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  unsubscribed_at timestamptz
);
GRANT ALL ON public.market_pulse_subscribers TO service_role;
ALTER TABLE public.market_pulse_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages market pulse subscribers" ON public.market_pulse_subscribers;
CREATE POLICY "service role manages market pulse subscribers"
  ON public.market_pulse_subscribers FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS market_pulse_subscribers_active_idx
  ON public.market_pulse_subscribers (industry)
  WHERE unsubscribed_at IS NULL;

-- User scan history
CREATE TABLE IF NOT EXISTS public.user_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ats_score int NOT NULL,
  projected_score int,
  industry text,
  verdict text,
  red_flag_count int,
  fix_plan jsonb,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_scans
  ADD COLUMN IF NOT EXISTS fix_plan jsonb,
  ADD COLUMN IF NOT EXISTS label text;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_scans TO authenticated;
GRANT ALL ON public.user_scans TO service_role;
ALTER TABLE public.user_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own scans" ON public.user_scans;
CREATE POLICY "users read own scans"
  ON public.user_scans FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "users insert own scans" ON public.user_scans;
CREATE POLICY "users insert own scans"
  ON public.user_scans FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users update own scans" ON public.user_scans;
CREATE POLICY "users update own scans"
  ON public.user_scans FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users delete own scans" ON public.user_scans;
CREATE POLICY "users delete own scans"
  ON public.user_scans FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS user_scans_user_created_idx
  ON public.user_scans (user_id, created_at DESC);

-- User profile/context settings
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_score int CHECK (target_score BETWEEN 1 AND 100),
  situation text,
  target_role text,
  confirmed_industry text,
  confirmed_experience text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS target_score int CHECK (target_score BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS situation text,
  ADD COLUMN IF NOT EXISTS target_role text,
  ADD COLUMN IF NOT EXISTS confirmed_industry text,
  ADD COLUMN IF NOT EXISTS confirmed_experience text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own profile" ON public.user_profiles;
CREATE POLICY "users read own profile"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "users insert own profile" ON public.user_profiles;
CREATE POLICY "users insert own profile"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users update own profile" ON public.user_profiles;
CREATE POLICY "users update own profile"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS set_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER set_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Application tracker
CREATE TABLE IF NOT EXISTS public.user_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company text NOT NULL,
  role text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','interviewing','offer','rejected')),
  scan_score int,
  applied_at date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_applications TO authenticated;
GRANT ALL ON public.user_applications TO service_role;
ALTER TABLE public.user_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own applications" ON public.user_applications;
CREATE POLICY "users read own applications"
  ON public.user_applications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "users insert own applications" ON public.user_applications;
CREATE POLICY "users insert own applications"
  ON public.user_applications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users update own applications" ON public.user_applications;
CREATE POLICY "users update own applications"
  ON public.user_applications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users delete own applications" ON public.user_applications;
CREATE POLICY "users delete own applications"
  ON public.user_applications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS user_applications_user_idx
  ON public.user_applications (user_id, created_at DESC);

-- Seniority corrections via controlled function
CREATE TABLE IF NOT EXISTS public.seniority_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_level text NOT NULL,
  corrected_level text NOT NULL,
  detected_years text,
  industry text,
  resume_text_length int,
  visitor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.seniority_corrections TO service_role;
ALTER TABLE public.seniority_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role reads seniority corrections" ON public.seniority_corrections;
CREATE POLICY "service role reads seniority corrections"
  ON public.seniority_corrections FOR SELECT
  USING (auth.role() = 'service_role');
CREATE OR REPLACE FUNCTION public.log_seniority_correction(
  p_detected_level text,
  p_corrected_level text,
  p_detected_years text DEFAULT null,
  p_industry text DEFAULT null,
  p_resume_text_length int DEFAULT null,
  p_visitor_id text DEFAULT null
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_detected_level NOT IN ('entry','mid','senior','executive')
     OR p_corrected_level NOT IN ('entry','mid','senior','executive') THEN
    RETURN false;
  END IF;

  INSERT INTO public.seniority_corrections
    (detected_level, corrected_level, detected_years, industry, resume_text_length, visitor_id)
  VALUES
    (p_detected_level, p_corrected_level, left(p_detected_years, 40), left(p_industry, 60), p_resume_text_length, left(p_visitor_id, 80));
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_seniority_correction(text, text, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_seniority_correction(text, text, text, text, int, text) TO anon, authenticated;

-- Personal score trend for pulse emails
CREATE OR REPLACE FUNCTION public.get_user_score_trend(p_email text)
RETURNS TABLE (ats_score int, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT us.ats_score, us.created_at
  FROM public.user_scans us
  JOIN auth.users au ON au.id = us.user_id
  WHERE lower(au.email) = lower(p_email)
  ORDER BY us.created_at DESC
  LIMIT 10;
$$;
REVOKE EXECUTE ON FUNCTION public.get_user_score_trend(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_score_trend(text) TO service_role;

-- Shortlist employer workspaces
CREATE TABLE IF NOT EXISTS public.shortlist_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  jd_text text NOT NULL,
  jd_version int NOT NULL DEFAULT 1,
  jurisdiction text NOT NULL DEFAULT 'OTHER' CHECK (jurisdiction IN ('NYC','IL','CA','EU','OTHER')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.shortlist_roles TO authenticated;
GRANT ALL ON public.shortlist_roles TO service_role;
ALTER TABLE public.shortlist_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own roles" ON public.shortlist_roles;
CREATE POLICY "owners read own roles" ON public.shortlist_roles FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners insert own roles" ON public.shortlist_roles;
CREATE POLICY "owners insert own roles" ON public.shortlist_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners update own roles" ON public.shortlist_roles;
CREATE POLICY "owners update own roles" ON public.shortlist_roles FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.shortlist_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.shortlist_roles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text,
  redacted_text text,
  exclusions_applied jsonb,
  parsed_fields jsonb,
  score int,
  flags jsonb,
  signals jsonb,
  interview_questions jsonb,
  level_read text,
  model_version text,
  jd_version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','advanced','rejected')),
  candidate_jurisdiction text DEFAULT 'OTHER',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.shortlist_candidates TO authenticated;
GRANT ALL ON public.shortlist_candidates TO service_role;
ALTER TABLE public.shortlist_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own candidates" ON public.shortlist_candidates;
CREATE POLICY "owners read own candidates" ON public.shortlist_candidates FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners insert own candidates" ON public.shortlist_candidates;
CREATE POLICY "owners insert own candidates" ON public.shortlist_candidates FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners update own candidates" ON public.shortlist_candidates;
CREATE POLICY "owners update own candidates" ON public.shortlist_candidates FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS shortlist_candidates_role_idx ON public.shortlist_candidates (role_id, score DESC);

CREATE TABLE IF NOT EXISTS public.shortlist_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.shortlist_candidates(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_email text,
  action text NOT NULL CHECK (action IN ('advance','reject','override_score','note','notice_sent','alt_review_requested')),
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.shortlist_decisions TO authenticated;
GRANT ALL ON public.shortlist_decisions TO service_role;
ALTER TABLE public.shortlist_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own decisions" ON public.shortlist_decisions;
CREATE POLICY "owners read own decisions" ON public.shortlist_decisions FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners insert own decisions" ON public.shortlist_decisions;
CREATE POLICY "owners insert own decisions" ON public.shortlist_decisions FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS shortlist_decisions_candidate_idx ON public.shortlist_decisions (candidate_id, created_at);

CREATE TABLE IF NOT EXISTS public.shortlist_demographics (
  candidate_id uuid PRIMARY KEY REFERENCES public.shortlist_candidates(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sex text,
  race_ethnicity text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.shortlist_demographics TO authenticated;
GRANT ALL ON public.shortlist_demographics TO service_role;
ALTER TABLE public.shortlist_demographics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own demographics" ON public.shortlist_demographics;
CREATE POLICY "owners read own demographics" ON public.shortlist_demographics FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners insert own demographics" ON public.shortlist_demographics;
CREATE POLICY "owners insert own demographics" ON public.shortlist_demographics FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners update own demographics" ON public.shortlist_demographics;
CREATE POLICY "owners update own demographics" ON public.shortlist_demographics FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.shortlist_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.shortlist_roles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jurisdiction text NOT NULL,
  notice_type text NOT NULL,
  content text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.shortlist_notices TO authenticated;
GRANT ALL ON public.shortlist_notices TO service_role;
ALTER TABLE public.shortlist_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own notices" ON public.shortlist_notices;
CREATE POLICY "owners read own notices" ON public.shortlist_notices FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "owners insert own notices" ON public.shortlist_notices;
CREATE POLICY "owners insert own notices" ON public.shortlist_notices FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

-- Pro subscription state and grants (backend-only)
CREATE TABLE IF NOT EXISTS public.pro_subscribers (
  email text PRIMARY KEY,
  stripe_customer_id text,
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','trialing','past_due','canceled','inactive')),
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pro_subscribers TO service_role;
ALTER TABLE public.pro_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages pro subscribers" ON public.pro_subscribers;
CREATE POLICY "service role manages pro subscribers"
  ON public.pro_subscribers FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
DROP TRIGGER IF EXISTS set_pro_subscribers_updated_at ON public.pro_subscribers;
CREATE TRIGGER set_pro_subscribers_updated_at
  BEFORE UPDATE ON public.pro_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.pro_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  product_id text NOT NULL,
  product_type text,
  product_name text,
  credits integer,
  resume_session_id text,
  job_title text,
  job_company text,
  language text,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pro_grants TO service_role;
ALTER TABLE public.pro_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages pro grants" ON public.pro_grants;
CREATE POLICY "service role manages pro grants"
  ON public.pro_grants FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS pro_grants_email_idx ON public.pro_grants (email, created_at DESC);

-- Detection observability (backend-only)
CREATE TABLE IF NOT EXISTS public.detection_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  industry text,
  confidence text,
  source text,
  margin_ratio numeric,
  tiebreaker_used boolean DEFAULT false,
  transition_detected boolean DEFAULT false,
  grounding_drops integer DEFAULT 0,
  used_fallback boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.detection_telemetry TO service_role;
ALTER TABLE public.detection_telemetry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages detection telemetry" ON public.detection_telemetry;
CREATE POLICY "service role manages detection telemetry"
  ON public.detection_telemetry FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS detection_telemetry_created_idx
  ON public.detection_telemetry (created_at DESC);
CREATE INDEX IF NOT EXISTS detection_telemetry_source_idx
  ON public.detection_telemetry (source, created_at DESC);