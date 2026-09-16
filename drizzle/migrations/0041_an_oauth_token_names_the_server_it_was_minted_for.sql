CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims jsonb;
BEGIN
  IF coalesce(event->'claims'->>'client_id', '') = '' THEN
    RETURN event;
  END IF;
  v_claims := jsonb_set(
    coalesce(event->'claims', '{}'::jsonb),
    '{aud}',
    to_jsonb('https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp'::text),
    true
  );
  RETURN jsonb_set(event, '{claims}', v_claims, true);
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;