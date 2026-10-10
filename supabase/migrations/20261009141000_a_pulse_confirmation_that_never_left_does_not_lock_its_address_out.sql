-- A PULSE CONFIRMATION THAT NEVER LEFT DOES NOT LOCK ITS ADDRESS OUT (S8-099).
--
-- market_pulse_request_confirm (20261004100000) writes the token, stamps
-- confirm_sent_at and counts confirm_sends BEFORE send-market-pulse calls
-- Resend, and nothing undid them when the send failed: for the next 7 days
-- every request answered "pending" without sending anything, and three
-- provider failures in 90 days blocked the address.
--
-- market_pulse_confirm_unsent(email, token_hash) takes back exactly what that
-- request recorded: it clears the token and the sent stamp and gives the send
-- back to the count. It acts only on the row still holding THAT token, so it
-- can never undo a later request's mail. The stamp it clears was newer than
-- 7 days only because of this request (request_confirm writes only when the
-- previous one is older), so clearing it, not restoring it, gives the same
-- answers. send-market-pulse 2026-10-09.1 calls it when Resend refuses.
--
-- SECURITY INVOKER, service_role only: the edge function calls it with the
-- service role, which owns the table's grants. No new definer function.
--
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.market_pulse_confirm_unsent(p_email text, p_token_hash text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH undone AS (
    UPDATE public.market_pulse_subscribers m
       SET confirm_token_hash = NULL,
           confirm_sent_at = NULL,
           confirm_sends = greatest(m.confirm_sends - 1, 0)
     WHERE m.email = lower(btrim(coalesce(p_email, '')))
       AND coalesce(length(p_token_hash), 0) = 64
       AND m.confirm_token_hash = p_token_hash
    RETURNING 1
  )
  SELECT count(*) > 0 FROM undone;
$$;

COMMENT ON FUNCTION public.market_pulse_confirm_unsent(text, text) IS
  'Takes back a pulse confirmation request whose mail was never sent: clears the token and the sent stamp '
  'and returns the send to the count, only on the row still holding that token. service_role only.';

REVOKE ALL ON FUNCTION public.market_pulse_confirm_unsent(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_pulse_confirm_unsent(text, text) TO service_role;

DO $verify$
DECLARE
  v_sig regprocedure := to_regprocedure('public.market_pulse_confirm_unsent(text,text)');
  v_bad text[] := ARRAY[]::text[];
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'market_pulse_confirm_unsent(text,text) does not exist after this file';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_sig) THEN
    v_bad := v_bad || 'market_pulse_confirm_unsent is SECURITY DEFINER'::text;
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE')
     OR has_function_privilege('authenticated', v_sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    v_bad := v_bad || 'market_pulse_confirm_unsent is not service-role only'::text;
  END IF;
  IF position('m.confirm_token_hash = p_token_hash' in pg_get_functiondef(v_sig)) = 0 THEN
    v_bad := v_bad || 'market_pulse_confirm_unsent does not require the request''s own token'::text;
  END IF;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'pulse unsent self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'a pulse confirmation Resend refused no longer locks its address out';
END
$verify$;
