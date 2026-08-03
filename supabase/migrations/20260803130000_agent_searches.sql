-- Several saved searches per candidate, instead of exactly one.
--
-- agent_mandates is `user_id uuid PRIMARY KEY`, so a candidate could express
-- ONE set of criteria. Real job seekers do not have one: "Product Manager, NYC,
-- >=140k" and "Program Manager, remote, >=120k" are different searches with
-- different floors, and today you pick one and lose the other.
--
-- WHY A NEW TABLE RATHER THAN RE-KEYING agent_mandates. That row is not only a
-- search. It also carries the applicant PROFILE — full_name, phone, linkedin,
-- city, country, resume_file_url, resume_text, the standing answers, apply_mode
-- and the daily cap. Re-keying it to allow duplicates would duplicate the
-- profile too, and two copies of "are you authorised to work" that can disagree
-- is a worse bug than the one being fixed: an employer reads those as a
-- statement of fact from the candidate.
--
-- So agent_mandates stays exactly what it is — one profile and one set of
-- global settings per user — and the CRITERIA move out to their own table.
-- Nothing about the profile, the entitlement check or the daily cap changes.
--
-- SAFE ONLY BECAUSE THE CAP WAS FIXED FIRST (20260803120000). auto_apply_daily_cap
-- is per-user and agent_sent_today now counts commitments rather than completed
-- sends, so the ceiling holds however many searches a user runs. Landing this
-- before that fix would have turned four searches at cap 20 into eighty
-- applications a day in one person's name.

CREATE TABLE IF NOT EXISTS public.agent_searches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Shown in the UI and in the queue's reason chips, so a candidate can tell
  -- WHICH search produced a pick. Without it a morning queue of eight jobs from
  -- three searches is an undifferentiated list.
  label text NOT NULL DEFAULT 'My search' CHECK (length(trim(label)) BETWEEN 1 AND 60),

  active boolean NOT NULL DEFAULT true,

  -- The criteria themselves. Same names and semantics as the columns they
  -- replace on agent_mandates, so the runner's filter code is unchanged apart
  -- from where it reads them.
  q text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  remote_only boolean NOT NULL DEFAULT false,
  salary_min integer,

  -- How many jobs this search QUEUES per run. Distinct from
  -- auto_apply_daily_cap, which is the per-user ceiling on what may actually be
  -- SENT. Preparing ten and sending ten are different promises.
  daily_count integer NOT NULL DEFAULT 5 CHECK (daily_count BETWEEN 1 AND 10),

  last_run_at timestamptz,
  last_run_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One label per user. Two searches both called "My search" are indistinguishable
-- in the queue, which defeats the reason label exists.
CREATE UNIQUE INDEX IF NOT EXISTS agent_searches_user_label
  ON public.agent_searches (user_id, lower(trim(label)));

-- The runner's access pattern: every active search, grouped by user.
CREATE INDEX IF NOT EXISTS agent_searches_active
  ON public.agent_searches (user_id) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_searches TO authenticated;
GRANT ALL ON public.agent_searches TO service_role;
ALTER TABLE public.agent_searches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_searches_owner" ON public.agent_searches;
CREATE POLICY "agent_searches_owner" ON public.agent_searches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A CEILING ON SEARCHES, enforced in the database rather than in the form.
--
-- Each active search costs two board queries per run, per user, every hour. A
-- client that can create unlimited rows is a client that can make the runner
-- unbounded — and the form is not the only way rows arrive, since RLS lets the
-- owner insert directly. Ten is generous for a real job hunt and finite for us.
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

-- CARRY EVERY EXISTING MANDATE ACROSS. A candidate who set up a search before
-- this migration must not open the page to an empty list and conclude the agent
-- forgot them. Idempotent: re-running inserts nothing, because the label index
-- collides and the WHERE NOT EXISTS guard already excluded them.
INSERT INTO public.agent_searches (user_id, label, active, q, category, location, remote_only, salary_min, daily_count)
SELECT m.user_id, 'My search', m.active, m.q, m.category, m.location, m.remote_only, m.salary_min, m.daily_count
FROM public.agent_mandates m
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_searches s WHERE s.user_id = m.user_id
);

COMMENT ON TABLE public.agent_searches IS
  'Saved search criteria, many per candidate. The applicant PROFILE and the global settings (apply_mode, auto_apply_daily_cap, standing answers, resume) stay on agent_mandates, one row per user — duplicating those per search would let two copies of a factual claim about the candidate diverge.';
