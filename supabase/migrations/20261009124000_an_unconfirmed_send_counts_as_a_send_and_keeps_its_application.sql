-- AN UNCONFIRMED SEND COUNTS AS A SEND, AND KEEPS ITS APPLICATION.
--
-- WHAT WAS WRONG (sweep S11-044). A submit the worker pressed and could not
-- confirm goes to agent_mark_uncertain, which parks the packet as 'blocked'
-- with attempts = 99 and no submitted_at. Every control that stops a burst on
-- one recruiter's desk counted submitted_at only:
--   - the claim's cooldown park and its daily cap,
--   - agent_employer_in_cooldown (sent rows, or ready rows under 3 attempts),
--   - agent_sent_today,
-- so Acme's second packet was claimable at once, and in review mode two
-- approved same-employer packets went out about two minutes apart. And the
-- pass refund trigger read 'blocked' with attempts >= 99 as a send that never
-- happened, so the pass gave the application back for what was most likely a
-- real application (confirmed.ts calls its own phrases guesses, so a first
-- send to a vendor is the likeliest to end unconfirmed).
--
-- NOW: agent_mark_uncertain stamps uncertain_at. An unconfirmed send counts as
-- a send, from that moment, in the claim's cooldown park and daily cap, in
-- agent_employer_in_cooldown and in agent_sent_today. The refund trigger and
-- the pass settlement at close (agent_pass_packet_gives_back) never give one
-- back: only a person can say it did not arrive (agent_packet_decide
-- 'not_sent', 20261009124100), which clears the stamp and gives it back.
--
-- Function bodies are the live ones (agent_claim_submission from
-- 20261009121000, agent_employer_in_cooldown from 20261005133000,
-- agent_sent_today from 20260827190000, the refund trigger from
-- 20260917170000, agent_pass_packet_gives_back from 20261008132000) with only
-- the predicates named above changed. Nothing here is callable by a client
-- that could not call it before. Safe to re-run.

ALTER TABLE public.agent_submissions ADD COLUMN IF NOT EXISTS uncertain_at timestamptz;
COMMENT ON COLUMN public.agent_submissions.uncertain_at IS
  'When the worker pressed submit and could not confirm the outcome (agent_mark_uncertain). Counts as a send for the cooldown and the daily cap; never refunded until a person says it did not arrive (20261009124000).';

-- Packets parked as unconfirmed before the stamp existed.
UPDATE public.agent_submissions s
   SET uncertain_at = coalesce(s.updated_at, now())
 WHERE s.uncertain_at IS NULL
   AND s.submitted_at IS NULL
   AND s.attempts >= 99
   AND jsonb_typeof(s.blockers) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.blockers) AS b(v) WHERE b.v->>'kind' = 'uncertain-submit');

-- ── the refund never gives back an unconfirmed send ────────────────────────

CREATE OR REPLACE FUNCTION public.agent_pass_refund_on_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  );
  IF v_role IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;
  -- Pressed and not confirmed: probably sent. Given back only when a person
  -- says it did not arrive, which clears the stamp (20261009124000).
  IF NEW.uncertain_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'stale'
     OR (NEW.status = 'blocked' AND (NEW.attempts >= 99 OR coalesce(NEW.error, '') <> '')) THEN
    UPDATE public.agent_passes ap
       SET applications_used = greatest(ap.applications_used - 1, 0)
     WHERE ap.id = NEW.pass_id;
    UPDATE public.agent_submissions s
       SET pass_refunded_at = now()
     WHERE s.id = NEW.id AND s.pass_refunded_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS agent_pass_refund_trg ON public.agent_submissions;
CREATE TRIGGER agent_pass_refund_trg
  AFTER INSERT OR UPDATE OF status ON public.agent_submissions
  FOR EACH ROW
  WHEN (NEW.pass_id IS NOT NULL AND NEW.pass_refunded_at IS NULL)
  EXECUTE FUNCTION public.agent_pass_refund_on_failure();

REVOKE ALL ON FUNCTION public.agent_pass_refund_on_failure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_refund_on_failure() TO service_role;

-- ── the worker's unconfirmed submit ────────────────────────────────────────

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
      uncertain_at = coalesce(uncertain_at, now()),
      blockers = blockers || jsonb_build_array(
        jsonb_build_object('kind', 'uncertain-submit', 'detail', p_reason)),
      updated_at = now()
  WHERE id = p_id AND submitted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.agent_mark_uncertain(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_mark_uncertain(bigint, text) TO service_role;

COMMENT ON FUNCTION public.agent_mark_uncertain(bigint, text) IS
  'A submit whose outcome could not be confirmed. Parks the packet for a human, puts it beyond retry, and stamps uncertain_at, so it counts as a send for the cooldown and the daily cap and is never refunded on its own (20261009124000).';

-- ── the cooldown counts an unconfirmed send ────────────────────────────────

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
        AND (
          (s.submitted_at IS NOT NULL AND s.submitted_at > now() - make_interval(days => p_days))
          -- Pressed and not confirmed: as likely sent as not, so it counts.
          OR (s.submitted_at IS NULL AND s.uncertain_at IS NOT NULL
              AND s.uncertain_at > now() - make_interval(days => p_days))
          -- Released, unsent, and still able to go: under the claim's attempt
          -- ceiling and released inside the window.
          OR (s.submitted_at IS NULL AND s.released_at IS NOT NULL AND s.status = 'ready'
              AND s.attempts < 3
              AND s.released_at > now() - make_interval(days => p_days))
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.agent_employer_in_cooldown(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_employer_in_cooldown(uuid, text, integer) TO service_role;

-- ── the claim's cooldown park and daily cap count an unconfirmed send ───────

CREATE OR REPLACE FUNCTION public.agent_claim_submission(p_worker text, p_lease_minutes integer DEFAULT 10)
RETURNS SETOF public.agent_submissions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease interval := make_interval(mins => GREATEST(coalesce(p_lease_minutes, 10), 5));
  v_row public.agent_submissions;
BEGIN
  -- PARK what the candidate has since refused. Released, unsent, unleased
  -- packets for an employer now on the blocklist, or one already applied to
  -- inside the cooldown, are taken out of the claimable set with the reason
  -- written where the candidate reads it. A pass-funded one is given back by
  -- the refund trigger (blocked, with an error, written by the pipeline).
  UPDATE public.agent_submissions s
     SET status = 'blocked',
         error = 'blocked-company: you asked the agent never to apply to this employer, so this was not sent',
         claimable_at = NULL
    FROM public.agent_mandates m
   WHERE m.user_id = s.user_id
     AND s.status = 'ready' AND s.released_at IS NOT NULL AND s.submitted_at IS NULL
     AND (s.claimed_at IS NULL OR s.claimed_at < now() - v_lease)
     AND coalesce(btrim(s.company), '') <> ''
     AND EXISTS (
       SELECT 1 FROM unnest(coalesce(m.blocked_companies, '{}'::text[])) AS b(name)
        WHERE lower(btrim(b.name)) = lower(btrim(s.company))
     );

  -- A send the worker pressed and could not confirm counts as an application
  -- to that employer (uncertain_at, 20261009124000).
  UPDATE public.agent_submissions s
     SET status = 'blocked',
         error = 'employer-cooldown: another application went to this employer inside your cooldown, so this was not sent',
         claimable_at = NULL
    FROM public.agent_mandates m
   WHERE m.user_id = s.user_id
     AND s.status = 'ready' AND s.released_at IS NOT NULL AND s.submitted_at IS NULL
     AND (s.claimed_at IS NULL OR s.claimed_at < now() - v_lease)
     AND coalesce(m.employer_cooldown_days, 0) > 0
     AND coalesce(btrim(s.company), '') <> ''
     AND EXISTS (
       SELECT 1 FROM public.agent_submissions d
        WHERE d.user_id = s.user_id AND d.id <> s.id
          AND lower(btrim(d.company)) = lower(btrim(s.company))
          AND coalesce(d.submitted_at, d.uncertain_at) IS NOT NULL
          AND coalesce(d.submitted_at, d.uncertain_at) > now() - make_interval(days => m.employer_cooldown_days)
     );

  -- Into a row variable and RETURN NEXT, not RETURN QUERY over the UPDATE:
  -- some servers run RETURN QUERY through a cursor, which refuses a
  -- data-modifying statement.
  UPDATE public.agent_submissions s
     SET claimed_at = now(), claimed_by = p_worker, attempts = s.attempts + 1
   WHERE s.id = (
     SELECT c.id
       FROM public.agent_submissions c
       JOIN public.agent_mandates m ON m.user_id = c.user_id
      WHERE c.status = 'ready'
        AND c.released_at IS NOT NULL
        AND c.submitted_at IS NULL
        AND (c.claimable_at IS NULL OR c.claimable_at <= now())
        AND (c.claimed_at IS NULL OR c.claimed_at < now() - v_lease)
        AND c.attempts < 3
        -- The stop button and the timed pause, at the gate that sends.
        AND m.active = true
        AND (m.paused_until IS NULL OR m.paused_until <= now())
        -- Funded: the pass stamped on the row (a pass that already gave this
        -- application back funds it only while it can charge it again:
        -- agent_packet_pass_funds, 20261009121000), or a live subscription that is
        -- this ACCOUNT's (agent_subscription_live: bound to it, or on a
        -- mailbox it proved) — the read apply-broker makes after the claim.
        AND (public.agent_packet_pass_funds(c.pass_id, c.pass_refunded_at) OR public.agent_subscription_live(c.user_id))
        -- Today's sends, an unconfirmed one included.
        AND (
          SELECT count(*) FROM public.agent_submissions d
           WHERE d.user_id = c.user_id
             AND coalesce(d.submitted_at, d.uncertain_at) >= date_trunc('day', now())
        ) < m.auto_apply_daily_cap
      ORDER BY c.released_at ASC
      FOR UPDATE OF c SKIP LOCKED
      LIMIT 1
   )
  RETURNING s.* INTO v_row;
  IF v_row.id IS NOT NULL THEN
    RETURN NEXT v_row;
  END IF;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_claim_submission(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_claim_submission(text, integer) TO service_role;

COMMENT ON FUNCTION public.agent_claim_submission(text, integer) IS
  'Hands one ready packet to a worker. Gates: released, unsent, past its cancel window, not leased, under 3 attempts, the mandate on and not paused, funded (pass on the row or a live subscription), and under the daily cap. Parks released packets for a blocked employer or one inside the cooldown first. An unconfirmed send counts as a send for both (20261009124000).';

-- ── today's count includes an unconfirmed send ─────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_sent_today(p_user uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The worker legitimately asks about other users; a person may only ask
  -- about themselves. A null uid (anon reaching this despite the REVOKE, or a
  -- malformed JWT) fails the second test and is refused.
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user) THEN
    RAISE EXCEPTION 'agent_sent_today: you may only read your own count'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT count(*)::integer
    FROM public.agent_submissions
    WHERE user_id = p_user
      AND (
        -- Actually sent today.
        submitted_at >= date_trunc('day', now())
        -- Or released today and still in flight. One row counts once.
        OR (submitted_at IS NULL AND released_at >= date_trunc('day', now()))
        -- Or pressed today and not confirmed.
        OR (submitted_at IS NULL AND uncertain_at >= date_trunc('day', now()))
      )
  );
END;
$$;

-- As the census left it (20261004110000): service_role only. The owner check
-- above stays as the second lock.
REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO service_role;

-- ── a closed pass never gives one back either ──────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_pass_packet_gives_back(s public.agent_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.submitted_at IS NULL
     AND s.uncertain_at IS NULL
     AND (s.claimed_at IS NULL OR s.claimed_at <= now() - interval '10 minutes')
     AND CASE s.status
           WHEN 'failed' THEN true
           WHEN 'stale' THEN true
           WHEN 'ready' THEN s.released_at IS NULL OR s.attempts >= 3
           WHEN 'blocked' THEN NOT (
                 s.released_at IS NOT NULL
             AND NOT (s.attempts >= 99)
             AND coalesce(s.release_refusal, '') <> 'cancelled-by-you'
             AND jsonb_typeof(s.blockers) = 'array'
             AND jsonb_array_length(s.blockers) > 0
             AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(s.blockers) AS b(v)
                WHERE NOT (b.v->>'kind' = 'worker' AND b.v->>'stage' = 'question-unanswerable')
                   OR coalesce(b.v->>'unlearnable', '0') !~ '^0*$'))
           ELSE false
         END;
$$;

REVOKE ALL ON FUNCTION public.agent_pass_packet_gives_back(public.agent_submissions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_packet_gives_back(public.agent_submissions) TO service_role;

-- ── self-check: the catalogue ──────────────────────────────────────────────
DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'agent_submissions' AND column_name = 'uncertain_at'
  ) THEN
    RAISE EXCEPTION '20261009124000: agent_submissions.uncertain_at is missing';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.agent_mark_uncertain(bigint,text)'::regprocedure,
    'public.agent_employer_in_cooldown(uuid,text,integer)'::regprocedure,
    'public.agent_claim_submission(text,integer)'::regprocedure,
    'public.agent_pass_refund_on_failure()'::regprocedure,
    'public.agent_pass_packet_gives_back(public.agent_submissions)'::regprocedure,
    'public.agent_sent_today(uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '20261009124000: % is executable by a client role', v_fn;
    END IF;
    IF position('uncertain_at' IN pg_get_functiondef(v_fn)) = 0 THEN
      RAISE EXCEPTION '20261009124000: % does not read uncertain_at', v_fn;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.agent_submissions'::regclass
       AND t.tgname = 'agent_pass_refund_trg' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '20261009124000: trigger agent_pass_refund_trg is missing';
  END IF;
END $$;

-- ── self-check, exercised ───────────────────────────────────────────────────
-- One pass and one unconfirmed packet on the first account, inside a block
-- that always raises RB000, so nothing survives.
DO $$
DECLARE
  v_uid uuid;
  v_pass uuid;
  v_id bigint;
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_co text;
  v_row public.agent_submissions;
  v_with integer;
BEGIN
  SELECT u.id INTO v_uid FROM auth.users u ORDER BY u.created_at NULLS LAST, u.id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE '20261009124000: no account exists to exercise the stamp against; the catalogue checks above are all that ran';
    RETURN;
  END IF;
  v_co := 'Self-check Co ' || v_tag;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended' WHERE user_id = v_uid AND closed_at IS NULL;
    -- Placeholder numbers, never the pass's own.
    INSERT INTO public.agent_passes (user_id, stripe_session_id, amount_cents, session_hours, applications_total,
                                     applications_used, rate_per_min, daily_quota, shelf_expires_at, activated_at, expires_at)
    VALUES (v_uid, 'cs_self_check_uncertain_' || v_tag, 1, 1, 9, 1, 1, 1, now() + interval '1 day', now(), now() + interval '1 hour')
    RETURNING id INTO v_pass;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id, released_at, attempts, claimed_at, blockers)
    VALUES (v_uid, 'uncertain:' || v_tag, v_co, 'ready', v_pass, now(), 1, now(), '[]')
    RETURNING id INTO v_id;

    PERFORM public.agent_mark_uncertain(v_id, 'self-check: outcome unknown');
    SELECT * INTO v_row FROM public.agent_submissions WHERE id = v_id;
    IF v_row.uncertain_at IS NULL OR v_row.status <> 'blocked' OR v_row.attempts <> 99 THEN
      RAISE EXCEPTION '20261009124000: agent_mark_uncertain did not stamp the packet';
    END IF;
    IF (SELECT ap.applications_used FROM public.agent_passes ap WHERE ap.id = v_pass) <> 1 THEN
      RAISE EXCEPTION '20261009124000: an unconfirmed send gave its pass application back';
    END IF;
    IF public.agent_pass_packet_gives_back(v_row) THEN
      RAISE EXCEPTION '20261009124000: a closed pass would give back an unconfirmed send';
    END IF;
    IF NOT public.agent_employer_in_cooldown(v_uid, v_co, 14) THEN
      RAISE EXCEPTION '20261009124000: an unconfirmed send does not put its employer in cooldown';
    END IF;
    -- Released before today, pressed today: counted by its stamp alone.
    UPDATE public.agent_submissions SET released_at = now() - interval '3 days' WHERE id = v_id;
    v_with := public.agent_sent_today(v_uid);
    UPDATE public.agent_submissions SET uncertain_at = NULL WHERE id = v_id;
    IF v_with <> public.agent_sent_today(v_uid) + 1 THEN
      RAISE EXCEPTION '20261009124000: an unconfirmed send is not counted in today''s sends';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
