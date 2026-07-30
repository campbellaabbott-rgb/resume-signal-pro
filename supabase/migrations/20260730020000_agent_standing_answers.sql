-- Standing answers, the identity profile, and the auto-apply switch.
--
-- WHY THIS EXISTS: without it the agent can never finish an application.
-- buildPacket blocks on any required FACTUAL question it has no answer for —
-- work authorisation, sponsorship, salary expectation, start date, relocation —
-- because guessing at those is not a smaller error than inventing experience. A
-- wrong sponsorship answer can void an application outright. So the candidate
-- states them ONCE here, and from then on the same questions stop being walls.
--
-- These live on the mandate rather than in a separate table because they share
-- its lifecycle exactly: one per account, meaningless without it, and read on
-- every prepare. A join would buy nothing.

ALTER TABLE public.agent_mandates
  -- Identity, for the fields every form asks and no résumé should have to be
  -- parsed for. Nullable throughout: a half-filled profile still produces
  -- packets, it just produces more blockers, and the UI can say which.
  ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS linkedin text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resume_file_url text NOT NULL DEFAULT '',

  -- The factual answers. TRINARY on purpose — NULL means "not stated", which is
  -- different from "No". A default of false would have the agent tell employers
  -- a candidate is not authorised to work when they simply never answered, which
  -- is worse than blocking. Same reasoning as work_mode on the board: unknown is
  -- a real value and must not be collapsed into a negative.
  ADD COLUMN IF NOT EXISTS work_authorized boolean,
  ADD COLUMN IF NOT EXISTS requires_sponsorship boolean,
  ADD COLUMN IF NOT EXISTS willing_to_relocate boolean,
  ADD COLUMN IF NOT EXISTS salary_expectation text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS earliest_start text NOT NULL DEFAULT '',

  -- Voluntary self-ID. Default false = the agent declines on the candidate's
  -- behalf. Opting in is an explicit act, never a default, and never inferred.
  ADD COLUMN IF NOT EXISTS share_demographics boolean NOT NULL DEFAULT false,

  -- THE SWITCH.
  --   review : prepare packets, wait for the candidate to release each one
  --   auto   : prepare and release automatically, up to the daily cap
  -- Defaults to review. Somebody who set up a mandate weeks ago for a queue they
  -- read each morning must not wake up to find applications went out overnight
  -- because a column appeared with a bolder default.
  ADD COLUMN IF NOT EXISTS apply_mode text NOT NULL DEFAULT 'review'
    CHECK (apply_mode IN ('review', 'auto')),

  -- A hard ceiling on sends per day, separate from daily_count (which caps how
  -- many jobs are QUEUED). Preparing ten and sending ten are different promises,
  -- and a runaway loop that applies to the same employer forty times is a
  -- reputational event for the candidate, not a bug report for us.
  ADD COLUMN IF NOT EXISTS auto_apply_daily_cap integer NOT NULL DEFAULT 5
    CHECK (auto_apply_daily_cap BETWEEN 1 AND 20),

  -- Auto mode only ever releases where the agent needs no human step at all —
  -- the measured zero-CAPTCHA vendors. Stored rather than hardcoded so a
  -- candidate can narrow it further, and so widening it is a deliberate act.
  ADD COLUMN IF NOT EXISTS auto_apply_sources text[] NOT NULL
    DEFAULT ARRAY['greenhouse','smartrecruiters','bamboohr','workable','oracle',
                  'breezy','teamtailor','rippling','recruitee']::text[];

COMMENT ON COLUMN public.agent_mandates.work_authorized IS
  'Trinary: NULL means not stated. Never defaulted to false — telling an employer someone is not authorised to work because they did not answer is worse than blocking the packet.';
COMMENT ON COLUMN public.agent_mandates.apply_mode IS
  'review (default) prepares and waits; auto releases up to auto_apply_daily_cap on zero-CAPTCHA vendors only.';

-- How many did the agent actually send today? The cap is meaningless without a
-- count that cannot be gamed by a client, so it reads the packets themselves —
-- the same rows that carry the submitted_at guard trigger.
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
