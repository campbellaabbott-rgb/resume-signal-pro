-- A FIT CALL THAT SCORED NOTHING GIVES ITS ALLOWANCE BACK (S14X-132, M-S14-106).
--
-- The free fit allowance is 25 SCORED calls a UTC day on a confirmed key
-- (owner decision 2026-10-11; 20261011110000), and api_key_fit_allowance read
-- it back as this key's api_usage calls today on both fit doors. api_usage
-- counts every metered call, so a résumé under 100 characters, a body that was
-- not JSON, a résumé with no occupation in it, a search that found nothing, a
-- refusal and a scorer that failed each spent one of the 25 and scored
-- nothing (a GET to /v1/fit did too, until public-api refused it before the
-- key is metered).
--
-- So the reader now subtracts the calls that scored nothing:
--
--   api_fit_unscored(key_id, day, endpoint, calls)
--       one row per key, UTC day and fit door: how many of that door's calls
--       today scored nothing. RLS on, no policies, and no client role may
--       touch it; only the definer below writes it.
--
--   api_key_fit_unscored(p_key_id, p_endpoint) -> boolean
--       one give-back for one call that scored nothing, called by the edge
--       function after the outcome is known. Limited to the two fit doors and
--       to a live key, and never past that door's own calls today (ON
--       CONFLICT ... WHERE), so the count cannot go negative and a caller
--       cannot give back calls that were never made. Answers true when it
--       counted one. Rows older than yesterday are pruned as it goes.
--
--   api_key_fit_allowance(p_key_id, p_endpoint), re-issued with the same
--       signature and OUT columns: fa_used = greatest(0, fit calls today on
--       both doors - calls that scored nothing on both doors).
--
-- api_usage is unchanged: the key's daily request quota, /v1/usage and any
-- invoice still count every call. Either deploy order is safe: a function
-- build that never calls the give-back leaves fa_used exactly as before, and
-- the new public-api logs and swallows the missing RPC if it lands first.
--
-- SECURITY DEFINER with search_path pinned, executable by service_role only;
-- revoked from PUBLIC, anon and authenticated by name, because Supabase
-- grants a fresh table and a fresh function to the two client roles directly.
-- Safe to re-run: IF NOT EXISTS, CREATE OR REPLACE, grants restated, and a
-- self-check that writes nothing.

CREATE TABLE IF NOT EXISTS public.api_fit_unscored (
  key_id   uuid    NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  day      date    NOT NULL,
  endpoint text    NOT NULL CHECK (endpoint IN ('/v1/fit', '/mcp/fit_resume')),
  calls    integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (key_id, day, endpoint)
);

ALTER TABLE public.api_fit_unscored ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_fit_unscored FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.api_fit_unscored IS
  'Per key, UTC day and fit door (/v1/fit, /mcp/fit_resume): how many of that door''s metered calls today scored nothing. Written only by api_key_fit_unscored, never above that door''s api_usage calls; subtracted by api_key_fit_allowance so the free allowance counts scorings, not calls (20261112200000).';

CREATE OR REPLACE FUNCTION public.api_key_fit_unscored(p_key_id uuid, p_endpoint text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3s'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_calls integer;
  v_done  boolean;
BEGIN
  IF p_key_id IS NULL OR p_endpoint IS NULL OR p_endpoint NOT IN ('/v1/fit', '/mcp/fit_resume') THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.api_keys ak WHERE ak.id = p_key_id AND ak.revoked_at IS NULL) THEN
    RETURN false;
  END IF;

  SELECT u.calls INTO v_calls
    FROM public.api_usage u
   WHERE u.key_id = p_key_id
     AND u.day = v_today
     AND u.endpoint = p_endpoint;
  IF coalesce(v_calls, 0) < 1 THEN
    RETURN false;
  END IF;

  INSERT INTO public.api_fit_unscored AS f (key_id, day, endpoint, calls)
  VALUES (p_key_id, v_today, p_endpoint, 1)
  ON CONFLICT (key_id, day, endpoint) DO UPDATE
     SET calls = f.calls + 1
   WHERE f.calls < v_calls
  RETURNING true INTO v_done;

  DELETE FROM public.api_fit_unscored WHERE day < v_today - 1;

  RETURN coalesce(v_done, false);
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_fit_unscored(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_fit_unscored(uuid, text) TO service_role;

COMMENT ON FUNCTION public.api_key_fit_unscored(uuid, text) IS
  'Service-role writer: one give-back for a fit call that scored nothing (bad body, short or role-less résumé, no rows, refusal, scorer failure), on /v1/fit or /mcp/fit_resume, for a live key, never above that door''s api_usage calls today. True when it counted one. Prunes rows older than yesterday (20261112200000).';

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
    greatest(0,
      coalesce((
        SELECT sum(u.calls)::integer FROM public.api_usage u
         WHERE u.key_id = p_key_id
           AND u.day = (now() AT TIME ZONE 'utc')::date
           AND u.endpoint IN ('/v1/fit', '/mcp/fit_resume')
      ), 0)
      - coalesce((
        SELECT sum(f.calls)::integer FROM public.api_fit_unscored f
         WHERE f.key_id = p_key_id
           AND f.day = (now() AT TIME ZONE 'utc')::date
           AND f.endpoint IN ('/v1/fit', '/mcp/fit_resume')
      ), 0));
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_fit_allowance(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_fit_allowance(uuid, text) TO service_role;

COMMENT ON FUNCTION public.api_key_fit_allowance(uuid, text) IS
  'Service-role reader for the free fit allowance (owner decision 2026-10-11: 25 scored calls a UTC day on a confirmed key or proven account). Answers the key''s bound account, whether it came through a confirmed api-key-request link, whether that account proved its mailbox, and today''s calls on /v1/fit and /mcp/fit_resume together less the calls that scored nothing (api_fit_unscored), never below zero: one allowance across both doors, counting scorings. Decides nothing; public-api/fit-allowance.ts holds the rule (20261011110000, 20261112200000).';

-- ── self-check: the catalogue, and answers that write nothing ───────────────
DO $$
DECLARE
  v_tab  regclass := to_regclass('public.api_fit_unscored');
  v_give oid := to_regprocedure('public.api_key_fit_unscored(uuid, text)');
  v_read oid := to_regprocedure('public.api_key_fit_allowance(uuid, text)');
  v_role text;
  v_n integer;
BEGIN
  IF v_tab IS NULL THEN
    RAISE EXCEPTION '20261112200000: public.api_fit_unscored is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_tab) THEN
    RAISE EXCEPTION '20261112200000: api_fit_unscored must have row level security on';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, v_tab, 'SELECT') OR has_table_privilege(v_role, v_tab, 'INSERT')
       OR has_table_privilege(v_role, v_tab, 'UPDATE') OR has_table_privilege(v_role, v_tab, 'DELETE') THEN
      RAISE EXCEPTION '20261112200000: % can reach api_fit_unscored', v_role;
    END IF;
  END LOOP;

  IF v_give IS NULL OR v_read IS NULL THEN
    RAISE EXCEPTION '20261112200000: api_key_fit_unscored or api_key_fit_allowance (uuid, text) is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_give) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_read) THEN
    RAISE EXCEPTION '20261112200000: both fit functions must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_give, 'EXECUTE') OR has_function_privilege('authenticated', v_give, 'EXECUTE')
     OR has_function_privilege('anon', v_read, 'EXECUTE') OR has_function_privilege('authenticated', v_read, 'EXECUTE') THEN
    RAISE EXCEPTION '20261112200000: a fit function is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_give, 'EXECUTE') OR NOT has_function_privilege('service_role', v_read, 'EXECUTE') THEN
    RAISE EXCEPTION '20261112200000: service_role cannot execute a fit function';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_read) NOT LIKE '%api_fit_unscored%' THEN
    RAISE EXCEPTION '20261112200000: api_key_fit_allowance does not subtract the calls that scored nothing';
  END IF;

  -- An unknown key and a non-fit endpoint are refused before anything is written.
  IF public.api_key_fit_unscored(gen_random_uuid(), '/v1/fit') OR public.api_key_fit_unscored(gen_random_uuid(), '/v1/jobs') THEN
    RAISE EXCEPTION '20261112200000: a give-back was counted for an unknown key or a non-fit endpoint';
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_fit_allowance(gen_random_uuid(), '/v1/fit');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '20261112200000: an unknown key must have no standing row';
  END IF;
END
$$;
