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
--     is no longer released two minutes after the first — but only packets
--     that can still go: under the attempt ceiling and released inside the
--     window. An exhausted packet released 200 days ago is not "on its way",
--     and counting it closed that employer to the candidate for good.
--
--  4. agent_queue_unprepared (L9-03). apply-agent read the ten newest queue
--     rows, and a row keeps its status after its packet is written, so the
--     window filled with prepared rows and everything past the tenth starved.
--     This read leaves out rows that already have a packet.
--
--  5. agent_work_pending (L9-19, L9-22). The sender wake counted any 'ready'
--     packet and any agent_subscribers row: once configured it would boot a
--     worker every hour for packets nobody can claim, and never for an account
--     whose only funding is a pass. It now counts what the claim would hand
--     out now, what it will hand out inside the next twenty minutes (a cancel
--     window ending), and funded packets refused only because no sender has
--     run lately — the one wait a started worker ends. The worker is an
--     ephemeral job, so a wake that counted only claimable work never started
--     one for a packet waiting on a sender, and the packet waited forever.
--
--  6. agent_retry_after_learned_answer (L9-07). A question the candidate
--     answers puts back in line the packets whose last unanswered question it
--     was — never one that may already have gone. The packet goes back with
--     its blockers cleared: agent_submissions_guard refuses 'ready' with
--     blockers, and the first version of this trigger set the status alone,
--     so the guard aborted the candidate's own save of the answer.
--
-- FUNDING IS READ BY THE ACCOUNT, IN EVERY GATE (review of this file). The
-- claim and the wake ask agent_subscription_live(user_id) (20261005130000) —
-- the same account-keyed read apply-broker makes after the claim, through
-- agent_subscription_rows. They used to read agent_mandates.email, which is
-- re-pinned only when the mandate is written: an account that changed its
-- address was funded to the claim and unfunded to the broker, which handed the
-- packet back, and the claim handed the same packet out again, five times a
-- poll, while every other account's work waited behind it.
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
          -- Released, unsent, and still able to go: under the claim's attempt
          -- ceiling and released inside the window. The claim parks a second
          -- packet for an employer at send time anyway; this arm only keeps
          -- the release from queueing two at once.
          OR (s.submitted_at IS NULL AND s.released_at IS NOT NULL AND s.status = 'ready'
              AND s.attempts < 3
              AND s.released_at > now() - make_interval(days => p_days))
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
        -- Funded: the pass stamped on the row, or a live subscription that is
        -- this ACCOUNT's (agent_subscription_live: bound to it, or on a
        -- mailbox it proved) — the read apply-broker makes after the claim.
        -- Never agent_mandates.email: that copy is re-pinned only when the
        -- mandate is written, so after an address change the two gates
        -- disagreed and the broker handed the same packet back on every pass
        -- of its loop.
        AND (c.pass_id IS NOT NULL OR public.agent_subscription_live(c.user_id))
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

-- One overload: the single-argument draft of this function is dropped by name
-- (a later deploy must never find two, or PostgREST cannot choose).
DROP FUNCTION IF EXISTS public.agent_unclaim_submission(bigint);

CREATE OR REPLACE FUNCTION public.agent_unclaim_submission(p_submission_id bigint, p_hold_minutes integer DEFAULT 0)
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
  --
  -- AND IT CAN STEP ASIDE. Giving the attempt back makes the packet the oldest
  -- claimable one again, so the very next claim — the broker's next pass of
  -- its loop — took the same packet, and one packet the broker would not send
  -- held every other account's work behind it. p_hold_minutes (capped at two
  -- hours) moves its claimable_at forward, so the next claim reaches the next
  -- packet; 0 hands it straight back, for a hand-back whose cause is the
  -- broker's own transient failure.
  UPDATE public.agent_submissions
     SET claimed_at = NULL, claimed_by = '', attempts = greatest(attempts - 1, 0),
         claimable_at = CASE
           WHEN coalesce(p_hold_minutes, 0) > 0
             THEN greatest(coalesce(claimable_at, now()), now() + make_interval(mins => least(p_hold_minutes, 120)))
           ELSE claimable_at
         END
   WHERE id = p_submission_id AND submitted_at IS NULL AND claimed_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_unclaim_submission(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_unclaim_submission(bigint, integer) TO service_role;

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
    -- error is CLEARED, explicitly. The pass refund trigger gives an
    -- application back on 'blocked' with a non-empty error, and a packet a
    -- worker once refused for a transient reason still carried "will retry:
    -- ..." — so whether the owner's own cancel refunded a pass depended on a
    -- leftover string. A cancel is the owner's decision, and a refund is the
    -- pipeline's to give, never the owner's to take (20260917170000); the
    -- refund policy for never-sent pass applications is the owner decision
    -- L9-13, and this only makes the outcome the same every time.
    UPDATE public.agent_submissions
       SET status = 'blocked', release_refusal = 'cancelled-by-you', claimable_at = NULL,
           claimed_at = NULL, claimed_by = '', error = ''
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
  v_soon int;
  v_next numeric;
  v_waiting int;
  -- How far ahead a started worker waits for a cancel window to end. The
  -- default window is fifteen minutes; the worker's own wait horizon
  -- (worker/src/idle.ts) is at least this.
  c_soon interval := interval '20 minutes';
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'agent_work_pending: service role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_subs FROM public.agent_subscribers a
   WHERE a.status IN ('active', 'trialing')
     AND (a.current_period_end IS NULL OR a.current_period_end > now());
  SELECT count(*) INTO v_passes FROM public.agent_passes ap WHERE ap.closed_at IS NULL;

  -- The claim's own predicate, less the lock and the cancel window: released,
  -- unleased, under three attempts, the mandate on and not paused, and funded
  -- by the row's pass or a live subscription that is the ACCOUNT's. Split
  -- by when it becomes claimable: now (pending), or inside c_soon (soon).
  SELECT count(*) FILTER (WHERE c.claimable_at IS NULL OR c.claimable_at <= now()),
         coalesce(max(extract(epoch FROM (now() - c.released_at)) / 60.0)
                    FILTER (WHERE c.claimable_at IS NULL OR c.claimable_at <= now()), 0),
         count(*) FILTER (WHERE c.claimable_at > now() AND c.claimable_at <= now() + c_soon),
         min(extract(epoch FROM (c.claimable_at - now())))
           FILTER (WHERE c.claimable_at > now() AND c.claimable_at <= now() + c_soon)
    INTO v_ready, v_oldest, v_soon, v_next
    FROM public.agent_submissions c
    JOIN public.agent_mandates m ON m.user_id = c.user_id
   WHERE c.status = 'ready'
     AND c.released_at IS NOT NULL
     AND c.submitted_at IS NULL
     AND (c.claimed_at IS NULL OR c.claimed_at < now() - interval '10 minutes')
     AND c.attempts < 3
     AND m.active = true
     AND (m.paused_until IS NULL OR m.paused_until <= now())
     AND (c.pass_id IS NOT NULL OR public.agent_subscription_live(c.user_id));

  -- WAITING ON A SENDER: prepared, funded, refused release only because no
  -- sender had run lately. A started worker heartbeats, and the next
  -- apply-agent run releases these; without counting them the wake never
  -- started the worker they wait for (L9-22). Re-decided packets carry
  -- today's reason, so a packet refused for anything else is not here.
  SELECT count(*) INTO v_waiting
    FROM public.agent_submissions c
    JOIN public.agent_mandates m ON m.user_id = c.user_id
   WHERE c.status = 'ready'
     AND c.released_at IS NULL
     AND c.submitted_at IS NULL
     AND c.release_refusal = 'sender-offline'
     AND m.active = true
     AND (m.paused_until IS NULL OR m.paused_until <= now())
     AND (c.pass_id IS NOT NULL OR public.agent_subscription_live(c.user_id));

  RETURN jsonb_build_object(
    'subscribers', v_subs,
    'openPasses', v_passes,
    'pending', v_ready,
    'oldest_wait_minutes', round(v_oldest, 1),
    'soon', v_soon,
    'next_claimable_seconds', CASE WHEN v_next IS NULL THEN NULL ELSE ceil(v_next)::int END,
    'waiting_on_sender', v_waiting,
    'should_run', (v_ready > 0 OR v_soon > 0 OR v_waiting > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_work_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_work_pending() TO service_role;

COMMENT ON FUNCTION public.agent_work_pending() IS
  'Service-role only. {subscribers, openPasses, pending, oldest_wait_minutes, soon, next_claimable_seconds, waiting_on_sender, should_run}: pending is what agent_claim_submission would hand a worker now; soon is what it will hand out inside 20 minutes (a cancel window ending), next_claimable_seconds when the first of those opens; waiting_on_sender is funded packets refused release only because no sender ran lately. should_run starts a worker for any of the three, and for nothing else.';

-- ── 6. an answered question sends the packets it stopped ───────────────────
--
-- L9-07. The worker refuses a form whose required question the candidate
-- never answered, records the question for them to answer once, and releases
-- the packet as blocked. The candidate answers it under "Questions the agent
-- stopped on" — and the packets that question stopped were never tried again:
-- nothing moved blocked back to ready, so the learn-once loop only ever helped
-- FUTURE postings. An answer (inserted or changed) now puts back in line the
-- packets it can actually unblock, attempts reset and blockers cleared.
--
-- WHICH PACKETS. Every blocker on the packet must be a question refusal (a
-- packet also refused for a CAPTCHA or a missing résumé would refuse again).
-- The worker stamps each question refusal with `question_keys` — the learned
-- key of every learnable question it could not answer — and `unlearnable`, the
-- count of questions no answer may lift (a date of birth, an ID number). A
-- packet goes back when this answer is one of its keys, every one of its keys
-- now has an answer, and nothing unlearnable blocked it. A refusal written
-- before the worker stamped keys cannot say which question it was, so it goes
-- back on any answer: the next attempt refuses identically at worst, and
-- costs no more than one browser visit.
--
-- WITH ITS BLOCKERS CLEARED. agent_submissions_guard refuses status 'ready'
-- with any blocker. The first version set the status alone, so the guard
-- raised inside this trigger and aborted the candidate's upsert of the answer
-- itself: nothing was saved and nothing was retried.
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
     SET status = 'ready', attempts = 0, error = '', blockers = '[]'::jsonb,
         claimed_at = NULL, claimed_by = ''
   WHERE s.user_id = NEW.user_id
     AND s.status = 'blocked'
     AND s.submitted_at IS NULL
     AND s.released_at IS NOT NULL
     AND NOT (s.attempts >= 99)
     AND s.pass_refunded_at IS NULL
     AND coalesce(s.release_refusal, '') <> 'cancelled-by-you'
     AND jsonb_typeof(s.blockers) = 'array'
     AND jsonb_array_length(s.blockers) > 0
     -- every blocker is a question refusal...
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(s.blockers) AS o(v)
        WHERE NOT (o.v->>'kind' = 'worker' AND o.v->>'stage' = 'question-unanswerable')
     )
     -- ...none of them names a question no answer may lift...
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(s.blockers) AS n(v)
        WHERE coalesce(n.v->>'unlearnable', '0') !~ '^0*$'
     )
     -- ...and this answer is the last one each of them was waiting for (or
     -- the refusal predates question_keys and cannot say).
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(s.blockers) AS b(v)
        WHERE jsonb_typeof(b.v->'question_keys') = 'array'
          AND (
            NOT (b.v->'question_keys' ? NEW.question_key)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(b.v->'question_keys') AS k(key)
               WHERE NOT EXISTS (
                 SELECT 1 FROM public.agent_learned_answers la
                  WHERE la.user_id = NEW.user_id AND la.question_key = k.key
               )
            )
          )
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
  v_n integer;
BEGIN
  -- This file reads what 20261005130000 creates: refuse to finish without it.
  IF to_regprocedure('public.agent_subscription_live(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'agent_queue' AND column_name = 'pass_refunded_at') THEN
    RAISE EXCEPTION 'self-check: 20261005130000 has not applied (agent_subscription_live or agent_queue.pass_refunded_at is missing)';
  END IF;

  FOREACH s IN ARRAY ARRAY[
    'public.agent_employer_in_cooldown(uuid,text,integer)',
    'public.agent_claim_submission(text,integer)',
    'public.agent_unclaim_submission(bigint,integer)',
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

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'agent_unclaim_submission';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'self-check: agent_unclaim_submission has % overloads, want exactly one', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.agent_learned_answers'::regclass
       AND t.tgname = 'agent_retry_after_learned_answer' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'self-check: the trigger that retries question-blocked packets is missing';
  END IF;
END $$;

-- ── self-check, exercised ───────────────────────────────────────────────────
--
-- The claim, the hand-back, the cooldown, the owner's decisions, the queue
-- read, the wake and the learned-answer retry, RUN against the real tables
-- and their real triggers (agent_submissions_guard and the pass refund
-- trigger among them) with one existing account, inside a block that always
-- ends by raising RB000: every row written here is rolled back, and a failed
-- assertion raises something else and stops this file. The test packets are
-- released in 1999-2000 so the claim, which hands out the oldest first,
-- reaches them before any real one.
DO $$
DECLARE
  v_uid uuid;
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_stranger uuid := gen_random_uuid();
  p1 bigint; p2 bigint; p3 bigint; p4 bigint; p5 bigint; p6 bigint;
  p7 bigint; p8 bigint; p9 bigint; p10 bigint; p11 bigint; p12 bigint;
  q1 bigint;
  r record;
  w0 jsonb;
  w1 jsonb;
  k1 text;
  k2 text;
  v_co text;
BEGIN
  SELECT u.id INTO v_uid
    FROM auth.users u
   WHERE coalesce(btrim(u.email), '') <> ''
   ORDER BY u.created_at NULLS LAST, u.id
   LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'self-check: no account exists to exercise these paths against; the catalogue checks above are all that ran';
    RETURN;
  END IF;
  k1 := 'self check question one ' || v_tag;
  k2 := 'self check question two ' || v_tag;
  v_co := 'Self-check Co ' || v_tag;

  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);

    -- An agent that is on, not paused, with no window, funded by a live
    -- subscription BOUND to the account. last_prepare_kick_at keeps the
    -- on-save kick from firing.
    INSERT INTO public.agent_mandates (user_id, active, paused_until, blocked_companies, employer_cooldown_days,
                                       undo_window_seconds, auto_apply_daily_cap, last_prepare_kick_at)
    VALUES (v_uid, true, NULL, '{}', 14, 0, 20, now())
    ON CONFLICT (user_id) DO UPDATE SET active = true, paused_until = NULL, blocked_companies = '{}',
      employer_cooldown_days = 14, undo_window_seconds = 0, auto_apply_daily_cap = 20, last_prepare_kick_at = now();
    INSERT INTO public.agent_subscribers (email, status, current_period_end, user_id)
    VALUES ('claim-' || v_tag || '@self-check.invalid', 'active', now() + interval '20 days', v_uid);

    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at)
    VALUES (v_uid, 'self-check:' || v_tag || ':p1', v_co || ' one', 'ready', '2000-01-01') RETURNING id INTO p1;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at)
    VALUES (v_uid, 'self-check:' || v_tag || ':p2', v_co || ' two', 'ready', '2000-01-02') RETURNING id INTO p2;

    -- 1. The claim hands out the funded packet of an agent that is on.
    SELECT * INTO r FROM public.agent_claim_submission('self-check', 10);
    IF r.id IS DISTINCT FROM p1 OR r.attempts IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'self-check: the claim did not hand out the oldest funded packet with its first attempt';
    END IF;

    -- 2. Handed back with a hold: the attempt returns and the packet steps
    --    aside, so the next claim reaches the next packet, not the same one.
    IF NOT public.agent_unclaim_submission(p1, 10) THEN
      RAISE EXCEPTION 'self-check: a claimed packet could not be handed back';
    END IF;
    SELECT * INTO r FROM public.agent_submissions WHERE id = p1;
    IF r.attempts <> 0 OR r.claimed_at IS NOT NULL OR r.claimable_at IS NULL OR r.claimable_at < now() + interval '9 minutes' THEN
      RAISE EXCEPTION 'self-check: a hand-back spent an attempt, kept the lease, or did not step the packet aside';
    END IF;
    SELECT * INTO r FROM public.agent_claim_submission('self-check', 10);
    IF r.id IS DISTINCT FROM p2 THEN
      RAISE EXCEPTION 'self-check: after a hand-back the next claim did not reach the next packet';
    END IF;
    PERFORM public.agent_unclaim_submission(p2, 0);
    IF (SELECT attempts FROM public.agent_submissions WHERE id = p2) <> 0
       OR (SELECT claimable_at FROM public.agent_submissions WHERE id = p2) IS NOT NULL THEN
      RAISE EXCEPTION 'self-check: a hand-back with no hold moved the packet or spent an attempt';
    END IF;

    -- 3. Switched off, paused, or unfunded: the claim does not hand it out,
    --    and spends nothing on it.
    UPDATE public.agent_mandates SET active = false WHERE user_id = v_uid;
    SELECT * INTO r FROM public.agent_claim_submission('self-check', 10);
    IF r.id = p2 THEN RAISE EXCEPTION 'self-check: the claim handed out a packet of an agent switched off'; END IF;
    UPDATE public.agent_mandates SET active = true, paused_until = now() + interval '7 days' WHERE user_id = v_uid;
    SELECT * INTO r FROM public.agent_claim_submission('self-check', 10);
    IF r.id = p2 THEN RAISE EXCEPTION 'self-check: the claim handed out a packet of a paused agent'; END IF;
    UPDATE public.agent_mandates SET paused_until = NULL WHERE user_id = v_uid;
    UPDATE public.agent_subscribers SET status = 'past_due' WHERE user_id = v_uid OR email = (SELECT lower(btrim(email)) FROM auth.users WHERE id = v_uid);
    SELECT * INTO r FROM public.agent_claim_submission('self-check', 10);
    IF r.id = p2 THEN RAISE EXCEPTION 'self-check: the claim handed out an unfunded packet'; END IF;
    IF (SELECT attempts FROM public.agent_submissions WHERE id = p2) <> 0 THEN
      RAISE EXCEPTION 'self-check: refusing a packet at the claim spent its attempts';
    END IF;
    UPDATE public.agent_subscribers SET status = 'active' WHERE email = 'claim-' || v_tag || '@self-check.invalid';

    -- 4. A released packet for an employer since blocked is parked, with the
    --    reason, before anything is handed out.
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at)
    VALUES (v_uid, 'self-check:' || v_tag || ':p3', v_co || ' blocked', 'ready', '1999-12-31') RETURNING id INTO p3;
    UPDATE public.agent_mandates SET blocked_companies = ARRAY['  ' || upper(v_co) || ' BLOCKED '] WHERE user_id = v_uid;
    PERFORM public.agent_claim_submission('self-check', 10);
    SELECT * INTO r FROM public.agent_submissions WHERE id = p3;
    IF r.status <> 'blocked' OR r.error NOT LIKE 'blocked-company:%' THEN
      RAISE EXCEPTION 'self-check: a released packet for a blocked employer was not parked';
    END IF;
    UPDATE public.agent_mandates SET blocked_companies = '{}' WHERE user_id = v_uid;

    -- 5. The cooldown counts a released packet still able to go — never an
    --    exhausted one, one released before the window, or an unreleased one.
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at)
    VALUES (v_uid, 'self-check:' || v_tag || ':p4', v_co || ' cooldown', 'ready', now()) RETURNING id INTO p4;
    IF NOT public.agent_employer_in_cooldown(v_uid, lower(v_co) || ' cooldown', 14) THEN
      RAISE EXCEPTION 'self-check: a released, unsent packet did not put its employer in cooldown';
    END IF;
    UPDATE public.agent_submissions SET attempts = 3 WHERE id = p4;
    IF public.agent_employer_in_cooldown(v_uid, v_co || ' cooldown', 14) THEN
      RAISE EXCEPTION 'self-check: an exhausted packet kept its employer in cooldown';
    END IF;
    UPDATE public.agent_submissions SET attempts = 0, released_at = now() - interval '200 days' WHERE id = p4;
    IF public.agent_employer_in_cooldown(v_uid, v_co || ' cooldown', 14) THEN
      RAISE EXCEPTION 'self-check: a packet released 200 days ago kept its employer in a 14-day cooldown';
    END IF;
    UPDATE public.agent_submissions SET released_at = NULL WHERE id = p4;
    IF public.agent_employer_in_cooldown(v_uid, v_co || ' cooldown', 14) THEN
      RAISE EXCEPTION 'self-check: an unreleased packet put its employer in cooldown';
    END IF;

    -- 6. The owner's decisions. Approve releases a held packet with the
    --    cancel window and moves the on-ramp; cancel stops one and leaves no
    --    leftover reason behind; nobody decides another account's packet.
    UPDATE public.agent_mandates SET undo_window_seconds = 900, auto_released_count = 0 WHERE user_id = v_uid;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, release_refusal)
    VALUES (v_uid, 'self-check:' || v_tag || ':p5', v_co || ' held', 'ready', 'held-for-review') RETURNING id INTO p5;
    SELECT * INTO r FROM public.agent_packet_decide(v_stranger, p5, 'approve');
    IF r.decide_reason IS DISTINCT FROM 'not_found' THEN
      RAISE EXCEPTION 'self-check: another account could decide this packet (%)', r.decide_reason;
    END IF;
    SELECT * INTO r FROM public.agent_packet_decide(v_uid, p5, 'approve');
    IF r.decided_ok IS DISTINCT FROM true OR r.decided_claimable_at IS NULL
       OR (SELECT released_at FROM public.agent_submissions WHERE id = p5) IS NULL
       OR (SELECT auto_released_count FROM public.agent_mandates WHERE user_id = v_uid) <> 1 THEN
      RAISE EXCEPTION 'self-check: approving a held packet did not release it with its window and move the on-ramp';
    END IF;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, error)
    VALUES (v_uid, 'self-check:' || v_tag || ':p6', v_co || ' cancel', 'ready', now(), 'will retry: driver error: timeout')
    RETURNING id INTO p6;
    SELECT * INTO r FROM public.agent_packet_decide(v_uid, p6, 'cancel');
    IF r.decided_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'self-check: the owner could not cancel a packet no worker holds (%)', r.decide_reason;
    END IF;
    SELECT * INTO r FROM public.agent_submissions WHERE id = p6;
    IF r.status <> 'blocked' OR r.release_refusal <> 'cancelled-by-you' OR coalesce(r.error, '') <> '' THEN
      RAISE EXCEPTION 'self-check: a cancel did not stop the packet, or left the old retry reason on it';
    END IF;

    -- 7. The preparer's read leaves out a row that already has a packet.
    INSERT INTO public.agent_queue (user_id, posting_id, status) VALUES (v_uid, 'self-check:' || v_tag || ':q1', 'approved') RETURNING id INTO q1;
    INSERT INTO public.agent_queue (user_id, posting_id, status) VALUES (v_uid, 'self-check:' || v_tag || ':p1', 'approved');
    IF EXISTS (SELECT 1 FROM public.agent_queue_unprepared(v_uid, ARRAY['approved'], false, 50) x
                WHERE x.posting_id = 'self-check:' || v_tag || ':p1')
       OR NOT EXISTS (SELECT 1 FROM public.agent_queue_unprepared(v_uid, ARRAY['approved'], false, 50) x WHERE x.id = q1) THEN
      RAISE EXCEPTION 'self-check: the preparer''s read returned a prepared row, or dropped an unprepared one';
    END IF;

    -- 8. The wake counts a funded packet waiting only on a sender, and one
    --    whose cancel window ends inside twenty minutes.
    w0 := public.agent_work_pending();
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, release_refusal)
    VALUES (v_uid, 'self-check:' || v_tag || ':p7', v_co || ' waiting', 'ready', 'sender-offline') RETURNING id INTO p7;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, claimable_at)
    VALUES (v_uid, 'self-check:' || v_tag || ':p8', v_co || ' soon', 'ready', now(), now() + interval '5 minutes') RETURNING id INTO p8;
    w1 := public.agent_work_pending();
    IF (w1->>'waiting_on_sender')::int <> (w0->>'waiting_on_sender')::int + 1
       OR (w1->>'soon')::int <> (w0->>'soon')::int + 1
       OR (w1->>'should_run')::boolean IS DISTINCT FROM true
       OR (w1->>'next_claimable_seconds')::int > 300 THEN
      RAISE EXCEPTION 'self-check: the wake did not count a packet waiting on a sender and one about to become claimable (% -> %)', w0, w1;
    END IF;

    -- 9. An answered question sends back the packets it was the last answer
    --    for — with blockers cleared, which agent_submissions_guard demands —
    --    and never a packet that still waits on another answer or on a
    --    question no answer may lift.
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, attempts, error, blockers)
    VALUES (v_uid, 'self-check:' || v_tag || ':p9', v_co || ' q1', 'blocked', now(), 3, 'refused',
            jsonb_build_array(jsonb_build_object('kind', 'worker', 'stage', 'question-unanswerable', 'question_keys', jsonb_build_array(k1), 'unlearnable', 0)))
    RETURNING id INTO p9;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, attempts, error, blockers)
    VALUES (v_uid, 'self-check:' || v_tag || ':p10', v_co || ' q2', 'blocked', now(), 3, 'refused',
            jsonb_build_array(jsonb_build_object('kind', 'worker', 'stage', 'question-unanswerable', 'question_keys', jsonb_build_array(k1, k2), 'unlearnable', 0)))
    RETURNING id INTO p10;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, attempts, error, blockers)
    VALUES (v_uid, 'self-check:' || v_tag || ':p11', v_co || ' q3', 'blocked', now(), 3, 'refused',
            jsonb_build_array(jsonb_build_object('kind', 'worker', 'stage', 'question-unanswerable', 'question_keys', jsonb_build_array(k1), 'unlearnable', 1)))
    RETURNING id INTO p11;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, attempts, error, blockers)
    VALUES (v_uid, 'self-check:' || v_tag || ':p12', v_co || ' q4', 'blocked', now(), 99, 'refused',
            jsonb_build_array(jsonb_build_object('kind', 'worker', 'stage', 'question-unanswerable', 'question_keys', jsonb_build_array(k1)),
                              jsonb_build_object('kind', 'uncertain-submit', 'detail', 'no confirmation')))
    RETURNING id INTO p12;
    INSERT INTO public.agent_learned_answers (user_id, question_key, question_label, answer_kind, answer_value)
    VALUES (v_uid, k1, 'Self-check question one', 'fill', 'yes');
    SELECT * INTO r FROM public.agent_submissions WHERE id = p9;
    IF r.status <> 'ready' OR r.attempts <> 0 OR jsonb_array_length(r.blockers) <> 0 OR coalesce(r.error, '') <> '' THEN
      RAISE EXCEPTION 'self-check: the answer to a packet''s only question did not put it back in line';
    END IF;
    IF (SELECT status FROM public.agent_submissions WHERE id = p10) <> 'blocked'
       OR (SELECT status FROM public.agent_submissions WHERE id = p11) <> 'blocked'
       OR (SELECT status FROM public.agent_submissions WHERE id = p12) <> 'blocked' THEN
      RAISE EXCEPTION 'self-check: an answer retried a packet still waiting on another answer, an unlearnable question, or one that may have gone';
    END IF;
    INSERT INTO public.agent_learned_answers (user_id, question_key, question_label, answer_kind, answer_value)
    VALUES (v_uid, k2, 'Self-check question two', 'fill', 'no');
    IF (SELECT status FROM public.agent_submissions WHERE id = p10) <> 'ready' THEN
      RAISE EXCEPTION 'self-check: answering a packet''s last open question did not put it back in line';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
