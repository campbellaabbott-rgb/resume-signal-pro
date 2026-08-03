-- The daily cap only bound against applications the worker had ALREADY sent.
--
-- agent_sent_today counted agent_submissions WHERE submitted_at >= today.
-- submitted_at is stamped by the WORKER when it actually submits. apply-agent
-- does not set it — it sets released_at, which is the flag the worker gates on.
--
-- So a released packet is a committed send that the cap could not see. The
-- agent runs hourly:
--
--   09:00  cap 5, sent_today reads 0  -> releases 5   (released_at set)
--   10:00  worker has not run yet
--          sent_today STILL reads 0   -> releases 5 more
--   11:00  ... and again
--
-- The ceiling is enforced against the past rather than against the commitment.
-- A slow worker, a worker that is down for a morning, or simply a queue larger
-- than the worker's throughput turns a cap of 5 into 5-per-hour. That is the
-- precise harm the column's own comment was written to prevent:
--
--   'a runaway loop that applies to the same employer forty times is a
--    reputational event for the candidate, not a bug report for us.'
--
-- Nothing has been over-sent, because no worker has ever run. This is a bug
-- found before it could become an incident, which is the only reason it is a
-- one-line change instead of an apology to a candidate.
--
-- A released packet is therefore counted the moment it is released, and stops
-- being double-counted once it is submitted: the two branches are mutually
-- exclusive, so each row contributes exactly one.
--
-- IT ALSO UNBLOCKS MULTIPLE SEARCHES PER USER. agent_mandates is keyed
-- user_id PRIMARY KEY today, so one candidate can express exactly one search.
-- Lifting that is only safe once the cap is a genuine per-user ceiling rather
-- than a per-mandate one — otherwise four saved searches at cap 20 authorise
-- eighty applications a day in one person's name. This function is per-user
-- and now counts commitments, so it holds across however many mandates a user
-- has. The schema change can follow safely.

CREATE OR REPLACE FUNCTION public.agent_sent_today(p_user uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.agent_submissions
  WHERE user_id = p_user
    AND (
      -- Actually sent today.
      submitted_at >= date_trunc('day', now())
      -- Or released today and still in flight. Mutually exclusive with the
      -- branch above, so a row released AND submitted today counts once.
      OR (submitted_at IS NULL AND released_at >= date_trunc('day', now()))
    );
$$;

REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.agent_sent_today(uuid) IS
  'Applications COMMITTED today for this user: submitted, or released and awaiting the worker. Counts commitments rather than completions, so the daily cap cannot be exceeded by releasing faster than the worker sends. Per-user, so it holds across multiple mandates.';
