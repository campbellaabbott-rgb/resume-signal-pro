-- AN AGENT KEY ROTATES ATOMICALLY AND COUNTS ONLY ITS OWN.
--
-- Three findings from the agent-mcp security review, one root cause: minting an
-- account-linked key went through api_key_issue, whose active cap is scoped to
-- owner_email — the wrong scope for a per-account credential — and agent-connect
-- revoked the old key BEFORE that mint, which could still be denied.
--
--   1. DoS (medium): api-key-request is unauthenticated and mints account-less
--      keys for any email. Three planted on a victim's address fill the
--      per-email cap of 3, and the victim — whose account-less keys they cannot
--      revoke — can then never mint an agent key. Two features sharing one
--      email-scoped cap, one of them attacker-fillable.
--   2. Keyless window (high): agent-connect revoked the working key, then called
--      a mint that returns 409 when the cap is full — leaving the account with
--      no key at all.
--   3. Uniqueness (medium): the migration claimed "one agent key per user" but
--      the index was non-unique, so nothing enforced it.
--
-- This RPC fixes all three by construction. It runs in one transaction (a
-- plpgsql function is atomic): it revokes the caller's OWN prior agent keys and
-- inserts the new one together, so there is never a keyless window and never
-- more than one live agent key per user. Its only ceiling is per-user_id — an
-- account-less key on the same email is invisible to it, so a stranger cannot
-- lock anyone out. api_key_issue is untouched; the read-only data API keeps its
-- own per-email cap.
--
-- OUT NAMES ARE PREFIXED (issued_ok, issued_key_id, rotated_prior) so none can
-- collide with an api_keys column — the 42702 trap the plpgsql-out-params guard
-- exists for. Added to that guard's loop.

CREATE OR REPLACE FUNCTION public.api_key_issue_agent(
  p_user_id uuid,
  p_email text,
  p_key_hash text,
  p_key_prefix text
)
RETURNS TABLE (
  issued_ok boolean,
  deny_reason text,
  issued_key_id uuid,
  rotated_prior boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
  v_rotated integer;
BEGIN
  IF p_user_id IS NULL OR coalesce(btrim(p_email), '') = '' THEN
    RETURN QUERY SELECT false, 'bad_request'::text, NULL::uuid, false; RETURN;
  END IF;

  -- Rotate: revoke every live agent key this USER already holds. Scoped to
  -- user_id, so account-less keys sharing the email are untouched — and because
  -- this and the insert below are one transaction, a failure anywhere rolls the
  -- revoke back and the old key survives. No keyless window.
  UPDATE public.api_keys
     SET revoked_at = now(), notes = 'rotated by api_key_issue_agent'
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_rotated = ROW_COUNT;

  INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id)
  VALUES (p_key_hash, p_key_prefix, 'agent-mcp', lower(btrim(p_email)), 'free', p_user_id)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT true, NULL::text, v_new_id, (v_rotated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_issue_agent(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_issue_agent(uuid, text, text, text) TO service_role;

-- The partial UNIQUE index that makes "one live agent key per user" a database
-- fact lives in 20260829150000 (the column's own migration). This RPC's
-- transactional revoke-then-insert never approaches it.
