-- CONTROLS A CANDIDATE NEEDS BEFORE LETTING SOFTWARE APPLY IN THEIR NAME,
-- plus the reach number that has to be true at the point of sale.
--
-- WHAT ALREADY EXISTED: daily_count (1..10) and salary_min. Those are real caps
-- and are left alone. What was missing is everything about WHERE it may apply.
--
-- 1. blocked_companies — the one with career consequences. Anyone currently
--    employed needs "never apply to my employer", and today there is no way to
--    say it. An agent that applies to your own company on your behalf is not a
--    bug report, it is a resignation letter you did not write.
--
-- 2. paused_until / pause_reason — `active` is a switch you must remember to
--    flip back. "Pause two weeks, I am on holiday" is the real request, and a
--    pause you have to remember to end is one people leave off permanently.
--
-- 3. employer_cooldown_days — the worker already spaces submissions within a
--    run (APPLY_EMPLOYER_GAP_MS), but nothing stops eight applications to one
--    employer across eight consecutive days. From the receiving end that is a
--    burst, however reasonable each one looks alone, and it is the candidate's
--    reputation being spent.
--
-- REACH. The agent can auto-submit to four vendors — the four the worker
-- actually dispatches on. SmartRecruiters is deliberately NOT among them: the
-- adapter is written and correct, but the vendor 403s headless browsers
-- (RECON.md "Written but not served", re-measured 2026-08-01), and getting past
-- that would mean evading bot detection, which is out of bounds. Counting its
-- 44,410 postings as reachable would inflate the published number by 146%.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS blocked_companies text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS pause_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS employer_cooldown_days integer NOT NULL DEFAULT 14;

DO $$ BEGIN
  ALTER TABLE public.agent_mandates
    ADD CONSTRAINT agent_mandates_cooldown_sane
    CHECK (employer_cooldown_days BETWEEN 0 AND 365);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.agent_mandates.blocked_companies IS
  'Employers this candidate will never be applied to. Matched case-insensitively on the '
  'posting company name. Empty array means no exclusions — never treat empty as "block all".';
COMMENT ON COLUMN public.agent_mandates.paused_until IS
  'Auto-resume timestamp. NULL means not paused. Distinct from active=false, which is an '
  'indefinite off switch the candidate must remember to reverse.';
COMMENT ON COLUMN public.agent_mandates.employer_cooldown_days IS
  'Minimum days between applications to the SAME employer. Protects the candidate from '
  'looking like a burst to one recruiter. 0 disables.';

-- Has this candidate applied to this employer inside their cooldown window?
-- SECURITY DEFINER because apply-agent asks on the candidate's behalf and
-- agent_submissions is not readable by anon.
CREATE OR REPLACE FUNCTION public.agent_employer_in_cooldown(
  p_user_id uuid,
  p_company text,
  p_days integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- 0 disables the rule. A blank company cannot be matched, and guessing
    -- would block every unnamed posting, so it is explicitly not in cooldown.
    WHEN p_days IS NULL OR p_days <= 0 OR coalesce(btrim(p_company), '') = '' THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.agent_submissions s
      WHERE s.user_id = p_user_id
        AND lower(btrim(s.company)) = lower(btrim(p_company))
        AND s.submitted_at IS NOT NULL
        AND s.submitted_at > now() - make_interval(days => p_days)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.agent_employer_in_cooldown(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_employer_in_cooldown(uuid, text, integer) TO service_role;

-- THE NUMBER WE ARE ALLOWED TO PUBLISH.
--
-- Cached in job_board_meta because the board is ~570k rows and this is rendered
-- on a marketing surface. The (source, posted_at) index makes the recount cheap,
-- but not cheap enough to run per pageview.
CREATE OR REPLACE FUNCTION public.agent_reach(p_max_age_minutes integer DEFAULT 360)
RETURNS TABLE (drivable integer, board_total integer, vendors text[], computed_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- MUST match the vendors worker/src/index.ts dispatches on. Adding one here
  -- without an adapter publishes a promise the worker cannot keep, so
  -- src/test/agent-reach-honesty.test.ts pins the two lists against each other.
  v_vendors text[] := ARRAY['breezy', 'teamtailor', 'personio', 'pinpoint'];
  v_cached  jsonb;
  v_drivable integer;
  v_total    integer;
BEGIN
  SELECT v INTO v_cached FROM public.job_board_meta
   WHERE k = 'agent_reach'
     AND updated_at > now() - make_interval(mins => greatest(coalesce(p_max_age_minutes, 360), 5));

  IF v_cached IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_cached->>'drivable')::int,
      (v_cached->>'board_total')::int,
      v_vendors,
      (v_cached->>'computed_at')::timestamptz;
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_drivable
    FROM public.job_board_postings WHERE source = ANY(v_vendors);
  SELECT count(*)::int INTO v_total FROM public.job_board_postings;

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('agent_reach',
          jsonb_build_object('drivable', v_drivable, 'board_total', v_total,
                             'computed_at', now()),
          now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  RETURN QUERY SELECT v_drivable, v_total, v_vendors, now();
END;
$$;

COMMENT ON FUNCTION public.agent_reach(integer) IS
  'How much of the board the apply agent can actually auto-submit to. Counts ONLY the four '
  'vendors worker/src/index.ts dispatches on — SmartRecruiters is excluded on purpose (adapter '
  'written, vendor 403s headless), and including it would overstate reach by 146%. Cached in '
  'job_board_meta; anon may execute because this number belongs on the pricing page.';

REVOKE ALL ON FUNCTION public.agent_reach(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_reach(integer) TO anon, authenticated, service_role;
