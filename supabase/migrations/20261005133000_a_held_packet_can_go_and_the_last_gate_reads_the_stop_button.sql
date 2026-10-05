-- A HELD PACKET CAN GO, AND THE LAST GATE READS THE STOP BUTTON.
--
-- The apply pipeline's database half, for the defects the 2026-10-04 sweep
-- re-confirmed on main. Every function here is SECURITY DEFINER, service_role
-- only, revoked from PUBLIC, anon and authenticated by name. The owner reaches
-- the two decisions they may make (approve, cancel) through agent-access, which
-- verifies their session and passes the user id — never through a client-role
-- grant, so nothing here widens what the publishable key can call.
--
--  1. agent_packet_decide (register 1.09 / L9-22). A packet held for review —
--     the default on-ramp holds the first three of every auto-mode agent, and
--     review mode holds all of them — had no way to go: released_at was
--     written once, at insert, and no function, RPC or control ever wrote it
--     again, while the account page said "approve it and it goes". Approve
--     releases a waiting packet (with the candidate's cancel window), counts
--     a held one forward on the on-ramp, and refuses when the agent is off,
--     paused, or the employer is on the candidate's blocklist. Cancel stops a
--     packet that has not been claimed — inside the cancel window or before
--     release — which agent_cancel_pending promised and nothing called.
--
--  2. agent_claim_submission (1.44 / L9-25, L9-02). The claim, the LAST gate
--     before a worker types a packet into an employer's form, read neither
--     paused_until nor blocked_companies: a packet released at 09:23 and
--     claimable at 09:38 went out after the candidate blocked the employer or
--     paused for a week at 09:30. It now selects only packets whose mandate is
--     on, not paused, and funded (a live subscription by the account's
--     address, or the pass stamped on the row) — so a renewal gap or an hour
--     switched off no longer spends a packet's three attempts in one poll —
--     and parks, with a stated reason, a released packet whose employer the
--     candidate has since blocked or applied to inside the cooldown.
--     agent_unclaim_submission hands a claim back WITHOUT spending an attempt.
--
--  3. agent_employer_in_cooldown (2.14 / L13-50) counts released-but-unsent
--     packets as well as sent ones, so the second same-employer role in a run
--     is no longer released two minutes after the first.
--
--  4. agent_queue_unprepared (L9-03). apply-agent read the ten newest queue
--     rows, and a row keeps its status after its packet is written, so the
--     window filled with prepared rows and everything past the tenth starved.
--     This read leaves out rows that already have a packet.
--
--  5. agent_work_pending (L9-19). The sender wake counted any 'ready' packet
--     and any agent_subscribers row: once configured it would boot a worker
--     every hour for packets nobody can claim, and never for an account whose
--     only funding is a pass. It now counts exactly what the claim would hand
--     out.
--
--  6. agent_retry_after_learned_answer (L9-07). A question the candidate
--     answers puts the packets it stopped back in line — never one that may
--     already have gone.
--
-- The paid queue's half of the same sweep (agent_queue_enqueue flipping a row
-- it used to call a duplicate, agent_queue_refuse, agent_queue.
-- pass_refunded_at) is in 20261005130000, applied before this file.

-- ── 3. the cooldown counts what is on its way ───────────────────────────────

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
          OR (s.submitted_at IS NULL AND s.released_at IS NOT NULL AND s.status = 'ready')
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.agent_employer_in_cooldown(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_employer_in_cooldown(uuid, text, integer) TO service_role;

-- ── 2. the claim reads the stop button ──────────────────────────────────────

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
          AND d.submitted_at IS NOT NULL
          AND d.submitted_at > now() - make_interval(days => m.employer_cooldown_days)
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
        -- Funded: the pass stamped on the row, or a live subscription on the
        -- account's address (agent_mandates.email is pinned to it by
        -- 20261005130000). apply-broker re-asks the shared predicate after
        -- the claim; this only keeps an unfunded packet from spending its
        -- attempts in one poll.
        AND (
          c.pass_id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM public.agent_subscribers a
             WHERE a.email = lower(btrim(m.email))
               AND a.status IN ('active', 'trialing')
               AND (a.current_period_end IS NULL OR a.current_period_end > now())
          )
        )
        AND (
          SELECT count(*) FROM public.agent_submissions d
           WHERE d.user_id = c.user_id
             AND d.submitted_at >= date_trunc('day', now())
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
  'Hands one ready packet to a worker. Gates: released, unsent, past its cancel window, not leased, under 3 attempts, the mandate on and not paused, funded (pass on the row or a live subscription), and under the daily cap. Parks released packets for a blocked employer or one inside the cooldown first.';

CREATE OR REPLACE FUNCTION public.agent_unclaim_submission(p_submission_id bigint)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- A claim handed back unworked costs no attempt: the broker returns a packet
  -- whose owner is not funded or switched off, and that is not the packet's
  -- failure.
  UPDATE public.agent_submissions
     SET claimed_at = NULL, claimed_by = '', attempts = greatest(attempts - 1, 0)
   WHERE id = p_submission_id AND submitted_at IS NULL AND claimed_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_unclaim_submission(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_unclaim_submission(bigint) TO service_role;

-- ── 1. the owner's two decisions ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_packet_decide(
  p_user_id uuid,
  p_submission_id bigint,
  p_decision text
)
RETURNS TABLE (
  decided_ok boolean,
  decide_reason text,
  decided_claimable_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_claimable timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_submission_id IS NULL OR p_decision NOT IN ('approve', 'cancel') THEN
    RETURN QUERY SELECT false, 'bad_request'::text, NULL::timestamptz; RETURN;
  END IF;

  SELECT s.id AS sid, s.status AS sstatus, s.released_at AS sreleased, s.submitted_at AS ssubmitted,
         s.claimed_at AS sclaimed, s.claimable_at AS sclaimable, s.release_refusal AS srefusal,
         s.company AS scompany,
         m.active AS mactive, m.paused_until AS mpaused, m.blocked_companies AS mblocked,
         m.undo_window_seconds AS mundo
    INTO r
    FROM public.agent_submissions s
    LEFT JOIN public.agent_mandates m ON m.user_id = s.user_id
   WHERE s.id = p_submission_id AND s.user_id = p_user_id
   FOR UPDATE OF s;

  IF r.sid IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::timestamptz; RETURN;
  END IF;
  IF r.ssubmitted IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_sent'::text, NULL::timestamptz; RETURN;
  END IF;
  -- A live lease means a worker may be typing it right now.
  IF r.sclaimed IS NOT NULL AND r.sclaimed > now() - interval '10 minutes' THEN
    RETURN QUERY SELECT false, 'in_flight'::text, NULL::timestamptz; RETURN;
  END IF;

  IF p_decision = 'cancel' THEN
    IF r.sstatus <> 'ready' THEN
      RETURN QUERY SELECT false, 'not_waiting'::text, NULL::timestamptz; RETURN;
    END IF;
    UPDATE public.agent_submissions
       SET status = 'blocked', release_refusal = 'cancelled-by-you', claimable_at = NULL,
           claimed_at = NULL, claimed_by = ''
     WHERE id = r.sid;
    RETURN QUERY SELECT true, 'cancelled'::text, NULL::timestamptz; RETURN;
  END IF;

  -- approve
  IF r.sstatus <> 'ready' OR r.sreleased IS NOT NULL THEN
    RETURN QUERY SELECT false, 'not_waiting'::text, NULL::timestamptz; RETURN;
  END IF;
  IF coalesce(r.srefusal, '') NOT IN ('review-mode', 'held-for-review', 'sender-offline', 'daily-cap') THEN
    RETURN QUERY SELECT false, 'not_approvable'::text, NULL::timestamptz; RETURN;
  END IF;
  IF r.mactive IS DISTINCT FROM true THEN
    RETURN QUERY SELECT false, 'agent_off'::text, NULL::timestamptz; RETURN;
  END IF;
  IF r.mpaused IS NOT NULL AND r.mpaused > now() THEN
    RETURN QUERY SELECT false, 'agent_paused'::text, NULL::timestamptz; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(r.mblocked, '{}'::text[])) AS b(name)
     WHERE lower(btrim(b.name)) = lower(btrim(coalesce(r.scompany, '')))
  ) THEN
    RETURN QUERY SELECT false, 'blocked_company'::text, NULL::timestamptz; RETURN;
  END IF;

  v_claimable := CASE WHEN coalesce(r.mundo, 0) > 0
    THEN now() + make_interval(secs => r.mundo) ELSE NULL END;
  UPDATE public.agent_submissions
     SET released_at = now(), release_refusal = '', claimable_at = v_claimable
   WHERE id = r.sid;
  -- The on-ramp moves on an approval of a HELD packet: that is what the hold
  -- was waiting for. A review-mode approval is the candidate's every-time
  -- choice and teaches the on-ramp nothing.
  IF r.srefusal = 'held-for-review' THEN
    UPDATE public.agent_mandates SET auto_released_count = auto_released_count + 1
     WHERE user_id = p_user_id;
  END IF;
  RETURN QUERY SELECT true, 'approved'::text, v_claimable;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_packet_decide(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_packet_decide(uuid, bigint, text) TO service_role;

COMMENT ON FUNCTION public.agent_packet_decide(uuid, bigint, text) IS
  'The owner''s two decisions on one packet, called by agent-access with the VERIFIED user id: approve releases a waiting packet (with the cancel window; a held one moves the on-ramp), cancel stops one no worker holds. service_role only.';

-- ── 4. the queue read leaves out what is already prepared ──────────────────

CREATE OR REPLACE FUNCTION public.agent_queue_unprepared(
  p_user_id uuid,
  p_statuses text[],
  p_pass_only boolean,
  p_limit integer
)
RETURNS SETOF public.agent_queue
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.*
    FROM public.agent_queue q
   WHERE q.user_id = p_user_id
     AND q.status = ANY (coalesce(p_statuses, '{}'::text[]))
     AND (NOT coalesce(p_pass_only, false) OR (q.pass_id IS NOT NULL AND q.pass_refunded_at IS NULL))
     AND NOT EXISTS (
       SELECT 1 FROM public.agent_submissions s
        WHERE s.user_id = q.user_id AND s.posting_id = q.posting_id
     )
   ORDER BY q.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.agent_queue_unprepared(uuid, text[], boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_queue_unprepared(uuid, text[], boolean, integer) TO service_role;

-- ── 5. the wake counts what a worker could actually take ───────────────────

CREATE OR REPLACE FUNCTION public.agent_work_pending()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subs int;
  v_passes int;
  v_ready int;
  v_oldest numeric;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'agent_work_pending: service role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_subs FROM public.agent_subscribers a
   WHERE a.status IN ('active', 'trialing')
     AND (a.current_period_end IS NULL OR a.current_period_end > now());
  SELECT count(*) INTO v_passes FROM public.agent_passes ap WHERE ap.closed_at IS NULL;

  -- The claim's own predicate, less the lock: released, past its cancel
  -- window, unleased, under three attempts, the mandate on and not paused,
  -- and funded by the row's pass or a live subscription.
  SELECT count(*),
         coalesce(max(extract(epoch FROM (now() - c.released_at)) / 60.0), 0)
    INTO v_ready, v_oldest
    FROM public.agent_submissions c
    JOIN public.agent_mandates m ON m.user_id = c.user_id
   WHERE c.status = 'ready'
     AND c.released_at IS NOT NULL
     AND c.submitted_at IS NULL
     AND (c.claimable_at IS NULL OR c.claimable_at <= now())
     AND (c.claimed_at IS NULL OR c.claimed_at < now() - interval '10 minutes')
     AND c.attempts < 3
     AND m.active = true
     AND (m.paused_until IS NULL OR m.paused_until <= now())
     AND (
       c.pass_id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.agent_subscribers a
          WHERE a.email = lower(btrim(m.email))
            AND a.status IN ('active', 'trialing')
            AND (a.current_period_end IS NULL OR a.current_period_end > now())
       )
     );

  RETURN jsonb_build_object(
    'subscribers', v_subs,
    'openPasses', v_passes,
    'pending', v_ready,
    'oldest_wait_minutes', round(v_oldest, 1),
    'should_run', (v_ready > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_work_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_work_pending() TO service_role;

COMMENT ON FUNCTION public.agent_work_pending() IS
  'Service-role only. {subscribers, openPasses, pending, oldest_wait_minutes, should_run}: pending counts exactly what agent_claim_submission would hand a worker now, so should_run starts a worker only for claimable, funded work.';

-- ── 6. an answered question sends the packets it stopped ───────────────────
--
-- L9-07. The worker refuses a form whose required question the candidate
-- never answered, records the question for them to answer once, and releases
-- the packet as blocked. The candidate answers it under "Questions the agent
-- stopped on" — and the packets that question stopped were never tried again:
-- nothing moved blocked back to ready, so the learn-once loop only ever helped
-- FUTURE postings. An answer (inserted or changed) now puts this candidate's
-- question-blocked packets back in line with their attempts reset.
--
-- NEVER a packet that may already have gone: anything marked uncertain
-- (attempts 99, or an uncertain-submit blocker) is excluded, as is anything
-- sent, unreleased, cancelled by the candidate, or already refunded to a pass
-- (a refunded application is not the pipeline's to send again).
CREATE OR REPLACE FUNCTION public.agent_retry_after_learned_answer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.agent_submissions s
     SET status = 'ready', attempts = 0, error = '', claimed_at = NULL, claimed_by = ''
   WHERE s.user_id = NEW.user_id
     AND s.status = 'blocked'
     AND s.submitted_at IS NULL
     AND s.released_at IS NOT NULL
     AND NOT (s.attempts >= 99)
     AND s.pass_refunded_at IS NULL
     AND coalesce(s.release_refusal, '') <> 'cancelled-by-you'
     AND jsonb_typeof(s.blockers) = 'array'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(s.blockers) AS b(v)
        WHERE b.v->>'kind' = 'worker' AND b.v->>'stage' = 'question-unanswerable'
     )
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(s.blockers) AS u(v)
        WHERE u.v->>'kind' = 'uncertain-submit'
     );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_retry_after_learned_answer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_retry_after_learned_answer() TO service_role;

DROP TRIGGER IF EXISTS agent_retry_after_learned_answer ON public.agent_learned_answers;
CREATE TRIGGER agent_retry_after_learned_answer
  AFTER INSERT OR UPDATE OF answer_value ON public.agent_learned_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_retry_after_learned_answer();

-- ── self-check ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  s text;
  v_fn oid;
  v_src text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'public.agent_employer_in_cooldown(uuid,text,integer)',
    'public.agent_claim_submission(text,integer)',
    'public.agent_unclaim_submission(bigint)',
    'public.agent_packet_decide(uuid,bigint,text)',
    'public.agent_queue_unprepared(uuid,text[],boolean,integer)',
    'public.agent_work_pending()',
    'public.agent_retry_after_learned_answer()'
  ] LOOP
    v_fn := to_regprocedure(s);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'self-check: % is missing', s;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
      RAISE EXCEPTION 'self-check: % is not SECURITY DEFINER', s;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn
                    AND proconfig::text LIKE '%search_path=public%') THEN
      RAISE EXCEPTION 'self-check: % has no pinned search_path', s;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', s;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: service_role cannot execute %', s;
    END IF;
  END LOOP;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('public.agent_claim_submission(text,integer)');
  IF v_src NOT LIKE '%paused_until%' OR v_src NOT LIKE '%blocked_companies%' OR v_src NOT LIKE '%m.active = true%' THEN
    RAISE EXCEPTION 'self-check: agent_claim_submission does not read the pause, the blocklist and the off switch';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('public.agent_employer_in_cooldown(uuid,text,integer)');
  IF v_src NOT LIKE '%released_at IS NOT NULL%' THEN
    RAISE EXCEPTION 'self-check: agent_employer_in_cooldown does not count released packets';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.agent_learned_answers'::regclass
       AND t.tgname = 'agent_retry_after_learned_answer' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'self-check: the trigger that retries question-blocked packets is missing';
  END IF;
  -- agent_queue_unprepared reads agent_queue.pass_refunded_at, added by
  -- 20261005130000: refuse to finish if that file did not run first.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'agent_queue' AND column_name = 'pass_refunded_at') THEN
    RAISE EXCEPTION 'self-check: agent_queue.pass_refunded_at is missing (20261005130000 must apply first)';
  END IF;
END $$;
