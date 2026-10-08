-- A REFUNDED PASS APPLICATION IS SENT ONLY IF IT IS PAID FOR AGAIN, AND ITS
-- OWNER CANNOT PUT A PARKED PACKET BACK ON THE LINE.
--
-- WHAT WAS WRONG (debug sweep 2026-10-08, S8-010). A pass holder blocks an
-- employer (or the cooldown parks the packet); the claim parks the released
-- packet as 'blocked' with an error, released_at stays set, and the refund
-- trigger gives the application back (applications_used - 1, pass_refunded_at
-- set). The owner then unblocks the employer and PATCHes status = 'ready':
-- status is in the owner's column grant (20260917180000), the guard accepts a
-- packet with no blockers, and the claim funded any row with a pass_id, so the
-- worker sent it while the pass still showed it unused.
--
-- WAVE 2 (20261008132000) decided that a given-back application may still be
-- sent and is then CHARGED AGAIN (agent_pass_recharge_on_send). That charge is
-- capped at applications_total, so on a pass with no application left the
-- send happened and nothing was charged: a free send, as many as there were
-- refunded packets. This file keeps wave 2's rule and closes both legs:
--
--   1. THE OWNER WRITES ONE STATUS. A client session (current_user
--      authenticated or anon, i.e. a PostgREST write, not a function acting
--      for it) may change a packet's status only to 'submitted' (recording a
--      send they made themselves; the account panel writes nothing else).
--      Cancel, approve and every pipeline status go through service-role
--      functions and are untouched.
--   2. A REFUND FUNDS A SEND ONLY WHILE IT CAN BE TAKEN BACK.
--      agent_packet_pass_funds(pass_id, pass_refunded_at): a row's pass funds
--      it when the application was never given back, or when the pass still
--      has room to charge it again. agent_claim_submission and both
--      agent_work_pending counts read it; nothing else in either changed
--      (their bodies are 20261005133000's, with that one predicate).
--
-- Not changed here: agent_queue_enqueue's requeue keeps a queue row's pass_id
-- when it does not charge. A second refund through it needs the first packet
-- to be gone (apply-agent skips a posting that already has one, and
-- agent_queue_unprepared refuses it), and wave 2's carry trigger stamps a
-- packet prepared from a refunded queue row. Listed in docs/wave3/agents-api.md.
--
-- Nothing here is callable by a client. Safe to re-run.

CREATE OR REPLACE FUNCTION public.agent_packet_pass_funds(p_pass_id uuid, p_refunded_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_pass_id IS NOT NULL
     AND (p_refunded_at IS NULL
          OR EXISTS (SELECT 1 FROM public.agent_passes ap
                      WHERE ap.id = p_pass_id
                        AND ap.applications_used < ap.applications_total));
$$;

REVOKE ALL ON FUNCTION public.agent_packet_pass_funds(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_packet_pass_funds(uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION public.agent_packet_pass_funds(uuid, timestamptz) IS
  'True when a packet''s pass pays for sending it: the application was never given back, or the pass can still charge it again (applications_used < applications_total), so agent_pass_recharge_on_send never caps a send to free (S8-010, 20261009121000).';

-- ── 1. the owner writes one status ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_submissions_owner_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- INVOKER on purpose: current_user is the client role only on a direct
  -- client write; inside a SECURITY DEFINER function acting for the client it
  -- is that function's owner, and those functions decide for themselves.
  IF current_user IN ('authenticated', 'anon')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'a packet''s status is the pipeline''s to set; you can only record it as sent'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_submissions_owner_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_submissions_owner_status_trg ON public.agent_submissions;
CREATE TRIGGER agent_submissions_owner_status_trg
  BEFORE UPDATE OF status ON public.agent_submissions
  FOR EACH ROW EXECUTE FUNCTION public.agent_submissions_owner_status();

-- ── 2. the claim and the wake read the same funding rule ───────────────────

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
        -- Funded: the pass stamped on the row (a pass that already gave this
        -- application back funds it only while it can charge it again:
        -- agent_packet_pass_funds, 20261009121000), or a live subscription that is
        -- this ACCOUNT's (agent_subscription_live: bound to it, or on a
        -- mailbox it proved) — the read apply-broker makes after the claim.
        -- Never agent_mandates.email: that copy is re-pinned only when the
        -- mandate is written, so after an address change the two gates
        -- disagreed and the broker handed the same packet back on every pass
        -- of its loop.
        AND (public.agent_packet_pass_funds(c.pass_id, c.pass_refunded_at) OR public.agent_subscription_live(c.user_id))
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
     AND (public.agent_packet_pass_funds(c.pass_id, c.pass_refunded_at) OR public.agent_subscription_live(c.user_id));

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
     AND (public.agent_packet_pass_funds(c.pass_id, c.pass_refunded_at) OR public.agent_subscription_live(c.user_id));

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

-- ── self-check ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn oid := to_regprocedure('public.agent_packet_pass_funds(uuid,timestamptz)');
  v_trg oid := to_regprocedure('public.agent_submissions_owner_status()');
  v_def text;
BEGIN
  IF v_fn IS NULL OR v_trg IS NULL THEN
    RAISE EXCEPTION '20261009121000: agent_packet_pass_funds or agent_submissions_owner_status is missing';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_trg) THEN
    RAISE EXCEPTION '20261009121000: agent_submissions_owner_status must be SECURITY INVOKER (it reads current_user)';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261009121000: agent_packet_pass_funds is executable by a client role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.agent_submissions'::regclass
       AND t.tgname = 'agent_submissions_owner_status_trg' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '20261009121000: trigger agent_submissions_owner_status_trg is missing';
  END IF;

  FOREACH v_def IN ARRAY ARRAY[
    pg_get_functiondef('public.agent_claim_submission(text,integer)'::regprocedure),
    pg_get_functiondef('public.agent_work_pending()'::regprocedure)
  ] LOOP
    IF position('agent_packet_pass_funds(c.pass_id, c.pass_refunded_at)' IN v_def) = 0
       OR position('c.pass_id IS NOT NULL OR' IN v_def) > 0 THEN
      RAISE EXCEPTION '20261009121000: a sender still funds a packet on pass_id alone';
    END IF;
  END LOOP;

  IF public.agent_packet_pass_funds(NULL, NULL)
     OR NOT public.agent_packet_pass_funds('00000000-0000-4000-8000-0000000000aa', NULL)
     OR public.agent_packet_pass_funds('00000000-0000-4000-8000-0000000000aa', now()) THEN
    RAISE EXCEPTION '20261009121000: agent_packet_pass_funds answers wrongly (no pass / unrefunded / refunded on a pass that does not exist)';
  END IF;
END
$$;
