CREATE TABLE IF NOT EXISTS public.agent_searches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'My search' CHECK (length(trim(label)) BETWEEN 1 AND 60),
  active boolean NOT NULL DEFAULT true,
  q text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  remote_only boolean NOT NULL DEFAULT false,
  salary_min integer,
  daily_count integer NOT NULL DEFAULT 5 CHECK (daily_count BETWEEN 1 AND 10),
  last_run_at timestamptz,
  last_run_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_searches_user_label
  ON public.agent_searches (user_id, lower(trim(label)));

CREATE INDEX IF NOT EXISTS agent_searches_active
  ON public.agent_searches (user_id) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_searches TO authenticated;
GRANT ALL ON public.agent_searches TO service_role;
ALTER TABLE public.agent_searches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_searches_owner" ON public.agent_searches;
CREATE POLICY "agent_searches_owner" ON public.agent_searches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.agent_searches_cap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.agent_searches
    WHERE user_id = NEW.user_id AND active AND id <> COALESCE(NEW.id, -1);
  IF NEW.active AND n >= 10 THEN
    RAISE EXCEPTION 'at most 10 active searches per user (have %)', n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_searches_cap_trg ON public.agent_searches;
CREATE TRIGGER agent_searches_cap_trg
  BEFORE INSERT OR UPDATE ON public.agent_searches
  FOR EACH ROW EXECUTE FUNCTION public.agent_searches_cap();

INSERT INTO public.agent_searches (user_id, label, active, q, category, location, remote_only, salary_min, daily_count)
SELECT m.user_id, 'My search', m.active, m.q, m.category, m.location, m.remote_only, m.salary_min, m.daily_count
FROM public.agent_mandates m
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_searches s WHERE s.user_id = m.user_id
);

COMMENT ON TABLE public.agent_searches IS
  'Saved search criteria, many per candidate. The applicant PROFILE and the global settings (apply_mode, auto_apply_daily_cap, standing answers, resume) stay on agent_mandates, one row per user — duplicating those per search would let two copies of a factual claim about the candidate diverge.';