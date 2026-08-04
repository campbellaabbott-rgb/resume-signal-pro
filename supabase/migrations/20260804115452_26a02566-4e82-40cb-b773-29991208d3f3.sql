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

CREATE OR REPLACE FUNCTION public.agent_reach(p_max_age_minutes integer DEFAULT 360)
RETURNS TABLE (drivable integer, board_total integer, vendors text[], computed_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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