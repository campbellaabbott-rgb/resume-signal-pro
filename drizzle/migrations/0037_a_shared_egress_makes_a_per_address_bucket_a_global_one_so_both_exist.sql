CREATE TABLE IF NOT EXISTS public.mcp_anon_rate (
  day date NOT NULL,
  bucket text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);

ALTER TABLE public.mcp_anon_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_anon_rate FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mcp_anon_rate TO service_role;

COMMENT ON TABLE public.mcp_anon_rate IS
  'Daily meter for the MCP server''s unkeyed read tier: one row per UTC day per bucket (''global'' and ''ip:'' plus a 16-hex SHA-256 prefix of the address -- never the address). Service-role only; written by mcp_anon_check; rows older than seven days are removed by the same function.';

CREATE OR REPLACE FUNCTION public.mcp_anon_check(p_ip_hash text, p_global_cap integer, p_ip_cap integer)
RETURNS TABLE (
  allowed boolean,
  global_used integer,
  ip_used integer,
  ip_cap integer,
  global_cap integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_ip_bucket text := 'ip:' || coalesce(nullif(btrim(p_ip_hash), ''), 'unknown');
  v_ip integer;
  v_global integer;
  v_ok boolean := true;
BEGIN
  DELETE FROM public.mcp_anon_rate r WHERE r.day < v_today - 7;

  IF p_ip_cap IS NULL OR p_global_cap IS NULL OR p_ip_cap < 1 OR p_global_cap < 1 THEN
    RETURN QUERY SELECT false, 0, 0, coalesce(p_ip_cap, 0), coalesce(p_global_cap, 0);
    RETURN;
  END IF;

  INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls)
  VALUES (v_today, v_ip_bucket, 1)
  ON CONFLICT (day, bucket) DO UPDATE
    SET calls = r.calls + 1
    WHERE r.calls < p_ip_cap
  RETURNING r.calls INTO v_ip;

  IF v_ip IS NULL THEN
    v_ok := false;
    SELECT r.calls INTO v_ip FROM public.mcp_anon_rate r
      WHERE r.day = v_today AND r.bucket = v_ip_bucket;
    SELECT r.calls INTO v_global FROM public.mcp_anon_rate r
      WHERE r.day = v_today AND r.bucket = 'global';
  ELSE
    INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls)
    VALUES (v_today, 'global', 1)
    ON CONFLICT (day, bucket) DO UPDATE
      SET calls = r.calls + 1
      WHERE r.calls < p_global_cap
    RETURNING r.calls INTO v_global;

    IF v_global IS NULL THEN
      v_ok := false;
      SELECT r.calls INTO v_global FROM public.mcp_anon_rate r
        WHERE r.day = v_today AND r.bucket = 'global';
      UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0)
        WHERE r.day = v_today AND r.bucket = v_ip_bucket;
      v_ip := greatest(v_ip - 1, 0);
    END IF;
  END IF;

  RETURN QUERY SELECT v_ok, coalesce(v_global, 0), coalesce(v_ip, 0), p_ip_cap, p_global_cap;
END;
$$;

COMMENT ON FUNCTION public.mcp_anon_check(text, integer, integer) IS
  'Counts one unkeyed MCP call against today''s address bucket and the global bucket and says whether it is allowed (both at or under their caps after counting). A bucket at its cap is never incremented again; a call the global bucket refuses is given back to the address. Service-role only.';

REVOKE ALL ON FUNCTION public.mcp_anon_check(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_anon_check(text, integer, integer) TO service_role;