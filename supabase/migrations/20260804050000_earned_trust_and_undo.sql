-- THE FIRST APPLICATION YOU DID NOT SEE IS THE FRIGHTENING ONE.
--
-- Everything the agent does is already gated, logged and reversible EXCEPT the
-- moment itself: the first time software submits something in your name while
-- you are asleep. Nothing about the current design makes that moment gentler —
-- a subscriber flips to auto and the next thing they learn is that three
-- applications went out.
--
-- Two additions, both about time rather than permission.
--
-- 1. hold_first_n — the first N releases in auto mode are held for review
--    anyway. Not a restriction: an on-ramp. You watch three go out with your
--    approval, see the receipts, and then it runs. Trust that is earned in
--    three days is worth more than trust asserted at checkout, and it costs
--    the product almost nothing because those three still go out.
--
-- 2. undo_window_seconds — a released packet waits before the worker may claim
--    it, and can be cancelled in that window. Regret about an application is
--    at its sharpest in the first minutes ("not that company"), and today the
--    only way to stop it is to be faster than a worker polling every 300s.
--
-- BOTH DEFAULT TO ON, and that is the point. A safety feature nobody discovers
-- protects nobody. hold_first_n = 3 and a 15-minute window are defaults a
-- confident user can lower to 0, rather than a preference an anxious one has to
-- find.
--
-- WHY THE COUNTER IS A COLUMN AND NOT A COUNT(*). "How many have been released
-- in auto mode" is not the same question as "how many rows exist" — packets get
-- deleted, re-prepared and manually submitted, and any of those would silently
-- reset an on-ramp that is supposed to be one-way.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS hold_first_n integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS auto_released_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS undo_window_seconds integer NOT NULL DEFAULT 900;

DO $$ BEGIN
  ALTER TABLE public.agent_mandates
    ADD CONSTRAINT agent_mandates_onramp_sane
    CHECK (hold_first_n BETWEEN 0 AND 25 AND undo_window_seconds BETWEEN 0 AND 86400);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.agent_mandates.hold_first_n IS
  'Hold this many auto-mode releases for explicit approval before running unattended. '
  'An on-ramp, not a cap — they still go out, you just see them first. 0 disables.';
COMMENT ON COLUMN public.agent_mandates.auto_released_count IS
  'Monotonic count of packets released in AUTO mode. Never derived from row counts: '
  'deletions and manual submissions would reset an on-ramp that must only move forwards.';
COMMENT ON COLUMN public.agent_mandates.undo_window_seconds IS
  'How long a released packet waits before a worker may claim it. The cancel window. '
  '0 disables and the packet is claimable immediately.';

-- The claim gate. apply-broker already refuses on entitlement and `active`;
-- this adds "and not while the candidate can still change their mind".
ALTER TABLE public.agent_submissions
  ADD COLUMN IF NOT EXISTS claimable_at timestamptz;

COMMENT ON COLUMN public.agent_submissions.claimable_at IS
  'Earliest a worker may claim this. Set from the mandate''s undo_window_seconds at release. '
  'NULL means immediately claimable — rows written before this column existed must not be '
  'frozen by it.';

-- Counted at RELEASE, in one statement, so two concurrent runs cannot both see
-- the same count and both decide they are still inside the on-ramp.
CREATE OR REPLACE FUNCTION public.agent_note_auto_release(p_user_id uuid)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.agent_mandates
     SET auto_released_count = auto_released_count + 1
   WHERE user_id = p_user_id
  RETURNING auto_released_count;
$$;

REVOKE ALL ON FUNCTION public.agent_note_auto_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_note_auto_release(uuid) TO service_role;

-- Cancelling is the candidate's own act, so it is theirs to perform — but only
-- inside the window and only on something not yet claimed. After that the
-- honest answer is "too late", not a silent no-op that looks like success.
CREATE OR REPLACE FUNCTION public.agent_cancel_pending(p_submission_id bigint)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.agent_submissions
     SET status = 'blocked',
         release_refusal = 'cancelled-by-you',
         claimable_at = NULL
   WHERE id = p_submission_id
     AND user_id = auth.uid()          -- yours only, enforced here not in the client
     AND submitted_at IS NULL          -- never "cancel" something already sent
     AND claimed_at IS NULL            -- a worker already has it; too late to be sure
     AND claimable_at IS NOT NULL
     AND claimable_at > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_cancel_pending(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_cancel_pending(bigint) TO authenticated, service_role;

-- THE WINDOW HAS TO BE ENFORCED WHERE THE CLAIM HAPPENS, or it is decorative.
--
-- apply-agent writes claimable_at, but agent_claim_submission decides what a
-- worker may take. Without this predicate the column would be a value nothing
-- reads — a cancel button that looks present and stops nothing, which is worse
-- than no button at all.
--
-- Rewritten in full rather than patched, because CREATE OR REPLACE on a function
-- that already exists must restate the whole body; everything below except the
-- claimable_at line is identical to migration 20260730030000.
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
      -- THE CANCEL WINDOW. NULL means immediately claimable, which is what every
      -- row written before this column existed has — reading NULL as "not yet"
      -- would freeze the entire existing queue permanently.
      AND (c.claimable_at IS NULL OR c.claimable_at <= now())
      AND (c.claimed_at IS NULL OR c.claimed_at < now() - make_interval(mins => GREATEST(p_lease_minutes, 5)))
      AND c.attempts < 3
    ORDER BY c.released_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.agent_claim_submission(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_claim_submission(text, integer) TO service_role;
