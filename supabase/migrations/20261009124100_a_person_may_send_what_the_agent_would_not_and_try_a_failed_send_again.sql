-- A PERSON MAY SEND WHAT THE AGENT WOULD NOT, TRY A FAILED SEND AGAIN, AND SAY
-- AN UNCONFIRMED ONE NEVER ARRIVED.
--
-- agent_packet_decide is the owner's say on one packet, called by agent-access
-- with the VERIFIED user id. It took two decisions; it now takes four.
--
--  1. APPROVE (sweep S11-042). In auto mode decideRelease refuses a packet as
--     fit-below-floor or fit-unknown, and approve accepted only review-mode,
--     held-for-review, sender-offline and daily-cap, so an application a
--     person approved through their AI sat unsent forever (on a pass, spent
--     until the close). OWNER DECISION 2026-10-11: a packet a PERSON approves
--     may go even below the fit floor; the floor guards only unattended sends.
--     The approvable list mirrors APPROVABLE_REFUSALS in
--     supabase/functions/_shared/apply-release.ts, and a test holds them equal.
--
--  2. RETRY (sweep S11-043). The worker releases its third transient refusal
--     as 'blocked' (a driver error, a timeout, a form that did not load). The
--     account page's Try again reset only attempts and the lease, the claim
--     hands out only 'ready' packets, and the owner cannot clear blockers, so
--     "Queued again" queued nothing. Retry puts back on the line a released
--     packet that stopped for a reason about the moment: ready and spent at
--     three attempts, or blocked by the worker only with refusals the worker
--     itself calls transient (isTransientRefusal in worker/src/refusal.ts,
--     mirrored here; a test holds the two equal). Never one pressed and not
--     confirmed, never one sent. The pass: a refusal the pipeline gave back is
--     charged again when it is sent (agent_pass_recharge_on_send), so a retry
--     is refused when the pass cannot pay for it.
--
--  3. NOT_SENT (sweep S11-044). An unconfirmed send counts as a send and keeps
--     its application (20261009124000) until a person says it did not arrive.
--     This is that say: the stamp is cleared, and the refund trigger gives a
--     pass application back. It is never retried.
--
--  4. CANCEL is unchanged.
--
-- Same signature and return type, CREATE OR REPLACE. service_role only.
-- Safe to re-run.

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
  IF p_user_id IS NULL OR p_submission_id IS NULL OR p_decision NOT IN ('approve', 'cancel', 'retry', 'not_sent') THEN
    RETURN QUERY SELECT false, 'bad_request'::text, NULL::timestamptz; RETURN;
  END IF;

  SELECT s.id AS sid, s.status AS sstatus, s.released_at AS sreleased, s.submitted_at AS ssubmitted,
         s.claimed_at AS sclaimed, s.claimable_at AS sclaimable, s.release_refusal AS srefusal,
         s.company AS scompany, s.attempts AS sattempts, s.blockers AS sblockers,
         s.uncertain_at AS suncertain, s.pass_id AS spass, s.pass_refunded_at AS srefunded,
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

  IF p_decision = 'not_sent' THEN
    IF r.suncertain IS NULL THEN
      RETURN QUERY SELECT false, 'not_unconfirmed'::text, NULL::timestamptz; RETURN;
    END IF;
    -- status is in the SET list so the refund trigger (AFTER UPDATE OF status)
    -- runs: blocked, attempts 99, an error, and no stamp any more. The
    -- unconfirmed marker gives way to the person's answer, which is what the
    -- account page shows from now on (packetState 'not-arrived').
    UPDATE public.agent_submissions
       SET status = 'blocked', uncertain_at = NULL, claimable_at = NULL,
           error = 'not-sent: you checked, and this application did not arrive',
           blockers = jsonb_build_array(jsonb_build_object(
             'kind', 'not-sent', 'detail', 'You checked, and this application did not arrive.'))
     WHERE id = r.sid;
    RETURN QUERY SELECT true, 'recorded_not_sent'::text, NULL::timestamptz; RETURN;
  END IF;

  IF p_decision = 'cancel' THEN
    IF r.sstatus <> 'ready' THEN
      RETURN QUERY SELECT false, 'not_waiting'::text, NULL::timestamptz; RETURN;
    END IF;
    -- error is CLEARED, explicitly: whether the owner's own cancel refunded a
    -- pass must not depend on a leftover "will retry: ..." (20261005133000).
    UPDATE public.agent_submissions
       SET status = 'blocked', release_refusal = 'cancelled-by-you', claimable_at = NULL,
           claimed_at = NULL, claimed_by = '', error = ''
     WHERE id = r.sid;
    RETURN QUERY SELECT true, 'cancelled'::text, NULL::timestamptz; RETURN;
  END IF;

  IF p_decision = 'retry' THEN
    IF r.suncertain IS NOT NULL OR coalesce(r.sattempts, 0) >= 99 THEN
      -- Pressed and not confirmed: a retry could apply them twice.
      RETURN QUERY SELECT false, 'not_retryable'::text, NULL::timestamptz; RETURN;
    END IF;
    IF r.sreleased IS NULL OR NOT (
         (r.sstatus = 'ready' AND coalesce(r.sattempts, 0) >= 3)
      OR (r.sstatus = 'blocked'
          AND jsonb_typeof(r.sblockers) = 'array'
          AND jsonb_array_length(r.sblockers) > 0
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(r.sblockers) AS b(v)
             WHERE NOT (
                   b.v->>'kind' = 'worker'
               AND coalesce(b.v->>'detail', '') ~* '^driver error:|net::ERR_|timeout|timed out|could not find the application form|could not read this form''s questions|the résumé did not attach'
               AND coalesce(b.v->>'detail', '') !~* 'captcha|posting is closed|no adapter|cannot answer|no standing answers|wants a résumé and none')))
    ) THEN
      RETURN QUERY SELECT false, 'not_retryable'::text, NULL::timestamptz; RETURN;
    END IF;
  ELSE
    -- approve
    IF r.sstatus <> 'ready' OR r.sreleased IS NOT NULL THEN
      RETURN QUERY SELECT false, 'not_waiting'::text, NULL::timestamptz; RETURN;
    END IF;
    IF coalesce(r.srefusal, '') NOT IN ('review-mode', 'held-for-review', 'sender-offline', 'daily-cap', 'fit-below-floor', 'fit-unknown') THEN
      RETURN QUERY SELECT false, 'not_approvable'::text, NULL::timestamptz; RETURN;
    END IF;
  END IF;

  -- approve and retry both put a packet on the line.
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

  IF p_decision = 'retry' THEN
    -- The claim's own funding rule: a retry the claim would never hand out is
    -- not "queued again".
    IF NOT (public.agent_packet_pass_funds(r.spass, r.srefunded) OR public.agent_subscription_live(p_user_id)) THEN
      RETURN QUERY SELECT false, 'not_funded'::text, NULL::timestamptz; RETURN;
    END IF;
    UPDATE public.agent_submissions
       SET status = 'ready', blockers = '[]'::jsonb, attempts = 0, error = '',
           claimed_at = NULL, claimed_by = '', claimable_at = NULL, release_refusal = ''
     WHERE id = r.sid;
    RETURN QUERY SELECT true, 'queued_again'::text, NULL::timestamptz; RETURN;
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
  'The owner''s say on one packet, called by agent-access with the VERIFIED user id: approve releases a waiting packet (with the cancel window; a held one moves the on-ramp; a person may approve below the fit floor), cancel stops one no worker holds, retry puts back a released packet that stopped for a transient reason, not_sent records that an unconfirmed send did not arrive (20261009124100). service_role only.';

-- ── self-check: the catalogue ──────────────────────────────────────────────
DO $$
DECLARE
  v_fn regprocedure := 'public.agent_packet_decide(uuid,bigint,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.agent_packet_decide(uuid,bigint,text)'::regprocedure);
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261009124100: agent_packet_decide is executable by a client role';
  END IF;
  IF position('''fit-below-floor'', ''fit-unknown''' IN v_def) = 0 OR position('''not_sent''' IN v_def) = 0 THEN
    RAISE EXCEPTION '20261009124100: agent_packet_decide is not the four-decision body';
  END IF;
END $$;

-- ── self-check, exercised ───────────────────────────────────────────────────
-- On the first account, inside a block that always raises RB000, so nothing
-- survives. The mandate is the account's own and is not touched, so the
-- approval of a packet below the floor is judged by getting PAST the
-- approvable list (to agent_off or further), never by sending.
DO $$
DECLARE
  v_uid uuid;
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_fit bigint;
  v_unsure bigint;
  v_closed bigint;
  v_reason text;
BEGIN
  SELECT u.id INTO v_uid FROM auth.users u ORDER BY u.created_at NULLS LAST, u.id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE '20261009124100: no account exists to exercise the decisions against; the catalogue check above is all that ran';
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, release_refusal, blockers)
    VALUES (v_uid, 'decide:' || v_tag || ':fit', 'Self-check Co', 'ready', 'fit-below-floor', '[]')
    RETURNING id INTO v_fit;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, attempts, uncertain_at, blockers)
    VALUES (v_uid, 'decide:' || v_tag || ':unsure', 'Self-check Co', 'blocked', now(), 99, now(),
            '[{"kind":"uncertain-submit","detail":"self-check"}]')
    RETURNING id INTO v_unsure;
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, released_at, attempts, blockers, error)
    VALUES (v_uid, 'decide:' || v_tag || ':closed', 'Self-check Co', 'blocked', now(), 1,
            '[{"kind":"worker","stage":"posting-closed","detail":"posting is closed"}]', 'posting is closed')
    RETURNING id INTO v_closed;

    SELECT d.decide_reason INTO v_reason FROM public.agent_packet_decide(v_uid, v_fit, 'approve') d;
    IF v_reason = 'not_approvable' THEN
      RAISE EXCEPTION '20261009124100: a person still cannot approve a packet below the fit floor';
    END IF;
    SELECT d.decide_reason INTO v_reason FROM public.agent_packet_decide(v_uid, v_unsure, 'retry') d;
    IF v_reason <> 'not_retryable' THEN
      RAISE EXCEPTION '20261009124100: an unconfirmed send could be retried (%)', v_reason;
    END IF;
    SELECT d.decide_reason INTO v_reason FROM public.agent_packet_decide(v_uid, v_closed, 'retry') d;
    IF v_reason <> 'not_retryable' THEN
      RAISE EXCEPTION '20261009124100: a closed posting could be retried (%)', v_reason;
    END IF;
    SELECT d.decide_reason INTO v_reason FROM public.agent_packet_decide(v_uid, v_unsure, 'not_sent') d;
    IF v_reason <> 'recorded_not_sent'
       OR (SELECT uncertain_at FROM public.agent_submissions WHERE id = v_unsure) IS NOT NULL THEN
      RAISE EXCEPTION '20261009124100: an unconfirmed send could not be recorded as not arrived (%)', v_reason;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
