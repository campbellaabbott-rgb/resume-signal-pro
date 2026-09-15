-- A SHARED EGRESS MAKES A PER-ADDRESS BUCKET A GLOBAL ONE, SO BOTH EXIST.
--
-- WHAT THIS IS FOR. The MCP server (supabase/functions/agent-mcp) answers a
-- small set of read tools with no API key at all, so a person who connects
-- claude.ai, Claude Desktop or ChatGPT -- hosts whose connector dialogs have
-- no field for a bearer key -- gets an answer on the first call instead of a
-- wall. An allowance with no key has no key to meter on. This table and this
-- function are that meter, and nothing else: one row per UTC day per bucket.
--
-- WHY TWO BUCKETS, AND WHAT EACH ONE BOUNDS. The address bucket bounds one
-- caller, to the extent the address is the platform's word and not the
-- caller's (the server hashes the edge-set client address, or the last hop a
-- proxy appended; a caller who can rotate what it sends gets a fresh bucket
-- per value, and the global bucket is then the only bound against a script).
-- claude.ai and ChatGPT reach the server from shared egress ranges -- every
-- user of one host arrives from a handful of addresses -- so for those hosts
-- the address bucket is NOT per user: it is a per-host allowance of the cap
-- times that host's egress addresses per day, and the second user of the day
-- behind one address can still meet the wall. Neither bucket fixes that; only
-- an authorization server would, and it is accepted until one exists. The
-- global bucket bounds one thing only: what the unkeyed tier can cost the
-- board in a day, whoever spends it. The caps are the caller's parameters,
-- not this file's, so the server's constants are the single place they are
-- set. The adoption reader can tell the two refusals apart from the rows
-- alone: an address bucket at its cap versus the 'global' row at its cap.
--
-- WHAT IS STORED. A bucket named 'global', and one per address named after a
-- sixteen-character prefix of the address's SHA-256 -- never the address.
-- Key issuance stores no IP by design and this tier stores none either.
-- Seven days of rows are kept for the adoption reader; older rows are removed
-- inside the same call, bounded by the table's own size (days x addresses).
--
-- THE ARITHMETIC. A call is allowed when, after counting it, BOTH buckets are
-- at or under their cap. The counting is one INSERT ... ON CONFLICT DO UPDATE
-- per bucket with the cap in the UPDATE's own WHERE, so a bucket that has
-- reached its cap is never incremented again: the row that crossed the line
-- is the last write. The address bucket is counted first; if the global
-- bucket then refuses, the address's count for this call is given back, so a
-- call the world refused is not also charged to the address. There is no
-- table-level lock: the conflict update takes the row lock, which is all the
-- atomicity two buckets need.
--
-- THE 42702 RULE. Every name in RETURNS TABLE is an OUT parameter in scope for
-- the whole body. None of the five collides with a column of the one table
-- the body touches (day, bucket, calls), and every column reference is
-- alias-qualified anyway. The guard in
-- src/test/plpgsql-out-params-cannot-capture-columns.test.ts reads this file.
--
-- WHO MAY CALL IT. Nobody but the service role: the table is RLS-on with no
-- policy, revoked from PUBLIC, anon and authenticated by name (revoking from
-- PUBLIC alone leaves a direct grant standing -- the definer-exposure and
-- revoke-from-anon lessons), and the function is revoked the same way and
-- granted to service_role only. agent-mcp holds a service client.
--
-- Never through check_rate_limit or rate_limits: that budget is shared with
-- resume upload and checkout and board traffic once 429'd both.
--
-- Harness: scripts/verify-migration-20260915100000.mjs (pglite, executes the
-- body: caps per bucket, the global cap tripping under addresses that are
-- each under their own, day rollover, retention, grants, idempotence).

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
  -- Bounded retention, every call: the table holds at most (days kept) x
  -- (distinct addresses seen), so this touches a handful of rows.
  DELETE FROM public.mcp_anon_rate r WHERE r.day < v_today - 7;

  -- A cap below one admits nothing; say so without writing a row.
  IF p_ip_cap IS NULL OR p_global_cap IS NULL OR p_ip_cap < 1 OR p_global_cap < 1 THEN
    RETURN QUERY SELECT false, 0, 0, coalesce(p_ip_cap, 0), coalesce(p_global_cap, 0);
    RETURN;
  END IF;

  -- The address first: the narrower bucket, and the one whose refusal costs
  -- the world nothing.
  INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls)
  VALUES (v_today, v_ip_bucket, 1)
  ON CONFLICT (day, bucket) DO UPDATE
    SET calls = r.calls + 1
    WHERE r.calls < p_ip_cap
  RETURNING r.calls INTO v_ip;

  IF v_ip IS NULL THEN
    -- The address bucket is at its cap: no write happened, and the global
    -- bucket is not touched for a call that was refused before reaching it.
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
      -- The world is at its cap. Give the address its count for this call
      -- back: a call the global bucket refused is not one the address made.
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
