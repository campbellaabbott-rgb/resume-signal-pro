CREATE TABLE IF NOT EXISTS public.agent_submissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  posting_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  company_token text NOT NULL DEFAULT '',
  apply_url text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing','ready','blocked','submitted','failed','stale')),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  questions_are_real boolean NOT NULL DEFAULT false,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  resume_version_id uuid,
  cover_letter text NOT NULL DEFAULT '',
  fit_pct integer,
  prepared_at timestamptz,
  submitted_at timestamptz,
  submitted_via text,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, posting_id)
);

GRANT SELECT, UPDATE ON public.agent_submissions TO authenticated;
GRANT ALL ON public.agent_submissions TO service_role;

CREATE INDEX IF NOT EXISTS agent_submissions_user_status_idx
  ON public.agent_submissions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_submissions_ready_idx
  ON public.agent_submissions (user_id, prepared_at DESC)
  WHERE status = 'ready';

ALTER TABLE public.agent_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_submissions_owner_read" ON public.agent_submissions;
CREATE POLICY "agent_submissions_owner_read" ON public.agent_submissions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_submissions_owner_update" ON public.agent_submissions;
CREATE POLICY "agent_submissions_owner_update" ON public.agent_submissions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.agent_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION 'agent_submissions: status=submitted requires submitted_at';
  END IF;
  IF NEW.status = 'submitted' AND coalesce(NEW.submitted_via, '') = '' THEN
    RAISE EXCEPTION 'agent_submissions: status=submitted requires submitted_via';
  END IF;
  IF NEW.status = 'ready' AND jsonb_array_length(coalesce(NEW.blockers, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'agent_submissions: status=ready cannot carry blockers';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION 'agent_submissions: submitted_at cannot be cleared';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_submissions_guard_trg ON public.agent_submissions;
CREATE TRIGGER agent_submissions_guard_trg
  BEFORE INSERT OR UPDATE ON public.agent_submissions
  FOR EACH ROW EXECUTE FUNCTION public.agent_submissions_guard();

COMMENT ON TABLE public.agent_submissions IS
  'Ready-to-submit application packets. submitted_at is stamped only by a confirmed send from the candidate''s own browser session.';