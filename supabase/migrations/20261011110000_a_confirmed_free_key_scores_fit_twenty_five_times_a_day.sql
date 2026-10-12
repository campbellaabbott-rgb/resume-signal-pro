-- A CONFIRMED FREE KEY SCORES FIT TWENTY-FIVE TIMES A DAY.
--
-- OWNER DECISION 2026-10-11 (MCP economics decision 2): résumé-to-job fit
-- scoring is free fair use, 25 calls a UTC day, on any key whose email was
-- confirmed or whose account has proven its mailbox, on both doors (POST
-- /v1/fit and the MCP fit_resume tool). Paid keys and accounts holding Pro or
-- the Agent plan score at job-fit's own per-key ceiling. Until now /v1/fit was
-- paid-only, so a free key got 402 for a dictionary scorer the website gives
-- away at 60 an hour.
--
-- api_key_fit_allowance(p_key_id, p_endpoint) answers the three facts the
-- edge function needs in ONE round trip, and decides nothing itself (the rule
-- lives in supabase/functions/public-api/fit-allowance.ts):
--
--   fa_user_id    the account the key is bound to (NULL for an account-less
--                 key); the edge function asks pro_entitlement_rows about it;
--   fa_confirmed  the key was issued through a confirmed api-key-request link,
--                 i.e. someone who reads that mailbox clicked it
--                 (20261004100000 made that the only way to mint one);
--   fa_proven     the bound account has proven its mailbox
--                 (account_mailbox_proven, 20261005130000);
--   fa_used       this key's api_usage calls today on BOTH fit endpoints
--                 together, which api_key_check has ALREADY counted for the
--                 call being judged: one allowance of 25 a key a day, spent
--                 through either door (review of 9fe3bc0d: counted per door,
--                 a free key scored 25 on each, 50 in all).
--
-- No row for an unknown or revoked key: the caller reads that as no standing.
-- p_endpoint is limited to the two fit endpoints, so this is not a general
-- usage reader.
--
-- OUT names carry an fa_ prefix: an OUT parameter that shares a column name
-- with a table the body reads raises 42702 (the 20260826161200 outage).
--
-- SECURITY DEFINER (it reads api_keys, api_key_requests and auth.users through
-- RLS-locked tables) and executable by service_role only; revoked from PUBLIC,
-- anon and authenticated by name, because Supabase grants a fresh function to
-- the two client roles directly. Safe to re-run: CREATE OR REPLACE, IF NOT
-- EXISTS, and a self-check that writes nothing.

CREATE INDEX IF NOT EXISTS api_key_requests_issued_key_idx
  ON public.api_key_requests (issued_key_id)
  WHERE issued_key_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.api_key_fit_allowance(p_key_id uuid, p_endpoint text)
RETURNS TABLE (
  fa_user_id uuid,
  fa_confirmed boolean,
  fa_proven boolean,
  fa_used integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3s'
AS $$
DECLARE
  v_user uuid;
  v_known boolean := false;
BEGIN
  IF p_key_id IS NULL OR p_endpoint IS NULL OR p_endpoint NOT IN ('/v1/fit', '/mcp/fit_resume') THEN
    RETURN;
  END IF;

  SELECT ak.user_id, true
    INTO v_user, v_known
    FROM public.api_keys ak
   WHERE ak.id = p_key_id
     AND ak.revoked_at IS NULL;
  IF NOT coalesce(v_known, false) THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_user,
    EXISTS (
      SELECT 1 FROM public.api_key_requests kr
       WHERE kr.issued_key_id = p_key_id
         AND kr.confirmed_at IS NOT NULL
    ),
    (v_user IS NOT NULL AND coalesce(public.account_mailbox_proven(v_user), false)),
    coalesce((
      SELECT sum(u.calls)::integer FROM public.api_usage u
       WHERE u.key_id = p_key_id
         AND u.day = (now() AT TIME ZONE 'utc')::date
         AND u.endpoint IN ('/v1/fit', '/mcp/fit_resume')
    ), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_fit_allowance(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_fit_allowance(uuid, text) TO service_role;

COMMENT ON FUNCTION public.api_key_fit_allowance(uuid, text) IS
  'Service-role reader for the free fit allowance (owner decision 2026-10-11: 25 scored calls a UTC day on a confirmed key or proven account). Answers the key''s bound account, whether it came through a confirmed api-key-request link, whether that account proved its mailbox, and today''s api_usage calls on /v1/fit and /mcp/fit_resume together (one allowance across both doors). Decides nothing; public-api/fit-allowance.ts holds the rule (20261011110000).';

-- ── self-check: the catalogue, and an answer that writes nothing ─────────────
DO $$
DECLARE
  v_fn oid := to_regprocedure('public.api_key_fit_allowance(uuid, text)');
  v_n integer;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '20261011110000: api_key_fit_allowance(uuid, text) is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION '20261011110000: api_key_fit_allowance must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261011110000: api_key_fit_allowance is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '20261011110000: service_role cannot execute api_key_fit_allowance';
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_fit_allowance(gen_random_uuid(), '/v1/fit');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '20261011110000: an unknown key must have no standing row';
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_fit_allowance(gen_random_uuid(), '/v1/jobs');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '20261011110000: an endpoint other than the two fit endpoints must answer nothing';
  END IF;
  IF to_regclass('public.api_key_requests_issued_key_idx') IS NULL THEN
    RAISE EXCEPTION '20261011110000: the issued-key index is missing';
  END IF;
END
$$;
