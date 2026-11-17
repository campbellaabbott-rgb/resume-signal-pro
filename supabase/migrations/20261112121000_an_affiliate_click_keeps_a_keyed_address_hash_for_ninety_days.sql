-- lovable-cron-fallback-reviewed: no sub-hourly cron; every job this file schedules runs once a day (reviewed 2026-11-16 in the bug round A integration).
--
-- AN AFFILIATE CLICK KEEPS A KEYED ADDRESS HASH FOR NINETY DAYS
-- (bug round 2026-11-08, lane affiliate: S14X-021, owner decision
-- 2026-11-15 "approved-full").
--
-- WHAT WAS WRONG. track_affiliate_click stored md5('affiliate-click:' ||
-- address): every IPv4 address hashes in seconds, so the column was a list of
-- the visitors' addresses under a thin coat. With no platform address it
-- stored whatever the browser sent as p_ip_hash, and the browser sent a
-- fingerprint of the visitor's agent, language, screen and time zone. Nothing
-- ever deleted a click. An affiliate could neither download nor erase what
-- the program holds about them.
--
-- WHAT THIS CHANGES.
--   1. track_affiliate_click (the same signature and budget) stores
--      affiliate_keyed_hash('click', address): an HMAC under a key no role
--      can read (20261112120000). p_ip_hash is accepted and ignored, so a
--      page still sending it keeps working. Rows already written are
--      re-keyed: a stored value becomes the keyed hash of 'legacy:' || value,
--      so no md5 of an address survives and one visitor still counts once.
--   2. affiliate_click_days (affiliate, UTC day, clicks, visitors) holds the
--      count of each day whose clicks are gone. affiliate_clicks_roll_up_and_prune
--      moves every click older than the window (90 days; it refuses less than
--      30) into it, a whole UTC day at a time, deletes the clicks, and prunes
--      sign-in networks unseen for 90 days and spent or expired account
--      links. pg_cron runs it daily at 04:23 UTC, its statement_timeout SET
--      inside the command.
--   3. get_affiliate_clicks (the same signature) answers the live days and
--      the rolled-up ones together, so a pruned day still shows.
--   4. affiliate_export and affiliate_erase (service_role only; the
--      affiliate-account function calls them for a signed-in affiliate):
--      what the account holds (no visitor's agent, page or hash), and an
--      erase that turns the address into a hash, clears the password, ends
--      every session and deletes the account's clicks, links and networks.
--      Conversions and payout requests stay: they are the record of money
--      owed and paid.
--
-- Depends on: 20261112120000 (affiliate_keyed_hash, affiliate_session_owner,
-- affiliate_sign_in_networks, affiliate_account_links), affiliate_clicks
-- (20251221233709), client_write_allowed and request_client_address
-- (20261004110000), pg_cron where installed. Safe to re-run. Verify:
-- src/test/an-affiliate-click-keeps-a-keyed-address-hash-for-ninety-days.test.ts
-- runs this file twice in pglite from Supabase's default grants; the DO block
-- at the end checks the catalogue and the hash and the prune inside a
-- rolled-back block.

SET LOCAL statement_timeout = '2min';

-- ── 1. the click stores a keyed hash ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.track_affiliate_click(
  p_referral_code TEXT,
  p_ip_hash TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_referrer TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID;
  v_addr text := public.request_client_address();
BEGIN
  IF p_referral_code IS NULL OR length(p_referral_code) > 32 THEN
    RETURN FALSE;
  END IF;
  SELECT id INTO v_affiliate_id
  FROM affiliates
  WHERE referral_code = p_referral_code
    AND status = 'active';
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- Three clicks a day per address per code, five hundred a day per code.
  IF NOT public.client_write_allowed('affiliate-click:' || p_referral_code, 3, 500, 1440) THEN
    RETURN FALSE;
  END IF;
  -- The platform's address, keyed; never a value the browser chose
  -- (p_ip_hash stays in the signature so an older page keeps working).
  INSERT INTO affiliate_clicks (affiliate_id, ip_hash, user_agent, referrer)
  VALUES (
    v_affiliate_id,
    public.affiliate_keyed_hash('click', v_addr),
    left(p_user_agent, 200),
    left(p_referrer, 500)
  );
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.track_affiliate_click(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_affiliate_click(text, text, text, text) TO anon, authenticated, service_role;

-- Re-key what the old function wrote (an md5, or the browser's value): only
-- rows that are not already a 64-hex keyed hash, so a re-run moves nothing.
UPDATE public.affiliate_clicks
   SET ip_hash = public.affiliate_keyed_hash('click', 'legacy:' || ip_hash)
 WHERE ip_hash IS NOT NULL AND ip_hash !~ '^[0-9a-f]{64}$';

REVOKE ALL ON TABLE public.affiliate_clicks FROM anon, authenticated;

-- ── 2. ninety days, then a count per day ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.affiliate_click_days (
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  day date NOT NULL,
  clicks integer NOT NULL CHECK (clicks >= 0),
  visitors integer NOT NULL CHECK (visitors >= 0),
  PRIMARY KEY (affiliate_id, day)
);
ALTER TABLE public.affiliate_click_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.affiliate_click_days FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.affiliate_click_days TO service_role;
COMMENT ON TABLE public.affiliate_click_days IS
  'Clicks and distinct visitors per affiliate per UTC day, for days whose clicks the 90-day prune deleted. No address, '
  'agent or page. service_role reads it; the dashboard and get_affiliate_clicks read it as their owner. 20261112121000.';

CREATE OR REPLACE FUNCTION public.affiliate_clicks_roll_up_and_prune(p_keep_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cut timestamptz;
  v_moved integer;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 30 OR p_keep_days > 3650 THEN
    RAISE EXCEPTION 'affiliate_clicks_roll_up_and_prune: keep % days? at least 30', p_keep_days USING ERRCODE = '22023';
  END IF;
  -- A whole UTC day at a time, so a day is never split between the two tables.
  v_cut := (date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => p_keep_days)) AT TIME ZONE 'UTC';
  WITH gone AS (
    DELETE FROM public.affiliate_clicks c
     WHERE c.created_at < v_cut
    RETURNING c.affiliate_id, (c.created_at AT TIME ZONE 'UTC')::date AS day,
              COALESCE(c.ip_hash, c.referrer, c.user_agent, 'unknown') AS visitor
  ), days AS (
    SELECT affiliate_id, day, count(*)::integer AS clicks, count(DISTINCT visitor)::integer AS visitors
      FROM gone GROUP BY affiliate_id, day
  ), put AS (
    INSERT INTO public.affiliate_click_days AS d (affiliate_id, day, clicks, visitors)
    SELECT affiliate_id, day, clicks, visitors FROM days
    ON CONFLICT (affiliate_id, day) DO UPDATE
      SET clicks = d.clicks + excluded.clicks, visitors = d.visitors + excluded.visitors
    RETURNING d.clicks
  )
  SELECT coalesce(sum(clicks), 0)::integer INTO v_moved FROM days;
  DELETE FROM public.affiliate_sign_in_networks WHERE last_seen < now() - interval '90 days';
  DELETE FROM public.affiliate_account_links WHERE used_at IS NOT NULL OR expires_at < now() - interval '1 day';
  RETURN v_moved;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_clicks_roll_up_and_prune(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_clicks_roll_up_and_prune(integer) TO service_role;
COMMENT ON FUNCTION public.affiliate_clicks_roll_up_and_prune(integer) IS
  'Moves every affiliate click older than p_keep_days (default 90, at least 30) into affiliate_click_days a whole UTC day '
  'at a time and deletes it; prunes sign-in networks unseen for 90 days and spent or expired account links. Daily from '
  'pg_cron (affiliate-clicks-prune). 20261112121000.';

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed here: the affiliate-clicks-prune job is not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-clicks-prune') THEN
    PERFORM cron.unschedule('affiliate-clicks-prune');
  END IF;
  PERFORM cron.schedule('affiliate-clicks-prune', '23 4 * * *',
    $c$SET statement_timeout = '2min'; SELECT public.affiliate_clicks_roll_up_and_prune(90);$c$);
END $$;

-- ── 3. the history reads the rolled-up days too ────────────────────────────

CREATE OR REPLACE FUNCTION public.get_affiliate_clicks(p_session_token text, p_days_back integer DEFAULT 30)
RETURNS TABLE(click_date date, click_count bigint, unique_referrers bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID := public.affiliate_session_owner(p_session_token);
  v_from timestamptz;
BEGIN
  IF v_affiliate_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  v_from := now() - make_interval(days => least(greatest(coalesce(p_days_back, 30), 1), 400));
  RETURN QUERY
  SELECT x.click_date, sum(x.click_count)::bigint, sum(x.unique_referrers)::bigint
    FROM (
      SELECT (c.created_at AT TIME ZONE 'UTC')::date AS click_date,
             count(*)::bigint AS click_count,
             count(DISTINCT COALESCE(c.ip_hash, c.referrer, c.user_agent, 'unknown'))::bigint AS unique_referrers
        FROM affiliate_clicks c
       WHERE c.affiliate_id = v_affiliate_id AND c.created_at > v_from
       GROUP BY 1
      UNION ALL
      SELECT d.day, d.clicks::bigint, d.visitors::bigint
        FROM affiliate_click_days d
       WHERE d.affiliate_id = v_affiliate_id AND d.day >= (v_from AT TIME ZONE 'UTC')::date
    ) x
   GROUP BY x.click_date
   ORDER BY x.click_date DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_affiliate_clicks(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_clicks(text, integer) TO anon, authenticated, service_role;

-- ── 4. an affiliate's own data: download and erase ─────────────────────────

CREATE OR REPLACE FUNCTION public.affiliate_export(p_affiliate_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'account', jsonb_build_object(
      'email', a.email, 'referral_code', a.referral_code, 'status', a.status,
      'commission_amount_cents', a.commission_amount, 'created_at', a.created_at,
      'email_confirmed_at', a.email_confirmed_at),
    'sessions', (SELECT coalesce(jsonb_agg(jsonb_build_object('created_at', s.created_at, 'expires_at', s.expires_at)
                   ORDER BY s.created_at), '[]'::jsonb)
                   FROM public.affiliate_sessions s WHERE s.affiliate_id = a.id),
    'conversions', (SELECT coalesce(jsonb_agg(to_jsonb(c) - 'affiliate_id' - 'stripe_session_id' ORDER BY c.created_at), '[]'::jsonb)
                      FROM public.affiliate_conversions c WHERE c.affiliate_id = a.id),
    'payout_requests', (SELECT coalesce(jsonb_agg(to_jsonb(r) - 'affiliate_id' ORDER BY r.requested_at), '[]'::jsonb)
                          FROM public.affiliate_payout_requests r WHERE r.affiliate_id = a.id),
    'clicks_per_day', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'clicks', x.clicks) ORDER BY x.day), '[]'::jsonb)
                         FROM (SELECT day, sum(n)::integer AS clicks FROM (
                                 SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
                                   FROM public.affiliate_clicks c WHERE c.affiliate_id = a.id GROUP BY 1
                                 UNION ALL
                                 SELECT d.day, d.clicks FROM public.affiliate_click_days d WHERE d.affiliate_id = a.id) y
                               GROUP BY day) x),
    'exported_at', now())
    FROM public.affiliates a
   WHERE a.id = p_affiliate_id;
$$;
REVOKE ALL ON FUNCTION public.affiliate_export(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_export(uuid) TO service_role;
COMMENT ON FUNCTION public.affiliate_export(uuid) IS
  'What the affiliate program holds about one affiliate: the account, session dates, conversions, payout requests and clicks '
  'per day. No visitor''s agent, page or hash, no buyer''s checkout id, and no session hash. service_role only '
  '(affiliate-account, after the '
  'session check). 20261112121000.';

CREATE OR REPLACE FUNCTION public.affiliate_erase(p_affiliate_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.affiliates
     SET email = 'erased-' || encode(extensions.digest(lower(btrim(email)), 'sha256'), 'hex') || '@erased.invalid',
         password_hash = 'erased',
         status = 'paused',
         email_confirmed_at = NULL,
         updated_at = now()
   WHERE id = p_affiliate_id
     AND email NOT LIKE 'erased-%@erased.invalid';
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.affiliate_sessions WHERE affiliate_id = p_affiliate_id;
  DELETE FROM public.affiliate_account_links WHERE affiliate_id = p_affiliate_id;
  DELETE FROM public.affiliate_sign_in_networks WHERE affiliate_id = p_affiliate_id;
  DELETE FROM public.affiliate_clicks WHERE affiliate_id = p_affiliate_id;
  DELETE FROM public.affiliate_click_days WHERE affiliate_id = p_affiliate_id;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_erase(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_erase(uuid) TO service_role;
COMMENT ON FUNCTION public.affiliate_erase(uuid) IS
  'Erases an affiliate account: the address becomes a hash, the password is cleared, the account is paused, and its '
  'sessions, links, sign-in networks and clicks are deleted. Conversions and payout requests stay as the record of money '
  'owed and paid. service_role only (affiliate-account, after the session check). 20261112121000.';

CREATE OR REPLACE FUNCTION public.affiliate_sign_out_everywhere(p_affiliate_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.affiliate_sessions WHERE affiliate_id = p_affiliate_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_sign_out_everywhere(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_sign_out_everywhere(uuid) TO service_role;

-- Self-verifying: the catalogue, then inside a rolled-back block a click
-- stores neither the md5 of its address nor the browser's value, and a
-- 100-day-old click leaves the table while its day is counted.
DO $$
DECLARE
  f text;
  v_code text;
  v_aff uuid;
  v_hash text;
  v_n integer;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.affiliate_clicks_roll_up_and_prune(integer)', 'public.affiliate_export(uuid)',
                           'public.affiliate_erase(uuid)', 'public.affiliate_sign_out_everywhere(uuid)'] LOOP
    IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION 'self-check: % is missing', f; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('anon', 'public.track_affiliate_click(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.get_affiliate_clicks(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: the click writer and the history must stay open to anon';
  END IF;
  IF has_table_privilege('anon', 'public.affiliate_click_days', 'SELECT') OR has_table_privilege('authenticated', 'public.affiliate_click_days', 'SELECT')
     OR has_table_privilege('anon', 'public.affiliate_clicks', 'SELECT') THEN
    RAISE EXCEPTION 'self-check: a client role can read the clicks or their day counts';
  END IF;
  IF EXISTS (SELECT 1 FROM public.affiliate_clicks WHERE ip_hash IS NOT NULL AND ip_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'self-check: a click still holds an unkeyed hash';
  END IF;
  -- Nested: a condition naming cron.job is planned whole, so it may not
  -- share an IF with the test for the schema.
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-clicks-prune'
                      AND command LIKE 'SET statement_timeout = %; SELECT public.affiliate_clicks_roll_up_and_prune(90);') THEN
      RAISE EXCEPTION 'self-check: the affiliate-clicks-prune job is missing or has no statement_timeout in its command';
    END IF;
  END IF;

  BEGIN
    BEGIN
      INSERT INTO public.affiliates (email, password_hash, referral_code)
      VALUES ('affiliate-click-selfcheck@example.invalid', 'x', 'selfcheck-clk') RETURNING id INTO v_aff;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'self-check: the probe account could not be written (%); the behaviour probe is skipped', SQLERRM;
      RETURN;
    END;
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"192.0.2.202"}', true);
    PERFORM public.track_affiliate_click('selfcheck-clk', 'browser-chosen', 'agent', NULL);
    SELECT ip_hash INTO v_hash FROM public.affiliate_clicks WHERE affiliate_id = v_aff;
    IF v_hash IS NULL OR v_hash = md5('affiliate-click:192.0.2.202') OR v_hash = 'browser-chosen' OR v_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'self-check: a click stored % for its address', coalesce(v_hash, 'NULL');
    END IF;
    INSERT INTO public.affiliate_clicks (affiliate_id, ip_hash, created_at) VALUES (v_aff, 'old', now() - interval '100 days');
    PERFORM public.affiliate_clicks_roll_up_and_prune(90);
    SELECT count(*) INTO v_n FROM public.affiliate_clicks WHERE affiliate_id = v_aff;
    IF v_n <> 1 THEN RAISE EXCEPTION 'self-check: % clicks left after the prune, want 1', v_n; END IF;
    SELECT coalesce(sum(clicks), 0) INTO v_n FROM public.affiliate_click_days WHERE affiliate_id = v_aff;
    IF v_n <> 1 THEN RAISE EXCEPTION 'self-check: % rolled-up clicks, want 1', v_n; END IF;
    RAISE EXCEPTION 'affiliate-click-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'affiliate-click-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;
