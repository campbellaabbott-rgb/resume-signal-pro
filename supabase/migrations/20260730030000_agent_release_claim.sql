-- Releasing a packet, and claiming one to send.
--
-- GAP THIS CLOSES: the orchestrator ran decideRelease and counted the result in
-- its run summary, but never wrote it down. A packet reached status='ready' and
-- nothing recorded whether it was cleared to SEND — so the worker had no way to
-- tell "prepared, awaiting review" from "prepared, approved, go". The release
-- decision existed only in a log line.
ALTER TABLE public.agent_submissions
  -- Set by the orchestrator in auto mode, or by the candidate in review mode.
  -- NULL means nothing may send it. This is the flag the worker gates on.
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  -- Why it was NOT released, from decideRelease. Kept so "the agent did nothing
  -- last night" is answerable from the row itself rather than from logs nobody
  -- reads: review-mode / not-ready / vendor-needs-human / daily-cap / duplicate
  -- / fit-below-floor / fit-unknown.
  ADD COLUMN IF NOT EXISTS release_refusal text NOT NULL DEFAULT '',
  -- Worker lease. Set when a worker takes the row, cleared when it finishes.
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS agent_submissions_sendable_idx
  ON public.agent_submissions (released_at)
  WHERE status = 'ready' AND released_at IS NOT NULL AND claimed_at IS NULL;

-- Atomic claim. Two workers polling the same queue would otherwise both read a
-- ready row and both submit it — one application becoming two at a real
-- employer, under a real person's name, with no way to withdraw either. The
-- UPDATE ... WHERE claimed_at IS NULL is the lock: exactly one caller wins.
--
-- Deliberately claims ONE row per call. Batch-claiming would be faster and would
-- also mean a crashed worker strands a whole batch behind a lease instead of one
-- posting.
CREATE OR REPLACE FUNCTION public.agent_claim_submission(p_worker text, p_lease_minutes integer DEFAULT 10)
RETURNS SETOF public.agent_submissions
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.agent_submissions s
  SET claimed_at = now(), claimed_by = p_worker, attempts = s.attempts + 1
  WHERE s.id = (
    SELECT c.id FROM public.agent_submissions c
    WHERE c.status = 'ready'
      AND c.released_at IS NOT NULL
      AND c.submitted_at IS NULL
      -- Reclaim a lease from a worker that died mid-run. The lease is generous
      -- because a slow form is not a dead worker, and reclaiming too eagerly is
      -- how the same posting gets submitted twice.
      AND (c.claimed_at IS NULL OR c.claimed_at < now() - make_interval(mins => GREATEST(p_lease_minutes, 5)))
      -- Three attempts and it stops. A form we cannot drive is a bug to fix, not
      -- a thing to keep hammering at an employer.
      AND c.attempts < 3
    ORDER BY c.released_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.agent_claim_submission(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_claim_submission(text, integer) TO service_role;

-- An UNCERTAIN outcome is its own state, and the reason this is a function
-- rather than an update the worker writes itself.
--
-- If a submit times out we do not know whether the application landed. Marking
-- it failed invites a retry that could double-apply; marking it submitted claims
-- something we did not observe. Neither is honest. It becomes status='blocked'
-- with a blocker a human resolves, and — critically — attempts is pushed past
-- the retry ceiling so no worker can pick it up again.
CREATE OR REPLACE FUNCTION public.agent_mark_uncertain(p_id bigint, p_reason text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.agent_submissions
  SET status = 'blocked',
      claimed_at = NULL,
      claimed_by = '',
      attempts = 99,
      blockers = blockers || jsonb_build_array(
        jsonb_build_object('kind', 'uncertain-submit', 'detail', p_reason)),
      updated_at = now()
  WHERE id = p_id AND submitted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.agent_mark_uncertain(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_mark_uncertain(bigint, text) TO service_role;

COMMENT ON FUNCTION public.agent_claim_submission(text, integer) IS
  'Atomically leases one released packet. Exactly one worker wins; a stale lease is reclaimed after p_lease_minutes; attempts>=3 is never picked up.';
COMMENT ON FUNCTION public.agent_mark_uncertain(bigint, text) IS
  'A submit whose outcome could not be confirmed. Parks the packet for a human and puts it beyond retry — an ambiguous send must never become two sends.';
