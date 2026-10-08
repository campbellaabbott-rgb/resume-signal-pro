-- A CLOSED PASS GIVES BACK EVERY APPLICATION IT NEVER SENT.
--
-- WHAT WAS WRONG (platform sweep 2026-10-04, L9-13). The Agent Pass page
-- promises "a send that never happened gives its application back". The
-- refund trigger (20260917170000) gives one back only for a packet that goes
-- stale, or blocked with an error or attempts >= 99. Never returned:
--   - a packet blocked AT PREPARATION (a missing answer, an unsupported
--     question, an unknown form, a CAPTCHA): inserted blocked with error ''
--     and attempts 0;
--   - a packet left ready and never released (held for approval, never
--     approved), or ready and exhausted at three attempts: its status never
--     changes again, so no trigger fires;
--   - a packet whose preparation failed outright (status failed);
--   - a queue row the pass paid for that never became a packet, including
--     one its owner dismissed.
-- A buyer paid for applications that were never sent, against the page.
--
-- OWNER DECISION 2026-10-04: refund all never-sent pass applications at pass
-- close. When a pass closes -- however it closes: the clock, the shelf, a
-- refund; every closer only ever sets closed_at -- agent_pass_settle gives
-- back, once, every application the pass paid for that is not in flight and
-- was never sent:
--   - packets blocked (any reason), failed, or ready and either never
--     released or at three attempts or more, not yet given back;
--   - queue rows with no packet, not yet given back;
-- each stamped pass_refunded_at, and the pass's applications_used reduced by
-- that count. A released packet still under three attempts is in flight and
-- is left alone: the page also promises "sends already requested finish even
-- after the clock ends".
--
-- AND THE COUNT STAYS TRUE IF ONE GOES AFTER ALL. A blocked packet can be
-- unblocked by its owner after the close, and a queued row prepared. Such a
-- packet carries the stamp (a queue row's stamp is carried to the packet made
-- from it), and when it is SENT the application is charged again: the
-- refund was for a send that had not happened, and now it has.
--
-- settled_at is the once-only receipt. Nothing here is callable by a client.

ALTER TABLE public.agent_passes ADD COLUMN IF NOT EXISTS settled_at timestamptz;
COMMENT ON COLUMN public.agent_passes.settled_at IS
  'When agent_pass_settle gave back the applications this closed pass paid for and never sent (20261008132000). Set once.';

CREATE OR REPLACE FUNCTION public.agent_pass_settle(p_pass_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass record;
  v_packets integer := 0;
  v_rows integer := 0;
BEGIN
  SELECT ap.id, ap.closed_at, ap.settled_at INTO v_pass
    FROM public.agent_passes ap
   WHERE ap.id = p_pass_id
   FOR UPDATE;
  IF v_pass.id IS NULL OR v_pass.closed_at IS NULL OR v_pass.settled_at IS NOT NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.agent_submissions s
     SET pass_refunded_at = now()
   WHERE s.pass_id = p_pass_id
     AND s.pass_refunded_at IS NULL
     AND s.submitted_at IS NULL
     AND (s.status IN ('blocked', 'failed')
          OR (s.status = 'ready' AND (s.released_at IS NULL OR s.attempts >= 3)));
  GET DIAGNOSTICS v_packets = ROW_COUNT;

  UPDATE public.agent_queue q
     SET pass_refunded_at = now()
   WHERE q.pass_id = p_pass_id
     AND q.pass_refunded_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.agent_submissions s
        WHERE s.user_id = q.user_id AND s.posting_id = q.posting_id
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE public.agent_passes ap
     SET applications_used = greatest(ap.applications_used - (v_packets + v_rows), 0),
         settled_at = now()
   WHERE ap.id = p_pass_id;

  RETURN v_packets + v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_pass_settle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_settle(uuid) TO service_role;

-- Every closer, through one trigger.
CREATE OR REPLACE FUNCTION public.agent_pass_settle_on_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.agent_pass_settle(NEW.id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_pass_settle_on_close() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_settle_on_close() TO service_role;

DROP TRIGGER IF EXISTS agent_pass_settle_on_close_trg ON public.agent_passes;
CREATE TRIGGER agent_pass_settle_on_close_trg
  AFTER UPDATE OF closed_at ON public.agent_passes
  FOR EACH ROW
  WHEN (NEW.closed_at IS NOT NULL AND NEW.settled_at IS NULL)
  EXECUTE FUNCTION public.agent_pass_settle_on_close();

-- A packet prepared from a queue row the close already gave back carries
-- that stamp, so the refund trigger never gives the same application back a
-- second time and a later send is charged again.
CREATE OR REPLACE FUNCTION public.agent_submission_carry_pass_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.pass_id IS NOT NULL AND NEW.pass_refunded_at IS NULL THEN
    SELECT q.pass_refunded_at INTO NEW.pass_refunded_at
      FROM public.agent_queue q
     WHERE q.user_id = NEW.user_id
       AND q.posting_id = NEW.posting_id
       AND q.pass_id = NEW.pass_id
       AND q.pass_refunded_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_submission_carry_pass_refund() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_submission_carry_pass_refund() TO service_role;

DROP TRIGGER IF EXISTS agent_submission_carry_pass_refund_trg ON public.agent_submissions;
CREATE TRIGGER agent_submission_carry_pass_refund_trg
  BEFORE INSERT ON public.agent_submissions
  FOR EACH ROW
  WHEN (NEW.pass_id IS NOT NULL)
  EXECUTE FUNCTION public.agent_submission_carry_pass_refund();

-- A given-back application that is sent after all is charged again.
CREATE OR REPLACE FUNCTION public.agent_pass_recharge_on_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.agent_passes ap
     SET applications_used = least(ap.applications_used + 1, ap.applications_total)
   WHERE ap.id = NEW.pass_id;
  UPDATE public.agent_submissions s
     SET pass_refunded_at = NULL
   WHERE s.id = NEW.id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_pass_recharge_on_send() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_recharge_on_send() TO service_role;

DROP TRIGGER IF EXISTS agent_pass_recharge_on_send_trg ON public.agent_submissions;
CREATE TRIGGER agent_pass_recharge_on_send_trg
  AFTER UPDATE OF status ON public.agent_submissions
  FOR EACH ROW
  WHEN (NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted'
        AND NEW.pass_id IS NOT NULL AND NEW.pass_refunded_at IS NOT NULL)
  EXECUTE FUNCTION public.agent_pass_recharge_on_send();

-- Passes that closed before this file ran are settled now, once.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT ap.id FROM public.agent_passes ap WHERE ap.closed_at IS NOT NULL AND ap.settled_at IS NULL LOOP
    PERFORM public.agent_pass_settle(r.id);
  END LOOP;
END $$;

-- ── self-check: the catalogue ───────────────────────────────────────────────
DO $$
DECLARE
  v_fn oid;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    to_regprocedure('public.agent_pass_settle(uuid)'),
    to_regprocedure('public.agent_pass_settle_on_close()'),
    to_regprocedure('public.agent_submission_carry_pass_refund()'),
    to_regprocedure('public.agent_pass_recharge_on_send()')
  ]) LOOP
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'self-check: one of the pass settlement functions is missing';
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', v_fn::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal
         AND t.tgname IN ('agent_pass_settle_on_close_trg', 'agent_submission_carry_pass_refund_trg', 'agent_pass_recharge_on_send_trg')) <> 3 THEN
    RAISE EXCEPTION 'self-check: a pass settlement trigger is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_passes ap WHERE ap.closed_at IS NOT NULL AND ap.settled_at IS NULL) THEN
    RAISE EXCEPTION 'self-check: a closed pass was left unsettled';
  END IF;
  IF has_column_privilege('authenticated', 'public.agent_passes', 'settled_at', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check: the owner can write agent_passes.settled_at';
  END IF;
END $$;

-- ── self-check, exercised ───────────────────────────────────────────────────
-- One pass with one of every shape, closed, on the first account; inside a
-- block that always raises RB000, so nothing survives.
DO $$
DECLARE
  v_uid uuid;
  v_pass uuid;
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_used integer;
BEGIN
  SELECT u.id INTO v_uid FROM auth.users u ORDER BY u.created_at NULLS LAST, u.id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'self-check: no account exists to exercise the settlement against; the catalogue checks above are all that ran';
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended' WHERE user_id = v_uid AND closed_at IS NULL;
    -- Placeholder numbers, never the pass's own (declared once, in
    -- supabase/functions/_shared/pass.ts).
    INSERT INTO public.agent_passes (user_id, stripe_session_id, amount_cents, session_hours, applications_total,
                                     applications_used, rate_per_min, daily_quota, shelf_expires_at, activated_at, expires_at)
    VALUES (v_uid, 'cs_self_check_settle_' || v_tag, 1, 1, 8, 8, 1, 1, now() + interval '1 day', now(), now() + interval '1 hour')
    RETURNING id INTO v_pass;
    INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES
      (v_uid, 'settle:' || v_tag || ':queued', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':held', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':blocked', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':inflight', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':sent', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':exhausted', 'approved', v_pass);
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id, released_at, attempts, submitted_at, submitted_via, blockers) VALUES
      (v_uid, 'settle:' || v_tag || ':held', 'Self-check Co', 'ready', v_pass, NULL, 0, NULL, NULL, '[]'),
      (v_uid, 'settle:' || v_tag || ':blocked', 'Self-check Co', 'blocked', v_pass, NULL, 0, NULL, NULL, '["unanswerable"]'),
      (v_uid, 'settle:' || v_tag || ':inflight', 'Self-check Co', 'ready', v_pass, now(), 1, NULL, NULL, '[]'),
      (v_uid, 'settle:' || v_tag || ':sent', 'Self-check Co', 'submitted', v_pass, now(), 1, now(), 'worker', '[]'),
      (v_uid, 'settle:' || v_tag || ':exhausted', 'Self-check Co', 'ready', v_pass, now(), 3, NULL, NULL, '[]');

    UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended' WHERE id = v_pass;
    SELECT ap.applications_used INTO v_used FROM public.agent_passes ap WHERE ap.id = v_pass;
    -- Given back: queued (no packet), held, blocked, exhausted. Kept: in flight, sent.
    IF v_used <> 4 THEN
      RAISE EXCEPTION 'self-check: a closed pass with four never-sent applications shows % used, want 4', v_used;
    END IF;
    UPDATE public.agent_passes SET closed_at = now(), close_reason = 'refunded' WHERE id = v_pass;
    IF (SELECT ap.applications_used FROM public.agent_passes ap WHERE ap.id = v_pass) <> 4 THEN
      RAISE EXCEPTION 'self-check: a pass was settled twice';
    END IF;

    -- The held packet is approved and sent after the close: charged again.
    UPDATE public.agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'worker', released_at = now()
     WHERE user_id = v_uid AND posting_id = 'settle:' || v_tag || ':held';
    IF (SELECT ap.applications_used FROM public.agent_passes ap WHERE ap.id = v_pass) <> 5 THEN
      RAISE EXCEPTION 'self-check: a given-back application that was sent after all was not charged again';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
