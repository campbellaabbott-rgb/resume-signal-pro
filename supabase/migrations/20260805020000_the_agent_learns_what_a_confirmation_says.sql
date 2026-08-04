-- EVERY PHRASE IN CONFIRMED_RE IS A GUESS, AND NOTHING TOLD US WHEN ONE MISSED.
--
-- When the worker submits and cannot recognise the confirmation page, it calls
-- agent_mark_uncertain, which parks the row (attempts = 99, never re-claimable)
-- and records what the page actually said in `blockers`. That is exactly the
-- right behaviour for the CANDIDATE — their application is never silently
-- retried — and it is a dead end for everybody else.
--
-- The wording is the one piece of evidence that would fix the guess, and it sat
-- in a jsonb column nobody aggregates. So the failure mode is: a vendor's real
-- confirmation says something not on the list, EVERY send to that vendor parks
-- for review, the agent appears to do nothing unattended, and the sentence that
-- would fix it is sitting in the database being read by no one.
--
-- WHY THIS IS SAFE TO SURFACE. The stored detail also carries the apply URL,
-- which would tie a submission to a candidate. This returns ONLY the page's own
-- words — employer text on a public page after a submit — with no user, no
-- posting id and no URL. That is what makes it safe to read without a session,
-- which is what lets the heartbeat carry it where somebody will actually see it.

CREATE OR REPLACE FUNCTION public.agent_confirmation_gaps(p_days integer DEFAULT 30)
RETURNS TABLE(wording text, occurrences bigint, last_seen timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH blk AS (
    SELECT s.updated_at,
           jsonb_array_elements(COALESCE(s.blockers, '[]'::jsonb)) AS b
      FROM public.agent_submissions s
     WHERE s.updated_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 30), 1))
  ),
  said AS (
    SELECT updated_at,
           -- Capture what follows `page said: "`. The URL sits BEFORE that
           -- marker in the reason string and is therefore dropped, which is the
           -- property that makes this function safe to expose at all.
           left(COALESCE(substring(b->>'detail' from 'page said: "(.*)'), ''), 200) AS wording
      FROM blk
     WHERE b->>'kind' = 'uncertain-submit'
  )
  SELECT wording,
         count(*)          AS occurrences,
         max(updated_at)   AS last_seen
    FROM said
   WHERE length(btrim(wording)) > 0
   GROUP BY wording
   ORDER BY count(*) DESC, max(updated_at) DESC
   LIMIT 25;
$$;

-- Readable without a session, deliberately: the heartbeat is where this becomes
-- visible, and the heartbeat is read without one. Safe because the projection
-- above carries no user, no posting and no URL — only employer page text.
REVOKE ALL ON FUNCTION public.agent_confirmation_gaps(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_confirmation_gaps(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.agent_confirmation_gaps(integer) IS
  'What confirmation pages actually said when the worker could not recognise them. '
  'The evidence that turns a guessed phrase list into a measured one. Returns page '
  'wording only — no user, no posting, no URL — so it is safe to read without a session.';
