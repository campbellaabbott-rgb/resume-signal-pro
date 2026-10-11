CREATE OR REPLACE FUNCTION public.client_callable_unlisted_names()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $unlisted$
  WITH census_body AS (
    SELECT p.prosrc AS body
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'client_callable_census' AND p.pronargs = 0
  ),
  named AS (
    SELECT m.sig[1] AS sig, to_regprocedure(m.sig[1]) AS f
      FROM census_body,
           regexp_matches(census_body.body, '''(public\.[A-Za-z0-9_]+\([^'']*\))''', 'g') AS m(sig)
  ),
  listed AS (
    SELECT array_remove(ARRAY(SELECT f::oid FROM named), NULL) AS oids
  ),
  open_definers AS (
    SELECT p.oid,
           p.oid::regprocedure::text AS sig,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prosecdef
       AND p.prorettype <> 'trigger'::regtype
  ),
  unlisted AS (
    SELECT d.sig, d.anon_x, d.auth_x
      FROM open_definers d, listed
     WHERE (d.anon_x OR d.auth_x) AND NOT (d.oid = ANY (listed.oids))
  ),
  census AS (
    SELECT (public.client_callable_census() ->> 'unlisted_client_callable')::int AS n
  )
  SELECT jsonb_build_object(
    'unlisted', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'signature', u.sig, 'anon', u.anon_x, 'authenticated', u.auth_x)
                          ORDER BY u.sig) FROM unlisted u), '[]'::jsonb),
    'census_unlisted_client_callable', (SELECT n FROM census),
    'agrees', (SELECT count(*) FROM unlisted) = (SELECT n FROM census),
    'census_signatures_read', (SELECT count(*) FROM named),
    'census_signatures_missing', (SELECT count(*) FROM named WHERE f IS NULL)
  )
$unlisted$;

COMMENT ON FUNCTION public.client_callable_unlisted_names() IS
  'The signatures of the SECURITY DEFINER functions in public that anon or authenticated can '
  'execute and that no list in client_callable_census() names, with which client role can call '
  'each; the census''s own unlisted count beside them and whether the two agree. Reads the '
  'census''s stored body for its lists rather than keeping a copy. INVOKER rights, catalogue '
  'reads only. Service role only: the owner reaches it through admin-ops with the ADMIN_API_KEY.';

REVOKE ALL ON FUNCTION public.client_callable_unlisted_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_callable_unlisted_names() TO service_role;

DO $check$
DECLARE
  f regprocedure := to_regprocedure('public.client_callable_unlisted_names()');
  r jsonb;
BEGIN
  IF f IS NULL THEN
    RAISE EXCEPTION 'client_callable_unlisted_names() was not created';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'client_callable_unlisted_names() is SECURITY DEFINER; it must run with the caller''s rights';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'client_callable_unlisted_names() is callable with a client key; the names are for the owner only';
  END IF;
  IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'client_callable_unlisted_names() is not executable by service_role, so admin-ops cannot read it';
  END IF;
  r := public.client_callable_unlisted_names();
  IF (r ->> 'census_signatures_read')::int = 0 THEN
    RAISE EXCEPTION 'client_callable_unlisted_names() read no signature out of client_callable_census()''s body';
  END IF;
  IF NOT (r ->> 'agrees')::boolean THEN
    RAISE EXCEPTION 'client_callable_unlisted_names() lists % function(s) where the census counts %: the parse does not follow the census',
      jsonb_array_length(r -> 'unlisted'), r ->> 'census_unlisted_client_callable';
  END IF;
  RAISE NOTICE 'client_callable_unlisted_names: %', r -> 'unlisted';
END $check$;