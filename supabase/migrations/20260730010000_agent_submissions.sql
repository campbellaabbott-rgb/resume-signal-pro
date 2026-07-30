-- The submission packet: the seam between the queue and the hands.
--
-- The agent already has a brain (real Greenhouse questions, grounded answers
-- that refuse to fabricate, tailored résumés, tracker dedup) and a queue
-- (agent_mandates -> agent_queue, approve/dismiss). What it has never had is the
-- thing in between: ONE complete, field-by-field object per job that is ready to
-- be submitted, with a state machine saying how far along it is and what — if
-- anything — still needs a human.
--
-- WHY THE PACKET IS A ROW AND NOT A FUNCTION CALL
-- Preparation is slow (questions fetch + answer drafting + résumé tailoring, all
-- LLM-bound) and submission happens later, in a different process, possibly on a
-- different device. A row lets the overnight runner prepare a stack while the
-- user sleeps and lets the hands pick it up whenever they next open the browser.
--
-- WHY SUBMISSION IS NOT A COLUMN THE SERVER SETS BY ITSELF
-- Measured 2026-07-29, not assumed: no vendor exposes a public submit endpoint.
--   POST boards-api.greenhouse.io/v1/boards/{t}/jobs/{id}  -> 401 HTTP Basic
--   POST api.lever.co/v0/postings/{t}                      -> 404 Cannot POST
--   POST api.ashbyhq.com/posting-api/job-board/{t}         -> 401 Unauthorized
-- Every one gates submission behind credentials belonging to the EMPLOYER. There
-- is no third-party path, for us or anyone. So submission means driving the real
-- form, and the only place that can happen without fingerprint spoofing or
-- CAPTCHA evasion is the candidate's own browser session. `submitted_at` is
-- therefore stamped by the hands reporting back, never by a server that decided
-- on its own that it had applied for someone.
--
-- The honesty fence applies here more than anywhere else on the platform: this
-- table records that a real application was sent to a real employer under a real
-- person's name. A packet may never claim an answer is grounded when it is not,
-- and `submitted` may never be set by anything other than a confirmed send.

CREATE TABLE IF NOT EXISTS public.agent_submissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  posting_id text NOT NULL,

  -- Denormalised so the packet is self-describing to the hands, which may run
  -- long after the posting has changed or come down.
  title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  company_token text NOT NULL DEFAULT '',
  apply_url text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',           -- vendor: greenhouse / lever / ...

  -- preparing : assembly in flight
  -- ready     : every field the agent can fill is filled; nothing blocks a send
  -- blocked   : prepared, but something needs the human FIRST (see blockers)
  -- submitted : the hands confirmed a real send
  -- failed    : preparation could not complete; reason in blockers
  -- stale     : the posting closed, or the tracker says this was already applied
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing','ready','blocked','submitted','failed','stale')),

  -- The autofill map: {fieldKey: {value, source, confidence}}. `source` records
  -- WHERE a value came from (profile / resume / drafted / employer-default) so a
  -- reviewer can tell a fact from a generated sentence at a glance.
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The employer's real questions where the vendor publishes them (Greenhouse
  -- only, verified) and clearly-labelled inferred ones everywhere else. Never
  -- presented as real when inferred — that distinction is the whole point.
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  questions_are_real boolean NOT NULL DEFAULT false,

  -- Per-question drafted answers, each carrying its own `supported` flag from
  -- the grounding validator. An unsupported answer is a gap to show the
  -- candidate, not a sentence to send.
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- What the agent CANNOT do, named. captcha / file-upload / demographic /
  -- unanswerable / auth-wall. An empty array is the only thing that may be
  -- called `ready`.
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,

  resume_version_id uuid,                    -- the tailored résumé used, if any
  cover_letter text NOT NULL DEFAULT '',

  fit_pct integer,
  prepared_at timestamptz,
  submitted_at timestamptz,                  -- set ONLY by a confirmed send
  submitted_via text,                        -- 'extension' | 'manual'
  error text NOT NULL DEFAULT '',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One packet per person per posting. This is the duplicate-submission guard at
  -- the storage layer: the tracker catches what a user did by hand, and this
  -- catches the agent racing itself across two devices or two runs.
  UNIQUE (user_id, posting_id)
);

CREATE INDEX IF NOT EXISTS agent_submissions_user_status_idx
  ON public.agent_submissions (user_id, status, created_at DESC);

-- The hands ask "what is ready to send right now"; keep that one index-only hop.
CREATE INDEX IF NOT EXISTS agent_submissions_ready_idx
  ON public.agent_submissions (user_id, prepared_at DESC)
  WHERE status = 'ready';

ALTER TABLE public.agent_submissions ENABLE ROW LEVEL SECURITY;

-- A packet contains a person's name, contact details and drafted answers. It is
-- readable by exactly one account.
DROP POLICY IF EXISTS "agent_submissions_owner_read" ON public.agent_submissions;
CREATE POLICY "agent_submissions_owner_read" ON public.agent_submissions
  FOR SELECT USING (auth.uid() = user_id);

-- The owner may edit answers before sending, and may report a send. They may NOT
-- insert: packets are created by the runner (service role), so a client cannot
-- manufacture a packet for a posting the agent never vetted.
DROP POLICY IF EXISTS "agent_submissions_owner_update" ON public.agent_submissions;
CREATE POLICY "agent_submissions_owner_update" ON public.agent_submissions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- `submitted` is a claim that a real employer received a real application. Guard
-- it at the database so no code path — ours or a client's — can assert it
-- without the evidence that goes with it.
CREATE OR REPLACE FUNCTION public.agent_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION 'agent_submissions: status=submitted requires submitted_at';
  END IF;
  IF NEW.status = 'submitted' AND coalesce(NEW.submitted_via, '') = '' THEN
    RAISE EXCEPTION 'agent_submissions: status=submitted requires submitted_via';
  END IF;
  -- "ready" means nothing is in the way. If anything blocks, the honest status
  -- is `blocked`, however tempting a green light is on a dashboard.
  IF NEW.status = 'ready' AND jsonb_array_length(coalesce(NEW.blockers, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'agent_submissions: status=ready cannot carry blockers';
  END IF;
  -- A send is a fact, not a draft. Once stamped it does not move back, so a
  -- retry cannot quietly turn one application into two.
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
  'Ready-to-submit application packets. submitted_at is stamped only by a confirmed send from the candidate''s own browser session; no vendor exposes a public submit endpoint (measured 2026-07-29: GH 401, Lever 404, Ashby 401).';
