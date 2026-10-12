-- THE WRITING TOOLS ARE COUNTED BY ACCOUNT: ONE A DAY FREE, FIVE ON PRO.
--
-- OWNER DECISION 2026-10-12. The tailored résumé, the cover letter and the
-- interview-prep set are gated by account on the server: signed out none; a
-- free account one of each a UTC day; Pro five packages a UTC day and sixty a
-- UTC month (a package is one of each tool for one job, so each tool counts
-- five and sixty on its own). Until now they answered anyone holding the
-- publishable key, bounded only by an address allowance.
--
-- writing_tool_uses holds one row per use: the account, the tool, the tier it
-- was taken on and when. The figures are NOT written here: the edge function
-- passes them (supabase/functions/_shared/writing-allowance.ts holds them, and
-- src/config/writing-allowance.ts mirrors them for the pages), and this file
-- bounds what it accepts.
--
-- take_writing_tools(user, tools, per_day, per_month, tier) takes one use of
-- each named tool, all or none, under a lock on the account so two tabs
-- cannot both spend the last one. It answers jsonb:
--   { allowed: true, use_ids: [...] }, or
--   { allowed: false, reason: 'daily_limit' | 'monthly_limit', tool, limit,
--     resets_at } with the next UTC midnight or the first of the next UTC
--   month. A spent month is reported before a spent day, so a person is never
--   told "tomorrow" when tomorrow is refused too.
-- refund_writing_tools(user, use_ids) gives back uses taken in the last
-- fifteen minutes by that account: a call that did not deliver costs nothing.
--
-- Rows older than the month before last are pruned on each take; an account's
-- rows go with the account (ON DELETE CASCADE).
--
-- Both functions are SECURITY DEFINER and executable by service_role only
-- (the edge functions call them with the service-role key; no page calls
-- them), revoked from PUBLIC, anon and authenticated by name because Supabase
-- grants a fresh function to the two client roles directly. The table is
-- revoked from the same three for the same reason: Supabase gives a new public
-- table ALL for anon and authenticated. Safe to re-run: IF NOT EXISTS, CREATE
-- OR REPLACE, and a self-check that writes nothing.

CREATE TABLE IF NOT EXISTS public.writing_tool_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool text NOT NULL CHECK (tool IN ('resume', 'letter', 'prep')),
  tier text NOT NULL CHECK (tier IN ('free', 'pro')),
  used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writing_tool_uses_user_tool_at_idx
  ON public.writing_tool_uses (user_id, tool, used_at DESC);

ALTER TABLE public.writing_tool_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.writing_tool_uses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.writing_tool_uses TO service_role;

COMMENT ON TABLE public.writing_tool_uses IS
  'One row per use of a writing tool (tailored résumé, cover letter, interview prep) by an account, for the account allowance (owner decision 2026-10-12; 20261011160000). Written only by take_writing_tools and refund_writing_tools.';

CREATE OR REPLACE FUNCTION public.take_writing_tools(
  p_user_id uuid,
  p_tools text[],
  p_per_day integer,
  p_per_month integer,
  p_tier text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_now timestamptz := now();
  -- Boundaries are computed on the UTC wall clock and only then turned back
  -- into instants: interval arithmetic on a timestamptz follows the session's
  -- time zone, so a session that is not UTC would move "next month" by hours.
  v_day_start timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day_end timestamptz := (date_trunc('day', v_now AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC';
  v_month_start timestamptz := date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_month_end timestamptz := (date_trunc('month', v_now AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
  v_tool text;
  v_day integer;
  v_month integer;
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'take_writing_tools: no account';
  END IF;
  IF p_tools IS NULL OR cardinality(p_tools) < 1 OR cardinality(p_tools) > 3 THEN
    RAISE EXCEPTION 'take_writing_tools: name one to three tools';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_tools) t WHERE t IS NULL OR t NOT IN ('resume', 'letter', 'prep')) THEN
    RAISE EXCEPTION 'take_writing_tools: unknown tool in %', p_tools;
  END IF;
  IF (SELECT count(DISTINCT t) FROM unnest(p_tools) t) <> cardinality(p_tools) THEN
    RAISE EXCEPTION 'take_writing_tools: a tool is named twice';
  END IF;
  IF p_per_day IS NULL OR p_per_day < 1 OR p_per_day > 100 THEN
    RAISE EXCEPTION 'take_writing_tools: per_day % is outside 1..100', p_per_day;
  END IF;
  IF p_per_month IS NOT NULL AND (p_per_month < 1 OR p_per_month > 3000) THEN
    RAISE EXCEPTION 'take_writing_tools: per_month % is outside 1..3000', p_per_month;
  END IF;
  IF p_tier IS NULL OR p_tier NOT IN ('free', 'pro') THEN
    RAISE EXCEPTION 'take_writing_tools: unknown tier %', p_tier;
  END IF;

  -- One account at a time: two tabs cannot both spend the last use.
  PERFORM pg_advisory_xact_lock(hashtextextended('writing_tool_uses:' || p_user_id::text, 0));

  FOREACH v_tool IN ARRAY p_tools LOOP
    SELECT count(*) FILTER (WHERE u.used_at >= v_day_start), count(*)
      INTO v_day, v_month
      FROM public.writing_tool_uses u
     WHERE u.user_id = p_user_id
       AND u.tool = v_tool
       AND u.used_at >= v_month_start;
    IF p_per_month IS NOT NULL AND v_month >= p_per_month THEN
      RETURN jsonb_build_object(
        'allowed', false, 'reason', 'monthly_limit', 'tool', v_tool,
        'limit', p_per_month, 'resets_at', v_month_end);
    END IF;
    IF v_day >= p_per_day THEN
      RETURN jsonb_build_object(
        'allowed', false, 'reason', 'daily_limit', 'tool', v_tool,
        'limit', p_per_day, 'resets_at', v_day_end);
    END IF;
  END LOOP;

  FOREACH v_tool IN ARRAY p_tools LOOP
    INSERT INTO public.writing_tool_uses (user_id, tool, tier, used_at)
    VALUES (p_user_id, v_tool, p_tier, v_now)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  DELETE FROM public.writing_tool_uses
   WHERE user_id = p_user_id
     AND used_at < v_month_start - interval '40 days';

  RETURN jsonb_build_object('allowed', true, 'use_ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.take_writing_tools(uuid, text[], integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_writing_tools(uuid, text[], integer, integer, text) TO service_role;

COMMENT ON FUNCTION public.take_writing_tools(uuid, text[], integer, integer, text) IS
  'Service-role only. Takes one use of each named writing tool for the account, all or none, under a per-account lock; refuses with daily_limit or monthly_limit and the UTC reset time. The figures come from supabase/functions/_shared/writing-allowance.ts (20261011160000).';

CREATE OR REPLACE FUNCTION public.refund_writing_tools(p_user_id uuid, p_use_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user_id IS NULL OR p_use_ids IS NULL OR cardinality(p_use_ids) = 0 THEN
    RETURN 0;
  END IF;
  DELETE FROM public.writing_tool_uses
   WHERE user_id = p_user_id
     AND id = ANY (p_use_ids)
     AND used_at > now() - interval '15 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_writing_tools(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_writing_tools(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.refund_writing_tools(uuid, uuid[]) IS
  'Service-role only. Gives back writing-tool uses the account took in the last fifteen minutes, after a call that did not deliver (20261011160000).';

-- ── self-check: the catalogue, the grants, and a refusal that writes nothing ──
DO $$
DECLARE
  v_take oid := to_regprocedure('public.take_writing_tools(uuid, text[], integer, integer, text)');
  v_refund oid := to_regprocedure('public.refund_writing_tools(uuid, uuid[])');
  v_fn oid;
  v_role text;
  v_priv text;
  v_raised boolean;
BEGIN
  IF to_regclass('public.writing_tool_uses') IS NULL THEN
    RAISE EXCEPTION '20261011160000: writing_tool_uses is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.writing_tool_uses'::regclass) THEN
    RAISE EXCEPTION '20261011160000: writing_tool_uses must have row level security on';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_role, 'public.writing_tool_uses', v_priv) THEN
        RAISE EXCEPTION '20261011160000: % holds % on writing_tool_uses', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF v_take IS NULL OR v_refund IS NULL THEN
    RAISE EXCEPTION '20261011160000: take_writing_tools or refund_writing_tools is missing';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[v_take, v_refund] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
      RAISE EXCEPTION '20261011160000: % must be SECURITY DEFINER', v_fn::regprocedure;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '20261011160000: % is executable by a client role', v_fn::regprocedure;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '20261011160000: service_role cannot execute %', v_fn::regprocedure;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = v_fn
         AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%')
    ) THEN
      RAISE EXCEPTION '20261011160000: % must set search_path', v_fn::regprocedure;
    END IF;
  END LOOP;
  -- An unknown tool is refused before anything is read or written.
  v_raised := false;
  BEGIN
    PERFORM public.take_writing_tools(gen_random_uuid(), ARRAY['essay'], 1, NULL, 'free');
  EXCEPTION WHEN raise_exception THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '20261011160000: take_writing_tools accepted an unknown tool';
  END IF;
  IF public.refund_writing_tools(gen_random_uuid(), ARRAY[gen_random_uuid()]) <> 0 THEN
    RAISE EXCEPTION '20261011160000: refund_writing_tools gave back a use no account took';
  END IF;
END
$$;
