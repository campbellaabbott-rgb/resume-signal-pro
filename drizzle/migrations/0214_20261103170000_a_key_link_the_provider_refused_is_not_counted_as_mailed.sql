-- A KEY LINK THE PROVIDER REFUSED IS NOT COUNTED AS MAILED (S13-072, 2026-11-03).
--
-- WHAT WAS WRONG. api_key_request_open (20261004100000) records the request
-- row before api-key-request calls the mail provider, and every row counts
-- toward the mailbox's two links a day and the day's ceilings. When the
-- provider refused the send (or the call threw) the request answered 502, but
-- its row kept counting: after two refusals the address was at its daily
-- limit, and the next request was answered like a mailed one ("If that
-- address can receive mail from us, a link is on its way") with nothing sent.
--
-- NOW: api_key_request_unsent(p_token_hash) marks the row whose mail never
-- left (mail_refused_at), and api_key_request_open no longer counts such a row
-- toward the mailbox's allowance or the day's ceilings. It still counts
-- toward the caller's network, so a network cannot use refusals to make
-- requests without limit. The row's link stays as it was: the token went only
-- into the mail, so a refused mail leaves nobody holding it, and a send that
-- threw after the provider accepted it still delivers a working link.
--
-- api_key_request_open is replaced with the same signature, the same result
-- and the same body as 20261004100000 apart from those two counts.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, explicit
-- REVOKE and GRANT, and a self-check whose probe rows are rolled back.

ALTER TABLE public.api_key_requests
  ADD COLUMN IF NOT EXISTS mail_refused_at timestamptz;

COMMENT ON COLUMN public.api_key_requests.mail_refused_at IS
  'When the mail provider refused this request''s confirmation mail, or the send threw. Such a row does not count toward the mailbox''s or the day''s allowance; it still counts toward the network''s. 20261103170000.';

CREATE OR REPLACE FUNCTION public.api_key_request_unsent(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_marked boolean;
BEGIN
  IF coalesce(length(p_token_hash), 0) <> 64 THEN
    RAISE EXCEPTION 'api_key_request_unsent: invalid arguments' USING ERRCODE = '22023';
  END IF;
  -- Only a request made in the last hour, never confirmed and never marked:
  -- the edge function calls this moments after the row was written.
  UPDATE public.api_key_requests kr
     SET mail_refused_at = now()
   WHERE kr.token_hash = p_token_hash
     AND kr.mail_refused_at IS NULL
     AND kr.confirmed_at IS NULL
     AND kr.issued_key_id IS NULL
     AND kr.created_at > now() - interval '1 hour'
  RETURNING true INTO v_marked;
  RETURN coalesce(v_marked, false);
END;
$$;

COMMENT ON FUNCTION public.api_key_request_unsent(text) IS
  'Marks the unconfirmed request whose confirmation mail the provider refused, so it stops counting toward the mailbox and the day. service_role only. 20261103170000.';

REVOKE ALL ON FUNCTION public.api_key_request_unsent(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_request_unsent(text) TO service_role;

CREATE OR REPLACE FUNCTION public.api_key_request_open(
  p_email text,
  p_name text,
  p_token_hash text,
  p_net text
)
RETURNS TABLE (
  rq_send boolean,
  rq_reason text,
  rq_live_keys integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_mailbox text;
  v_n integer;
  v_net_day integer := 0;
  v_live integer;
  c_per_mailbox_day integer := 2;
  c_per_net_hour integer := 5;
  c_per_net_day integer := 20;
  -- Past the soft ceiling only a network with no request today is served
  -- ('shed'); the hard ceiling stops everyone ('paused'). Either one is a
  -- day a real visitor may be turned away, and the edge function tells the
  -- owner. Fifteen networks used to be enough to fill a hard 300.
  c_global_soft integer := 150;
  c_global_day integer := 600;
  c_net_share integer := 1;
BEGIN
  IF length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
    RETURN QUERY SELECT false, 'invalid_email'::text, 0; RETURN;
  END IF;
  IF coalesce(length(p_token_hash), 0) <> 64 THEN
    RETURN QUERY SELECT false, 'bad_request'::text, 0; RETURN;
  END IF;

  -- Every count below and the insert after them are one decision: requests
  -- and mints share this lock, so no two can both read the last free slot.
  PERFORM pg_advisory_xact_lock(hashtext('api_key_issuance'));
  v_mailbox := public.api_key_mailbox(v_email);

  -- THE CALLER'S NETWORK AND THE DAY FIRST, THE ADDRESS LAST (see
  -- 20261004100000). A request whose mail was refused still counts here.
  IF p_net IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.api_key_requests kr
     WHERE kr.request_net = p_net AND kr.created_at > now() - interval '1 hour';
    IF v_n >= c_per_net_hour THEN
      RETURN QUERY SELECT false, 'network_busy'::text, 0; RETURN;
    END IF;
    SELECT count(*) INTO v_net_day FROM public.api_key_requests kr
     WHERE kr.request_net = p_net AND kr.created_at > now() - interval '24 hours';
    IF v_net_day >= c_per_net_day THEN
      RETURN QUERY SELECT false, 'network_busy'::text, 0; RETURN;
    END IF;
  END IF;

  -- The day's ceilings count mail that left, never mail the provider refused.
  SELECT count(*) INTO v_n FROM public.api_key_requests kr
   WHERE kr.created_at > now() - interval '24 hours' AND kr.mail_refused_at IS NULL;
  IF v_n >= c_global_day THEN
    RETURN QUERY SELECT false, 'paused'::text, 0; RETURN;
  END IF;
  IF v_n >= c_global_soft AND (p_net IS NULL OR v_net_day >= c_net_share) THEN
    RETURN QUERY SELECT false, 'shed'::text, 0; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.suppressed_emails se
              WHERE lower(se.email) = v_email AND se.reason IN ('bounce', 'complaint')) THEN
    RETURN QUERY SELECT false, 'undeliverable'::text, 0; RETURN;
  END IF;

  -- So does the mailbox's allowance (S13-072).
  SELECT count(*) INTO v_n FROM public.api_key_requests kr
   WHERE kr.mailbox = v_mailbox AND kr.created_at > now() - interval '24 hours' AND kr.mail_refused_at IS NULL;
  IF v_n >= c_per_mailbox_day THEN
    RETURN QUERY SELECT false, 'too_many_requests'::text, 0; RETURN;
  END IF;

  INSERT INTO public.api_key_requests (email, mailbox, key_name, token_hash, request_net, expires_at)
  VALUES (v_email, v_mailbox, left(coalesce(nullif(btrim(p_name), ''), 'Untitled key'), 80),
          p_token_hash, p_net, now() + interval '24 hours');

  SELECT count(*) INTO v_live FROM public.api_keys ak
   WHERE ak.user_id IS NULL AND ak.revoked_at IS NULL
     AND public.api_key_mailbox(ak.owner_email) = v_mailbox;

  RETURN QUERY SELECT true, 'sent'::text, v_live;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_request_open(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_request_open(text, text, text, text) TO service_role;

-- Self-verifying: both functions are definers with their own search_path,
-- closed to anon and authenticated and open to service_role; the column is
-- there and the table is still closed to the client roles. Then, by
-- behaviour, inside a block that always ends in an exception so every probe
-- row is rolled back: a mailbox whose two links were refused is still sent a
-- third, a mailbox whose two links left is not, and refused requests still
-- count toward their network. A day already at its ceiling refuses the first
-- probe ('paused' or 'shed'); the behaviour is then left unproven rather than
-- failing a deploy over the day's traffic.
DO $$
DECLARE
  v_sig text;
  v_oid oid;
  v_probe_bad text;
  v_skipped boolean := false;
  v_r record;
  c_net_a constant text := '0000000000self-check-20261103170000-a';
  c_net_b constant text := '0000000000self-check-20261103170000-b';
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['public.api_key_request_unsent(text)', 'public.api_key_request_open(text,text,text,text)'] LOOP
    v_oid := to_regprocedure(v_sig)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'self-check: % is missing', v_sig;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by anon or authenticated', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is not executable by service_role', v_sig;
    END IF;
    IF NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false)
       OR NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
                       WHERE p.oid = v_oid AND c.setting LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'self-check: % is not a definer with its own search_path', v_sig;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'api_key_requests' AND column_name = 'mail_refused_at') THEN
    RAISE EXCEPTION 'self-check: api_key_requests.mail_refused_at was not added';
  END IF;
  IF has_table_privilege('anon', 'public.api_key_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.api_key_requests', 'SELECT') THEN
    RAISE EXCEPTION 'self-check: api_key_requests is readable by a client role';
  END IF;

  BEGIN
    SELECT * INTO v_r FROM public.api_key_request_open('0000000000-refused@probe.invalid', 'probe', repeat('a', 64), c_net_a);
    IF v_r.rq_reason IN ('paused', 'shed') THEN
      v_skipped := true;
    ELSE
      -- Network A: two requests whose mail was refused, then a third. It is sent.
      IF NOT v_r.rq_send THEN v_probe_bad := 'the first probe request was refused: ' || v_r.rq_reason; END IF;
      IF NOT public.api_key_request_unsent(repeat('a', 64)) THEN v_probe_bad := coalesce(v_probe_bad, 'the refused request was not marked'); END IF;
      IF public.api_key_request_unsent(repeat('a', 64)) THEN v_probe_bad := coalesce(v_probe_bad, 'a request was marked twice'); END IF;
      PERFORM public.api_key_request_open('0000000000-refused@probe.invalid', 'probe', repeat('b', 64), c_net_a);
      PERFORM public.api_key_request_unsent(repeat('b', 64));
      SELECT * INTO v_r FROM public.api_key_request_open('0000000000-refused@probe.invalid', 'probe', repeat('c', 64), c_net_a);
      IF NOT v_r.rq_send THEN v_probe_bad := coalesce(v_probe_bad, 'two refused links used up the mailbox: ' || v_r.rq_reason); END IF;
      -- Network B: two requests that left, then a third. It is not sent.
      PERFORM public.api_key_request_open('0000000000-mailed@probe.invalid', 'probe', repeat('d', 64), c_net_b);
      PERFORM public.api_key_request_open('0000000000-mailed@probe.invalid', 'probe', repeat('e', 64), c_net_b);
      SELECT * INTO v_r FROM public.api_key_request_open('0000000000-mailed@probe.invalid', 'probe', repeat('f', 64), c_net_b);
      IF v_r.rq_send OR v_r.rq_reason <> 'too_many_requests' THEN
        v_probe_bad := coalesce(v_probe_bad, 'a mailbox past its two mailed links was answered ' || v_r.rq_reason);
      END IF;
      -- Network A again: three rows plus two more is its hour's five, two of
      -- them refused. The sixth is busy.
      PERFORM public.api_key_request_open('0000000000-other-1@probe.invalid', 'probe', repeat('1', 64), c_net_a);
      PERFORM public.api_key_request_open('0000000000-other-2@probe.invalid', 'probe', repeat('2', 64), c_net_a);
      SELECT * INTO v_r FROM public.api_key_request_open('0000000000-other-3@probe.invalid', 'probe', repeat('3', 64), c_net_a);
      IF v_r.rq_send OR v_r.rq_reason <> 'network_busy' THEN
        v_probe_bad := coalesce(v_probe_bad, 'refused requests stopped counting toward their network: ' || v_r.rq_reason);
      END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'self-check-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'self-check-rollback' THEN RAISE; END IF;
  END;
  IF v_probe_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check: %', v_probe_bad;
  END IF;
  IF v_skipped THEN
    RAISE NOTICE 'self-check: the day is at its ceiling, so the counting probe was not run';
  END IF;
END $$;
