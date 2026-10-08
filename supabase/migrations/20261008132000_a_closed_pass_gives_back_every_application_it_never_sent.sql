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
-- close. The same page also promises "sends already requested finish even
-- after the clock ends", so a close gives back only what will not go out on
-- its own, and leaves every request that can still finish to finish:
--
--   GIVEN BACK AT CLOSE (agent_pass_settle, once per pass, settled_at):
--     - a packet no worker holds that is failed, stale, blocked (unless a
--       learned answer can still send it again), ready and exhausted at three
--       attempts, or ready and held for a release (the owner's approval, or a
--       re-decision): agent_pass_packet_gives_back;
--     - a queue row with no packet that the preparer will not prepare: one
--       dismissed or expired (status not approved or ready).
--   LEFT TO FINISH:
--     - a queue row still approved or ready with no packet. A pass-only
--       mandate's preparer reads exactly these through agent_queue_unprepared,
--       which refuses a stamped row (20261005133000), and does not re-check
--       the pass window ("the row is the receipt"). The first version of this
--       file stamped them, so a request made before the clock ran out was
--       silently never prepared (review of this file);
--     - a released packet still under three attempts or held by a worker;
--     - a blocked packet a learned answer would send again
--       (agent_retry_after_learned_answer skips a stamped packet).
--   GIVEN BACK LATER, whenever one of those ends unsent after the close: a
--   trigger on each table applies the same rule to a closed pass's rows as
--   they change (a row prepared after the close that lands blocked or held, a
--   packet back from its third attempt unsent, an owner's cancel or dismissal,
--   a queue row deleted unprepared by retention). Once only: the stamp.
--
-- NOTHING ON THE SEND PATH READS A PACKET'S STAMP. A held packet given back
-- at close can still be approved (agent_packet_decide), re-released by the
-- preparer and claimed (agent_claim_submission). When a given-back
-- application is SENT after all, it is charged again: the refund was for a
-- send that had not happened, and now it has. A queue row's stamp is carried
-- to a packet later prepared from it, so the refund trigger never returns the
-- same application twice.
--
-- Not covered: a worker that dies holding a packet on its third attempt
-- leaves it ready with a lapsed lease and writes nothing more, so no trigger
-- fires; a close that comes after the lease lapsed settles it.
--
-- Nothing here is callable by a client.

ALTER TABLE public.agent_passes ADD COLUMN IF NOT EXISTS settled_at timestamptz;
COMMENT ON COLUMN public.agent_passes.settled_at IS
  'When agent_pass_settle gave back the applications this closed pass paid for that will not go out on their own (20261008132000). Set once; later ones are given back as they end.';

-- The one rule for a pass packet: true when it will not be sent unless
-- someone acts, and no worker holds it now.
CREATE OR REPLACE FUNCTION public.agent_pass_packet_gives_back(s public.agent_submissions)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.submitted_at IS NULL
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
     AND public.agent_pass_packet_gives_back(s);
  GET DIAGNOSTICS v_packets = ROW_COUNT;

  UPDATE public.agent_queue q
     SET pass_refunded_at = now()
   WHERE q.pass_id = p_pass_id
     AND q.pass_refunded_at IS NULL
     AND q.status NOT IN ('approved', 'ready')
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

-- After the close, a packet that comes to the same rule is given back then.
-- Named to fire after agent_pass_refund_trg on the same write (triggers on
-- one event fire in name order), and the stamp is taken conditionally, so a
-- packet that trigger already gave back is not given back again.
CREATE OR REPLACE FUNCTION public.agent_pass_settle_late_packet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.agent_passes ap WHERE ap.id = NEW.pass_id AND ap.settled_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  IF NOT public.agent_pass_packet_gives_back(NEW) THEN
    RETURN NULL;
  END IF;
  UPDATE public.agent_submissions s
     SET pass_refunded_at = now()
   WHERE s.id = NEW.id AND s.pass_refunded_at IS NULL AND s.submitted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE public.agent_passes ap
     SET applications_used = greatest(ap.applications_used - 1, 0)
   WHERE ap.id = NEW.pass_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_pass_settle_late_packet() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_settle_late_packet() TO service_role;

DROP TRIGGER IF EXISTS agent_pass_settle_late_packet_trg ON public.agent_submissions;
CREATE TRIGGER agent_pass_settle_late_packet_trg
  AFTER INSERT OR UPDATE OF status, attempts, claimed_at, released_at ON public.agent_submissions
  FOR EACH ROW
  WHEN (NEW.pass_id IS NOT NULL AND NEW.pass_refunded_at IS NULL AND NEW.submitted_at IS NULL)
  EXECUTE FUNCTION public.agent_pass_settle_late_packet();

-- After the close, a queue row that leaves approved/ready with no packet
-- (dismissed by its owner, expired) or is deleted unprepared is given back.
CREATE OR REPLACE FUNCTION public.agent_pass_settle_late_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.agent_queue;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agent_passes ap WHERE ap.id = r.pass_id AND ap.settled_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_submissions s WHERE s.user_id = r.user_id AND s.posting_id = r.posting_id) THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    UPDATE public.agent_queue q
       SET pass_refunded_at = now()
     WHERE q.id = r.id AND q.pass_refunded_at IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;
  UPDATE public.agent_passes ap
     SET applications_used = greatest(ap.applications_used - 1, 0)
   WHERE ap.id = r.pass_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_pass_settle_late_row() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_settle_late_row() TO service_role;

DROP TRIGGER IF EXISTS agent_pass_settle_late_row_trg ON public.agent_queue;
CREATE TRIGGER agent_pass_settle_late_row_trg
  AFTER UPDATE OF status ON public.agent_queue
  FOR EACH ROW
  WHEN (NEW.pass_id IS NOT NULL AND NEW.pass_refunded_at IS NULL AND NEW.status NOT IN ('approved', 'ready'))
  EXECUTE FUNCTION public.agent_pass_settle_late_row();

DROP TRIGGER IF EXISTS agent_pass_settle_late_row_gone_trg ON public.agent_queue;
CREATE TRIGGER agent_pass_settle_late_row_gone_trg
  AFTER DELETE ON public.agent_queue
  FOR EACH ROW
  WHEN (OLD.pass_id IS NOT NULL AND OLD.pass_refunded_at IS NULL)
  EXECUTE FUNCTION public.agent_pass_settle_late_row();

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
  v_triggers text[] := ARRAY['agent_pass_settle_on_close_trg', 'agent_pass_settle_late_packet_trg',
                             'agent_pass_settle_late_row_trg', 'agent_pass_settle_late_row_gone_trg',
                             'agent_submission_carry_pass_refund_trg', 'agent_pass_recharge_on_send_trg'];
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    to_regprocedure('public.agent_pass_packet_gives_back(public.agent_submissions)'),
    to_regprocedure('public.agent_pass_settle(uuid)'),
    to_regprocedure('public.agent_pass_settle_on_close()'),
    to_regprocedure('public.agent_pass_settle_late_packet()'),
    to_regprocedure('public.agent_pass_settle_late_row()'),
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
       WHERE NOT t.tgisinternal AND t.tgname = ANY (v_triggers)) <> cardinality(v_triggers) THEN
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
    VALUES (v_uid, 'cs_self_check_settle_' || v_tag, 1, 1, 9, 9, 1, 1, now() + interval '1 day', now(), now() + interval '1 hour')
    RETURNING id INTO v_pass;
    INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES
      (v_uid, 'settle:' || v_tag || ':queued', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':dismissed', 'dismissed', v_pass),
      (v_uid, 'settle:' || v_tag || ':held', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':blocked', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':inflight', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':sent', 'approved', v_pass),
      (v_uid, 'settle:' || v_tag || ':exhausted', 'approved', v_pass);
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id, released_at, attempts, claimed_at, submitted_at, submitted_via, blockers) VALUES
      (v_uid, 'settle:' || v_tag || ':held', 'Self-check Co', 'ready', v_pass, NULL, 0, NULL, NULL, NULL, '[]'),
      (v_uid, 'settle:' || v_tag || ':blocked', 'Self-check Co', 'blocked', v_pass, NULL, 0, NULL, NULL, NULL, '["unanswerable"]'),
      (v_uid, 'settle:' || v_tag || ':inflight', 'Self-check Co', 'ready', v_pass, now(), 1, now(), NULL, NULL, '[]'),
      (v_uid, 'settle:' || v_tag || ':sent', 'Self-check Co', 'submitted', v_pass, now(), 1, NULL, now(), 'worker', '[]'),
      (v_uid, 'settle:' || v_tag || ':exhausted', 'Self-check Co', 'ready', v_pass, now(), 3, NULL, NULL, NULL, '[]');

    UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended' WHERE id = v_pass;
    SELECT ap.applications_used INTO v_used FROM public.agent_passes ap WHERE ap.id = v_pass;
    -- Given back: dismissed, held, blocked, exhausted. Left to finish: queued,
    -- in flight. Kept: sent.
    IF v_used <> 5 THEN
      RAISE EXCEPTION 'self-check: a closed pass with four applications that will not go shows % used, want 5', v_used;
    END IF;
    IF EXISTS (SELECT 1 FROM public.agent_queue q WHERE q.pass_id = v_pass AND q.posting_id = 'settle:' || v_tag || ':queued' AND q.pass_refunded_at IS NOT NULL) THEN
      RAISE EXCEPTION 'self-check: the close stamped a request the preparer would still send';
    END IF;
    UPDATE public.agent_passes SET closed_at = now(), close_reason = 'refunded' WHERE id = v_pass;
    IF (SELECT ap.applications_used FROM public.agent_passes ap WHERE ap.id = v_pass) <> 5 THEN
      RAISE EXCEPTION 'self-check: a pass was settled twice';
    END IF;

    -- After the close: the queued request is prepared and lands blocked at
    -- preparation; the packet in flight comes back from its third attempt
    -- unsent. Each is given back as it ends.
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id, blockers)
    VALUES (v_uid, 'settle:' || v_tag || ':queued', 'Self-check Co', 'blocked', v_pass, '["needs-you"]');
    UPDATE public.agent_submissions SET status = 'ready', attempts = 3, claimed_at = NULL, claimed_by = ''
     WHERE user_id = v_uid AND posting_id = 'settle:' || v_tag || ':inflight';
    IF (SELECT ap.applications_used FROM public.agent_passes ap WHERE ap.id = v_pass) <> 3 THEN
      RAISE EXCEPTION 'self-check: an application that ended unsent after the close was not given back';
    END IF;

    -- The held packet is approved and sent after the close: charged again.
    UPDATE public.agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'worker', released_at = now()
     WHERE user_id = v_uid AND posting_id = 'settle:' || v_tag || ':held';
    IF (SELECT ap.applications_used FROM public.agent_passes ap WHERE ap.id = v_pass) <> 4 THEN
      RAISE EXCEPTION 'self-check: a given-back application that was sent after all was not charged again';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
