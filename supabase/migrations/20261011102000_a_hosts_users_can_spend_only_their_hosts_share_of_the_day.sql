-- A HOST'S USERS CAN SPEND ONLY THEIR HOST'S SHARE OF THE DAY.
--
-- WHAT WAS WRONG. The MCP server's keyless allowance (mcp_anon_check,
-- 20260915100000) counted every caller against ONE global row of 2,000 a day.
-- Anthropic's outbound range carries every Messages API connector call as well
-- as claude.ai's, and an IPv6 scraper rotates addresses for free, so any one of
-- them could spend the day for every Claude and ChatGPT seeker. Nothing bounded
-- a minute either: MCP reads skip job-board's per-address budget, so a script
-- could hold as many database cores as it could send calls.
--
-- WHAT THIS ADDS (owner decision 2026-10-11, economics 1(b)). One new meter,
-- mcp_anon_check_v2, which counts ONE call against, in order:
--   1. the share's minute row     'min:<share>:<HHMI>'       (p_minute_cap)
--   2. the overall minute row     'min:global:<HHMI>'        (p_overall_minute_cap)
--   3. the caller's bucket        'ip:<p_bucket>'            (p_bucket_cap)
--   4. the host's share of the day <p_global_bucket>         (p_global_cap)
--   5. the overall day            'global'                   (p_overall_cap)
-- and is allowed only when every counter is at or under its cap after
-- counting. A counter at its cap is never incremented again (the cap sits in
-- the ON CONFLICT update's own WHERE), and a refusal at any step hands back
-- the counts the earlier steps took, so a refused call is charged to nobody.
-- A NULL p_overall_cap skips steps 2 and 5: the apply-yourself forms are a
-- pool of their own (5,000 a day at 20 a minute), outside the 20,000.
--
-- The caps are the caller's parameters, never this file's: agent-mcp's
-- ANON_ALLOWANCE is the one place they are set, so a cut is a one-constant
-- release. The share's cap is written onto its row (the new `cap` column) so
-- the 50% alert can read the figure it is measured against without a second
-- copy of the constant.
--
-- WHO PAYS IS THE CALLER'S BUSINESS ONLY THROUGH ITS ADDRESS. agent-mcp builds
-- exactly one bucket from the platform-verified address: Claude's pool,
-- a ChatGPT user (a hash of openai/subject, believed only from OpenAI's
-- published egress), ChatGPT's no-subject pool, or a 16-hex hash of the full
-- IPv4 address or IPv6 /64. This function never sees an address.
--
-- mcp_anon_refund gives one call back (bucket, share and, unless it was a
-- forms call, the overall day; never a minute row) at most p_max times a day
-- per bucket. agent-mcp calls it only for a transport failure between it and
-- job-board and for an id the board does not carry. A statement timeout is
-- never given back: the most expensive call must not be the free one.
--
-- RETENTION. Rows older than seven days go on every call (as before). The
-- first call of each minute also removes yesterday's minute rows, refund
-- counters and every per-person row (ip:u:%, ip:f:u:%), so a ChatGPT user's
-- bucket does not outlive its day.
--
-- THE ADOPTION READER reads these rows too; 20261011102100 narrows its
-- address predicates so a share, minute, refund or forms row is never read as
-- an address.
--
-- The old mcp_anon_check stays until the live agent-mcp has moved off it.
--
-- 42702: no OUT name below equals a column of mcp_anon_rate (day, bucket,
-- calls, cap), and every column is alias-qualified anyway.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, the grants
-- restated, and the self-checks write rows under their own names and remove
-- them before they end.

ALTER TABLE public.mcp_anon_rate ADD COLUMN IF NOT EXISTS cap integer;

COMMENT ON COLUMN public.mcp_anon_rate.cap IS
  'The cap the newest count on this row was measured against. Written on share rows and the overall row by mcp_anon_check_v2; NULL on every other row.';

CREATE OR REPLACE FUNCTION public.mcp_anon_check_v2(
  p_bucket text,
  p_bucket_cap integer,
  p_global_bucket text,
  p_global_cap integer,
  p_overall_cap integer DEFAULT 20000,
  p_minute_cap integer DEFAULT NULL,
  p_overall_minute_cap integer DEFAULT NULL
)
RETURNS TABLE (
  allowed boolean,
  refused_by text,
  bucket_used integer,
  bucket_cap integer,
  share_used integer,
  share_cap integer,
  overall_used integer,
  overall_cap integer,
  minute_used integer,
  minute_cap integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_hhmi text := to_char(now() AT TIME ZONE 'UTC', 'HH24MI');
  v_bucket text := 'ip:' || coalesce(nullif(btrim(p_bucket), ''), 'unknown');
  v_share text := coalesce(nullif(btrim(p_global_bucket), ''), 'global:other');
  v_min text;
  v_omin text := 'min:global:' || to_char(now() AT TIME ZONE 'UTC', 'HH24MI');
  v_counts_overall boolean := p_overall_cap IS NOT NULL;
  v_m integer;
  v_om integer;
  v_b integer;
  v_s integer;
  v_g integer;
BEGIN
  v_min := 'min:' || v_share || ':' || v_hhmi;

  DELETE FROM public.mcp_anon_rate r WHERE r.day < v_today - 7;

  IF p_bucket_cap IS NULL OR p_global_cap IS NULL OR p_bucket_cap < 1 OR p_global_cap < 1
     OR (v_counts_overall AND p_overall_cap < 1) OR v_share = 'global' OR v_share LIKE 'min:%' THEN
    RETURN QUERY SELECT false, 'cap'::text, 0, coalesce(p_bucket_cap, 0), 0, coalesce(p_global_cap, 0),
      0, coalesce(p_overall_cap, 0), 0, coalesce(p_minute_cap, 0);
    RETURN;
  END IF;

  -- 1. the share's minute.
  IF p_minute_cap IS NOT NULL THEN
    INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls)
    VALUES (v_today, v_min, 1)
    ON CONFLICT (day, bucket) DO UPDATE SET calls = r.calls + 1 WHERE r.calls < p_minute_cap
    RETURNING r.calls INTO v_m;
    IF v_m IS NULL THEN
      SELECT r.calls INTO v_m FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_min;
      SELECT r.calls INTO v_b FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_bucket;
      SELECT r.calls INTO v_s FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_share;
      SELECT r.calls INTO v_g FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = 'global';
      RETURN QUERY SELECT false, 'minute'::text, coalesce(v_b, 0), p_bucket_cap, coalesce(v_s, 0), p_global_cap,
        coalesce(v_g, 0), coalesce(p_overall_cap, 0), coalesce(v_m, 0), p_minute_cap;
      RETURN;
    END IF;
  END IF;

  -- 2. every keyless caller's minute, for the pools inside the overall day.
  IF v_counts_overall AND p_overall_minute_cap IS NOT NULL THEN
    INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls)
    VALUES (v_today, v_omin, 1)
    ON CONFLICT (day, bucket) DO UPDATE SET calls = r.calls + 1 WHERE r.calls < p_overall_minute_cap
    RETURNING r.calls INTO v_om;
    IF v_om IS NULL THEN
      IF v_m IS NOT NULL THEN
        UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_min;
        v_m := greatest(v_m - 1, 0);
      END IF;
      SELECT r.calls INTO v_om FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_omin;
      SELECT r.calls INTO v_b FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_bucket;
      SELECT r.calls INTO v_s FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_share;
      SELECT r.calls INTO v_g FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = 'global';
      RETURN QUERY SELECT false, 'overall_minute'::text, coalesce(v_b, 0), p_bucket_cap, coalesce(v_s, 0), p_global_cap,
        coalesce(v_g, 0), p_overall_cap, coalesce(v_om, 0), p_overall_minute_cap;
      RETURN;
    END IF;
    -- The first call of a minute sweeps what must not outlive its day.
    IF v_om = 1 THEN
      DELETE FROM public.mcp_anon_rate r
       WHERE r.day < v_today
         AND (r.bucket LIKE 'min:%' OR r.bucket LIKE 'refund:%' OR r.bucket LIKE 'ip:u:%' OR r.bucket LIKE 'ip:f:u:%');
    END IF;
  END IF;

  -- 3. the caller's own bucket.
  INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls)
  VALUES (v_today, v_bucket, 1)
  ON CONFLICT (day, bucket) DO UPDATE SET calls = r.calls + 1 WHERE r.calls < p_bucket_cap
  RETURNING r.calls INTO v_b;
  IF v_b IS NULL THEN
    IF v_m IS NOT NULL THEN
      UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_min;
    END IF;
    IF v_om IS NOT NULL THEN
      UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_omin;
    END IF;
    SELECT r.calls INTO v_b FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_bucket;
    SELECT r.calls INTO v_s FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_share;
    SELECT r.calls INTO v_g FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = 'global';
    RETURN QUERY SELECT false, 'bucket'::text, coalesce(v_b, 0), p_bucket_cap, coalesce(v_s, 0), p_global_cap,
      coalesce(v_g, 0), coalesce(p_overall_cap, 0), greatest(coalesce(v_m, 0) - 1, 0), coalesce(p_minute_cap, 0);
    RETURN;
  END IF;

  -- 4. the host's share of the day, with its cap written beside it.
  INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls, cap)
  VALUES (v_today, v_share, 1, p_global_cap)
  ON CONFLICT (day, bucket) DO UPDATE SET calls = r.calls + 1, cap = excluded.cap WHERE r.calls < p_global_cap
  RETURNING r.calls INTO v_s;
  IF v_s IS NULL THEN
    UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_bucket;
    IF v_m IS NOT NULL THEN
      UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_min;
    END IF;
    IF v_om IS NOT NULL THEN
      UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_omin;
    END IF;
    SELECT r.calls INTO v_s FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_share;
    SELECT r.calls INTO v_g FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = 'global';
    RETURN QUERY SELECT false, 'share'::text, greatest(v_b - 1, 0), p_bucket_cap, coalesce(v_s, 0), p_global_cap,
      coalesce(v_g, 0), coalesce(p_overall_cap, 0), greatest(coalesce(v_m, 0) - 1, 0), coalesce(p_minute_cap, 0);
    RETURN;
  END IF;

  -- 5. the overall day.
  IF v_counts_overall THEN
    INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls, cap)
    VALUES (v_today, 'global', 1, p_overall_cap)
    ON CONFLICT (day, bucket) DO UPDATE SET calls = r.calls + 1, cap = excluded.cap WHERE r.calls < p_overall_cap
    RETURNING r.calls INTO v_g;
    IF v_g IS NULL THEN
      UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_share;
      UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_bucket;
      IF v_m IS NOT NULL THEN
        UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_min;
      END IF;
      IF v_om IS NOT NULL THEN
        UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_omin;
      END IF;
      SELECT r.calls INTO v_g FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = 'global';
      RETURN QUERY SELECT false, 'overall'::text, greatest(v_b - 1, 0), p_bucket_cap, greatest(v_s - 1, 0), p_global_cap,
        coalesce(v_g, 0), p_overall_cap, greatest(coalesce(v_m, 0) - 1, 0), coalesce(p_minute_cap, 0);
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, NULL::text, v_b, p_bucket_cap, v_s, p_global_cap,
    coalesce(v_g, 0), coalesce(p_overall_cap, 0), coalesce(v_m, 0), coalesce(p_minute_cap, 0);
END;
$$;

COMMENT ON FUNCTION public.mcp_anon_check_v2(text, integer, text, integer, integer, integer, integer) IS
  'Counts one keyless MCP call against its share''s minute, the overall minute, the caller''s bucket, the host''s share of the day and the overall day (the last two minute and day steps skipped when p_overall_cap is NULL), and says whether it is allowed and which counter refused. A counter at its cap is never incremented; a refusal hands back what the earlier steps took. Service-role only.';

REVOKE ALL ON FUNCTION public.mcp_anon_check_v2(text, integer, text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_anon_check_v2(text, integer, text, integer, integer, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_anon_refund(
  p_bucket text,
  p_global_bucket text,
  p_overall boolean,
  p_max integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_bucket text := 'ip:' || coalesce(nullif(btrim(p_bucket), ''), 'unknown');
  v_share text := coalesce(nullif(btrim(p_global_bucket), ''), 'global:other');
  v_n integer;
BEGIN
  IF p_max IS NULL OR p_max < 1 OR v_share = 'global' THEN
    RETURN false;
  END IF;
  -- Only a call that was counted can be given back.
  IF NOT EXISTS (SELECT 1 FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = v_bucket AND r.calls > 0) THEN
    RETURN false;
  END IF;
  INSERT INTO public.mcp_anon_rate AS r (day, bucket, calls)
  VALUES (v_today, 'refund:' || v_bucket, 1)
  ON CONFLICT (day, bucket) DO UPDATE SET calls = r.calls + 1 WHERE r.calls < p_max
  RETURNING r.calls INTO v_n;
  IF v_n IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_bucket;
  UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = v_share;
  IF p_overall THEN
    UPDATE public.mcp_anon_rate r SET calls = greatest(r.calls - 1, 0) WHERE r.day = v_today AND r.bucket = 'global';
  END IF;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.mcp_anon_refund(text, text, boolean, integer) IS
  'Gives one counted keyless call back to its bucket, its share and (p_overall) the overall day, never a minute row, at most p_max times a UTC day per bucket. For transport failures and unknown ids only; a timeout is never given back. Service-role only.';

REVOKE ALL ON FUNCTION public.mcp_anon_refund(text, text, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_anon_refund(text, text, boolean, integer) TO service_role;

-- SELF-CHECK: the meter and the refund exist, are closed to the client roles
-- and open to the service role; one call counts once on every counter it
-- names; a full minute refuses and gives back; a refund gives back once and
-- then stops at its daily limit. Every row it writes is under a self-check
-- name, removed before it ends.
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_sig text;
  v_r record;
  v_ok boolean;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.mcp_anon_check_v2(text, integer, text, integer, integer, integer, integer)',
    'public.mcp_anon_refund(text, text, boolean, integer)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'self-check: % was not created', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: a client role can run %', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: the service role cannot run %', v_sig;
    END IF;
  END LOOP;

  -- The forms shape (no overall day, no overall minute), so nothing real moves.
  SELECT * INTO v_r FROM public.mcp_anon_check_v2('zz-selfcheck-20261011102000', 2, 'global:zz-selfcheck-20261011102000', 5, NULL, 1, NULL);
  IF NOT v_r.allowed OR v_r.bucket_used <> 1 OR v_r.share_used <> 1 OR v_r.minute_used <> 1 THEN
    RAISE EXCEPTION 'self-check: one call did not count once on each counter (%)', row_to_json(v_r);
  END IF;
  -- A bucket cap of one as well, so a minute that turns between the two calls
  -- still refuses (by the bucket) and the check cannot pass by luck.
  SELECT * INTO v_r FROM public.mcp_anon_check_v2('zz-selfcheck-20261011102000', 1, 'global:zz-selfcheck-20261011102000', 5, NULL, 1, NULL);
  IF v_r.allowed OR v_r.refused_by NOT IN ('minute', 'bucket') OR v_r.bucket_used <> 1 OR v_r.share_used <> 1 THEN
    RAISE EXCEPTION 'self-check: a full minute did not refuse cleanly (%)', row_to_json(v_r);
  END IF;
  v_ok := public.mcp_anon_refund('zz-selfcheck-20261011102000', 'global:zz-selfcheck-20261011102000', false, 1);
  IF NOT v_ok OR (SELECT r.calls FROM public.mcp_anon_rate r WHERE r.day = v_today AND r.bucket = 'ip:zz-selfcheck-20261011102000') <> 0 THEN
    RAISE EXCEPTION 'self-check: a refund did not give the call back';
  END IF;
  IF public.mcp_anon_refund('zz-selfcheck-20261011102000', 'global:zz-selfcheck-20261011102000', false, 1) THEN
    RAISE EXCEPTION 'self-check: a refund past its daily limit was given';
  END IF;

  DELETE FROM public.mcp_anon_rate r
   WHERE r.day = v_today AND r.bucket LIKE '%zz-selfcheck-20261011102000%';
END
$$;
