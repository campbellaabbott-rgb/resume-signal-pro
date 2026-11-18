-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- AN AFFILIATE SIGNS IN WITH A HASHED SESSION AND A PROVEN ADDRESS
-- (bug round 2026-11-08, lane affiliate: S14X-092, S14X-093, S14X-115, and
-- the sign-in half of RC-S13-063).
--
-- WHAT WAS WRONG.
--   S14X-093. affiliate_sessions kept each bearer token as itself, so a
--     reader of that table held a live sign-in for every affiliate. A
--     session outlived its account: pausing or banning an affiliate, or
--     changing the password, left every token open, and
--     get_affiliate_dashboard never looked at the account's status.
--   S14X-092. login_affiliate charged twenty attempts an hour against each
--     EMAIL from every address together, and charged the right password
--     too: a stranger's twenty guesses locked the affiliate out, hourly.
--     register_affiliate allowed fifty sign-ups a day for the whole site, so
--     one script closed the program to everyone each morning.
--   S14X-115. There was no way back in after a forgotten password, and no
--     account ever proved it owned the address it typed.
--   RC-S13-063. Nothing recorded the networks an affiliate signs in from, so
--     a purchase made with their own code from their own connection, under a
--     second address, read as a stranger's.
--
-- WHAT THIS CHANGES.
--   1. Two hashing keys in public.affiliate_hash_keys (one per purpose, 32
--      random bytes, no role but the owner can read the table) and
--      affiliate_keyed_hash(purpose, value), an HMAC-SHA256 under that key.
--      affiliate_network_key(address): the keyed hash of the address's /24
--      (IPv4, an IPv4-mapped address included) or /48 (IPv6), never the
--      address; service_role only, so the checkout side can record the same
--      key for a buyer. affiliate_sign_in_networks holds (affiliate, key,
--      first and last seen); register and login note it.
--   2. affiliate_sessions.token_hash (sha256 hex). Every token already
--      issued is hashed in place and its plaintext cleared, so signed-in
--      affiliates stay signed in. register and login mint the token in the
--      function, store only its hash and hand the token back once.
--      affiliate_session_owner(token) is the one lookup: an unexpired
--      session of an ACTIVE account. A trigger deletes every session of an
--      account whose status leaves 'active' or whose password changes.
--   3. affiliates.email_confirmed_at, and affiliate_account_links: single-use
--      links for a password reset, an address confirmation and an address
--      change, stored as sha256 hex, thirty minutes each, a new one retiring
--      the last. affiliate_link_mint and affiliate_link_use are service_role
--      only (the affiliate-account function calls them); a reset sets the
--      password, ends every session, clears the failed-sign-in count and
--      proves the address.
--   4. client_write_budget_left: reads a write budget without charging it.
--      login_affiliate keeps the per-address attempt budget (20 an hour) and
--      charges FAILED attempts only, 10 an hour from one address against one
--      email and 200 an hour against it from all addresses, read before the
--      password is checked. register_affiliate allows 10 sign-ups a day per
--      network under a ceiling of 1000 for the site.
--   5. logout_affiliate, get_affiliate_dashboard, get_affiliate_clicks and
--      get_affiliate_stats_by_date read the session through the owner
--      lookup. Every signature, default and return type is unchanged, so no
--      client-callable function is added or dropped and the census stands;
--      the dashboard gains affiliate.email_confirmed and login answers
--      email_confirmed beside what it always answered.
--   Nothing after a budget RAISEs (20261004110000's rule): a refusal is
--   {success: false, error}.
--
-- Depends on: affiliates, affiliate_sessions, affiliate_clicks,
-- affiliate_conversions (20251221233709), request_client_address,
-- client_write_budget, client_write_allowed (20261004110000), pgcrypto in the
-- extensions schema. Safe to re-run. Verify:
-- src/test/an-affiliate-session-is-stored-hashed-and-ends-with-the-account.test.ts,
-- src/test/a-stranger-cannot-lock-an-affiliate-out-or-close-sign-up.test.ts and
-- src/test/an-affiliate-resets-a-password-by-mail-and-proves-the-address.test.ts
-- run this file twice in pglite from Supabase's default grants; the DO block
-- at the end checks the catalogue and the sign-in rules inside a rolled-back
-- block.

SET LOCAL statement_timeout = '2min';

-- ── 1. keyed hashes ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.affiliate_hash_keys (
  purpose text PRIMARY KEY CHECK (purpose IN ('click', 'network')),
  hash_key bytea NOT NULL CHECK (octet_length(hash_key) >= 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.affiliate_hash_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.affiliate_hash_keys FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.affiliate_hash_keys (purpose, hash_key)
SELECT p, extensions.gen_random_bytes(32) FROM unnest(ARRAY['click', 'network']) AS p
ON CONFLICT (purpose) DO NOTHING;
COMMENT ON TABLE public.affiliate_hash_keys IS
  'The HMAC keys behind affiliate_keyed_hash: one per purpose, 32 random bytes. No client role and not the service role '
  'can read it; only the definer functions of 20261112120000 use it. 20261112120000.';

CREATE OR REPLACE FUNCTION public.affiliate_keyed_hash(p_purpose text, p_value text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL
         ELSE encode(extensions.hmac(convert_to(p_value, 'UTF8'), k.hash_key, 'sha256'), 'hex') END
    FROM public.affiliate_hash_keys k
   WHERE k.purpose = p_purpose;
$$;
REVOKE ALL ON FUNCTION public.affiliate_keyed_hash(text, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.affiliate_keyed_hash(text, text) IS
  'HMAC-SHA256 (hex) of a value under affiliate_hash_keys'' key for the purpose. Invoker, and no role is granted it: only '
  'the affiliate definers (as their owner) call it. 20261112120000.';

CREATE OR REPLACE FUNCTION public.affiliate_network_key(p_addr text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v inet;
  v_host text;
BEGIN
  IF p_addr IS NULL OR btrim(p_addr) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v := btrim(p_addr)::inet;
  EXCEPTION WHEN others THEN
    RETURN public.affiliate_keyed_hash('network', 'raw:' || left(lower(btrim(p_addr)), 64));
  END;
  v_host := host(v);
  -- An IPv4 address written inside IPv6 is the IPv4 address.
  IF family(v) = 6 AND v_host ~* '^::ffff:[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$' THEN
    v := substring(v_host FROM 8)::inet;
  END IF;
  RETURN public.affiliate_keyed_hash('network',
    CASE WHEN family(v) = 4 THEN network(set_masklen(v, 24))::text ELSE network(set_masklen(v, 48))::text END);
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_network_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_network_key(text) TO service_role;
COMMENT ON FUNCTION public.affiliate_network_key(text) IS
  'The keyed hash of an address''s network: its /24 for IPv4 (an IPv4-mapped address included), its /48 for IPv6. Never the '
  'address. Sign-ins and checkouts record it so a sale from the affiliate''s own network can be flagged. service_role only. '
  '20261112120000.';

CREATE TABLE IF NOT EXISTS public.affiliate_sign_in_networks (
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  network_key text NOT NULL CHECK (network_key ~ '^[0-9a-f]{64}$'),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (affiliate_id, network_key)
);
CREATE INDEX IF NOT EXISTS affiliate_sign_in_networks_key_idx ON public.affiliate_sign_in_networks (network_key, last_seen);
ALTER TABLE public.affiliate_sign_in_networks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.affiliate_sign_in_networks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.affiliate_sign_in_networks TO service_role;
COMMENT ON TABLE public.affiliate_sign_in_networks IS
  'The networks (affiliate_network_key) each affiliate signed in from, first and last seen. Pruned 90 days after last seen. '
  'service_role reads it; nothing else. 20261112120000.';

-- Called inside register and login, after their budgets: never raises.
CREATE OR REPLACE FUNCTION public.affiliate_note_network(p_affiliate_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := public.affiliate_network_key(public.request_client_address());
  IF v_key IS NULL OR p_affiliate_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.affiliate_sign_in_networks AS n (affiliate_id, network_key)
  VALUES (p_affiliate_id, v_key)
  ON CONFLICT (affiliate_id, network_key) DO UPDATE SET last_seen = now();
EXCEPTION WHEN others THEN
  RAISE NOTICE 'affiliate_note_network: not noted (%)', SQLERRM;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_note_network(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. hashed sessions that end with the account ───────────────────────────

ALTER TABLE public.affiliate_sessions ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE public.affiliate_sessions ALTER COLUMN session_token DROP DEFAULT;
ALTER TABLE public.affiliate_sessions ALTER COLUMN session_token DROP NOT NULL;
UPDATE public.affiliate_sessions
   SET token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex'),
       session_token = NULL
 WHERE session_token IS NOT NULL;
DELETE FROM public.affiliate_sessions WHERE token_hash IS NULL OR expires_at < now() - interval '1 day';
ALTER TABLE public.affiliate_sessions ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_sessions_token_hash_key ON public.affiliate_sessions (token_hash);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.affiliate_sessions'::regclass
                  AND conname = 'affiliate_sessions_hash_only') THEN
    ALTER TABLE public.affiliate_sessions
      ADD CONSTRAINT affiliate_sessions_hash_only CHECK (session_token IS NULL AND token_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;
-- Sessions are read through the definers below, never by a client role.
REVOKE ALL ON TABLE public.affiliate_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.affiliate_sessions TO service_role;
COMMENT ON COLUMN public.affiliate_sessions.token_hash IS
  'sha256 hex of the session token, which is handed to the affiliate once and stored nowhere. 20261112120000.';

CREATE OR REPLACE FUNCTION public.affiliate_session_owner(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.affiliate_id
    FROM public.affiliate_sessions s
    JOIN public.affiliates a ON a.id = s.affiliate_id
   WHERE p_token ~ '^[0-9a-f]{32,128}$'
     AND s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     AND s.expires_at > now()
     AND a.status = 'active'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.affiliate_session_owner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_session_owner(text) TO service_role;
COMMENT ON FUNCTION public.affiliate_session_owner(text) IS
  'The affiliate an unexpired session token belongs to, when that account is active; NULL otherwise. Compares the token''s '
  'sha256. service_role only (affiliate-account, affiliate-payout-request); the anon readers call it as their owner. '
  '20261112120000.';

CREATE OR REPLACE FUNCTION public.affiliate_sessions_end_with_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'active' OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    DELETE FROM public.affiliate_sessions WHERE affiliate_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_sessions_end_with_account() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS affiliate_sessions_end_with_account ON public.affiliates;
CREATE TRIGGER affiliate_sessions_end_with_account
  AFTER UPDATE OF status, password_hash ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_sessions_end_with_account();

-- ── 3. a proven address, and single-use links ──────────────────────────────

ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
COMMENT ON COLUMN public.affiliates.email_confirmed_at IS
  'When the affiliate proved the address by a mailed link (a confirmation, a reset or an address change). NULL: unproven; '
  'an unproven account''s commissions are flagged for review and it cannot ask to be paid. 20261112120000.';

CREATE TABLE IF NOT EXISTS public.affiliate_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('reset', 'confirm', 'email')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  new_email text CHECK (new_email IS NULL OR length(new_email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS affiliate_account_links_affiliate_idx ON public.affiliate_account_links (affiliate_id, purpose);
ALTER TABLE public.affiliate_account_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.affiliate_account_links FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.affiliate_account_links IS
  'Single-use, 30-minute links mailed to an affiliate: a password reset, an address confirmation, an address change. Only '
  'the sha256 of the link''s token is stored. Read and written only by affiliate_link_mint and affiliate_link_use. '
  '20261112120000.';

-- A new link for (account, purpose). By id for a signed-in affiliate, by
-- address for a reset. NULL when there is no active account, or when the new
-- address is malformed or already an affiliate's: the caller answers the same
-- either way, so an address cannot be tested through it.
CREATE OR REPLACE FUNCTION public.affiliate_link_mint(
  p_purpose text,
  p_affiliate_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_new_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_to text;
  v_token text;
BEGIN
  IF p_purpose IS NULL OR p_purpose NOT IN ('reset', 'confirm', 'email') THEN
    RAISE EXCEPTION 'affiliate_link_mint: not a purpose: %', p_purpose USING ERRCODE = '22023';
  END IF;
  IF p_affiliate_id IS NOT NULL THEN
    SELECT a.id, a.email INTO v_id, v_email FROM public.affiliates a WHERE a.id = p_affiliate_id AND a.status = 'active';
  ELSIF p_email IS NOT NULL AND length(p_email) <= 254 THEN
    SELECT a.id, a.email INTO v_id, v_email FROM public.affiliates a WHERE a.email = lower(btrim(p_email)) AND a.status = 'active';
  END IF;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_purpose = 'email' THEN
    v_to := lower(btrim(coalesce(p_new_email, '')));
    IF length(v_to) > 254 OR v_to !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}$'
       OR EXISTS (SELECT 1 FROM public.affiliates a WHERE a.email = v_to) THEN
      RETURN NULL;
    END IF;
  ELSE
    v_to := v_email;
  END IF;
  DELETE FROM public.affiliate_account_links l
   WHERE l.affiliate_id = v_id AND l.purpose = p_purpose AND l.used_at IS NULL;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.affiliate_account_links (affiliate_id, purpose, token_hash, new_email)
  VALUES (v_id, p_purpose, encode(extensions.digest(v_token, 'sha256'), 'hex'), CASE WHEN p_purpose = 'email' THEN v_to END);
  RETURN jsonb_build_object('token', v_token, 'to', v_to);
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_link_mint(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_link_mint(text, uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.affiliate_link_mint(text, uuid, text, text) IS
  'Mints a single-use 30-minute link (reset, confirm or email) for an active affiliate, retiring the unused one of the same '
  'purpose; answers {token, to} once, or NULL. service_role only (affiliate-account). 20261112120000.';

CREATE OR REPLACE FUNCTION public.affiliate_link_use(
  p_token text,
  p_purpose text,
  p_new_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aff uuid;
  v_new text;
  v_email text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR p_purpose IS NULL OR p_purpose NOT IN ('reset', 'confirm', 'email') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  -- Checked before the link is spent, so a short password does not burn it.
  IF p_purpose = 'reset' AND (p_new_password IS NULL OR length(p_new_password) < 8 OR length(p_new_password) > 200) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'weak-password');
  END IF;
  UPDATE public.affiliate_account_links l
     SET used_at = now()
   WHERE l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     AND l.purpose = p_purpose
     AND l.used_at IS NULL
     AND l.expires_at > now()
  RETURNING l.affiliate_id, l.new_email INTO v_aff, v_new;
  IF v_aff IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  SELECT a.email INTO v_email FROM public.affiliates a WHERE a.id = v_aff AND a.status = 'active';
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF p_purpose = 'reset' THEN
    UPDATE public.affiliates
       SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_aff;
    DELETE FROM public.affiliate_sessions WHERE affiliate_id = v_aff;
    DELETE FROM public.client_write_budget WHERE scope = 'affiliate-login-fail:' || md5(v_email);
    DELETE FROM public.affiliate_account_links WHERE affiliate_id = v_aff AND purpose = 'reset' AND used_at IS NULL;
    RETURN jsonb_build_object('ok', true, 'email', v_email);
  ELSIF p_purpose = 'confirm' THEN
    UPDATE public.affiliates SET email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() WHERE id = v_aff;
    RETURN jsonb_build_object('ok', true, 'email', v_email);
  END IF;

  IF v_new IS NULL OR EXISTS (SELECT 1 FROM public.affiliates a WHERE a.email = v_new AND a.id <> v_aff) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'taken');
  END IF;
  UPDATE public.affiliates SET email = v_new, email_confirmed_at = now(), updated_at = now() WHERE id = v_aff;
  RETURN jsonb_build_object('ok', true, 'email', v_new, 'previous', v_email);
END
$$;
REVOKE ALL ON FUNCTION public.affiliate_link_use(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_link_use(text, text, text) TO service_role;
COMMENT ON FUNCTION public.affiliate_link_use(text, text, text) IS
  'Spends a mailed link once within its 30 minutes: reset (new bcrypt password, every session ended, the failed-sign-in '
  'count cleared, the address proven), confirm (the address proven), email (the address changed and proven). Answers '
  '{ok, error?}. service_role only (affiliate-account). 20261112120000.';

-- ── 4. budgets that a stranger cannot spend for the affiliate ──────────────

CREATE OR REPLACE FUNCTION public.client_write_budget_left(
  p_scope text,
  p_per_address integer,
  p_ceiling integer,
  p_window_minutes integer
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_addr text := public.request_client_address();
  v_window timestamptz;
  v_mine integer;
  v_all integer;
BEGIN
  IF p_scope IS NULL OR p_scope = '' OR p_per_address IS NULL OR p_per_address < 1
     OR p_ceiling IS NULL OR p_ceiling < p_per_address
     OR p_window_minutes IS NULL OR p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'client_write_budget_left: not a budget: %/%/%/%', p_scope, p_per_address, p_ceiling, p_window_minutes
      USING ERRCODE = '22023';
  END IF;
  v_window := to_timestamp(floor(extract(epoch FROM now()) / (p_window_minutes * 60)) * (p_window_minutes * 60));
  SELECT CASE WHEN b.window_start = v_window THEN b.n ELSE 0 END INTO v_mine
    FROM public.client_write_budget b
   WHERE b.scope = left(p_scope, 120) AND b.bucket = COALESCE('ip:' || md5(v_addr), 'no-address');
  SELECT CASE WHEN b.window_start = v_window THEN b.n ELSE 0 END INTO v_all
    FROM public.client_write_budget b
   WHERE b.scope = left(p_scope, 120) AND b.bucket = '*';
  RETURN greatest(0, least(
    (CASE WHEN v_addr IS NULL THEN p_ceiling ELSE p_per_address END) - coalesce(v_mine, 0),
    p_ceiling - coalesce(v_all, 0)));
END
$$;
REVOKE ALL ON FUNCTION public.client_write_budget_left(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_write_budget_left(text, integer, integer, integer) TO service_role;
COMMENT ON FUNCTION public.client_write_budget_left(text, integer, integer, integer) IS
  'What is left of a client_write_allowed budget for this caller in the current window, read without charging it. '
  'service_role only; login_affiliate calls it as its owner. 20261112120000.';

CREATE OR REPLACE FUNCTION public.login_affiliate(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_affiliate affiliates%ROWTYPE;
  v_email text;
  v_fail_scope text;
  v_ok boolean := false;
  v_token text;
BEGIN
  IF p_email IS NULL OR p_password IS NULL OR length(p_email) > 254 OR length(p_password) > 200 THEN
    RAISE EXCEPTION 'Invalid email or password';
  END IF;
  v_email := lower(trim(p_email));
  v_fail_scope := 'affiliate-login-fail:' || md5(v_email);
  -- Twenty attempts an hour per address, a thousand for the site. Then the
  -- failures against this email, READ here and charged only below when the
  -- password is wrong: ten an hour from one address, two hundred from all.
  -- A stranger's guesses spend their own allowance, never the owner's.
  IF NOT public.client_write_allowed('affiliate-login', 20, 1000, 60) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many sign-in attempts. Try again in an hour.');
  END IF;
  IF public.client_write_budget_left(v_fail_scope, 10, 200, 60) < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many sign-in attempts. Try again in an hour, or reset your password.');
  END IF;
  SELECT * INTO v_affiliate FROM affiliates WHERE email = v_email;
  -- An erased account holds no bcrypt hash: never handed to crypt().
  IF FOUND AND v_affiliate.password_hash LIKE '$2%' THEN
    v_ok := v_affiliate.password_hash = crypt(p_password, v_affiliate.password_hash);
  END IF;
  IF NOT v_ok THEN
    PERFORM public.client_write_allowed(v_fail_scope, 10, 200, 60);
    RETURN jsonb_build_object('success', false, 'error', 'Invalid email or password');
  END IF;
  IF v_affiliate.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Account is not active');
  END IF;
  DELETE FROM affiliate_sessions WHERE affiliate_id = v_affiliate.id AND expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO affiliate_sessions (affiliate_id, token_hash)
  VALUES (v_affiliate.id, encode(digest(v_token, 'sha256'), 'hex'));
  PERFORM public.affiliate_note_network(v_affiliate.id);
  RETURN jsonb_build_object(
    'success', true,
    'affiliate_id', v_affiliate.id,
    'email', v_affiliate.email,
    'referral_code', v_affiliate.referral_code,
    'session_token', v_token,
    'email_confirmed', v_affiliate.email_confirmed_at IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.login_affiliate(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_affiliate(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_affiliate(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_affiliate_id UUID;
  v_referral_code TEXT;
  v_net text;
  v_token text;
BEGIN
  IF p_email IS NULL OR length(p_email) > 254 OR p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 OR length(p_password) > 200 THEN
    RAISE EXCEPTION 'Password must be 8 to 200 characters';
  END IF;
  -- Ten sign-ups a day per /24 or /48 network, a thousand for the site: one
  -- network cannot close the program to everyone else. An unproven account
  -- can neither earn unflagged nor ask to be paid, so open sign-up is safe.
  v_net := public.affiliate_network_key(public.request_client_address());
  IF NOT public.client_write_allowed('affiliate-register-net:' || coalesce(v_net, 'no-address'), 10, 10, 1440) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many sign-up attempts. Try again tomorrow.');
  END IF;
  IF NOT public.client_write_allowed('affiliate-register', 10, 1000, 1440) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many sign-up attempts. Try again tomorrow.');
  END IF;
  IF EXISTS (SELECT 1 FROM affiliates WHERE email = lower(trim(p_email))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This email cannot be registered. If it is yours, sign in instead.');
  END IF;
  INSERT INTO affiliates (email, password_hash)
  VALUES (lower(trim(p_email)), crypt(p_password, gen_salt('bf')))
  RETURNING id, referral_code INTO v_affiliate_id, v_referral_code;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO affiliate_sessions (affiliate_id, token_hash)
  VALUES (v_affiliate_id, encode(digest(v_token, 'sha256'), 'hex'));
  PERFORM public.affiliate_note_network(v_affiliate_id);
  RETURN jsonb_build_object(
    'success', true,
    'affiliate_id', v_affiliate_id,
    'referral_code', v_referral_code,
    'session_token', v_token
  );
END;
$$;
REVOKE ALL ON FUNCTION public.register_affiliate(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_affiliate(text, text) TO anon, authenticated, service_role;

-- ── 5. every session reader, through the owner lookup ──────────────────────

CREATE OR REPLACE FUNCTION public.logout_affiliate(
  p_session_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_token IS NULL OR p_session_token !~ '^[0-9a-f]{32,128}$' THEN
    RETURN false;
  END IF;
  DELETE FROM affiliate_sessions WHERE token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.logout_affiliate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_affiliate(text) TO anon, authenticated, service_role;

-- The dashboard as 20251221233709 shaped it, read through the owner lookup,
-- plus affiliate.email_confirmed. 20261112122000 gives it its final shape.
CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard(
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID := public.affiliate_session_owner(p_session_token);
  v_affiliate affiliates%ROWTYPE;
  v_total_clicks BIGINT;
  v_total_conversions BIGINT;
  v_total_revenue BIGINT;
  v_pending_payout BIGINT;
  v_paid_out BIGINT;
  v_recent_conversions JSONB;
BEGIN
  IF v_affiliate_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  SELECT * INTO v_affiliate FROM affiliates WHERE id = v_affiliate_id;
  SELECT COUNT(*) INTO v_total_clicks FROM affiliate_clicks WHERE affiliate_id = v_affiliate_id;
  SELECT COUNT(*), COALESCE(SUM(sale_amount), 0) INTO v_total_conversions, v_total_revenue
    FROM affiliate_conversions WHERE affiliate_id = v_affiliate_id AND status != 'rejected';
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_pending_payout
    FROM affiliate_conversions WHERE affiliate_id = v_affiliate_id AND status = 'approved';
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_paid_out
    FROM affiliate_conversions WHERE affiliate_id = v_affiliate_id AND status = 'paid';
  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_recent_conversions
    FROM (SELECT id, product_name, sale_amount, commission_amount, status, created_at
            FROM affiliate_conversions WHERE affiliate_id = v_affiliate_id
           ORDER BY created_at DESC LIMIT 20) c;
  RETURN jsonb_build_object(
    'affiliate', jsonb_build_object(
      'id', v_affiliate.id, 'email', v_affiliate.email, 'referral_code', v_affiliate.referral_code,
      'commission_amount', v_affiliate.commission_amount, 'status', v_affiliate.status,
      'created_at', v_affiliate.created_at, 'email_confirmed', v_affiliate.email_confirmed_at IS NOT NULL
    ),
    'stats', jsonb_build_object(
      'total_clicks', v_total_clicks, 'total_conversions', v_total_conversions, 'total_revenue', v_total_revenue,
      'pending_payout', v_pending_payout, 'paid_out', v_paid_out,
      'conversion_rate', CASE WHEN v_total_clicks > 0
        THEN ROUND((v_total_conversions::NUMERIC / v_total_clicks::NUMERIC) * 100, 2) ELSE 0 END
    ),
    'recent_conversions', v_recent_conversions
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_affiliate_dashboard(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_dashboard(text) TO anon, authenticated, service_role;

-- 20251222195155's history, read through the owner lookup. 20261112121000
-- adds the days the 90-day prune rolls up.
CREATE OR REPLACE FUNCTION public.get_affiliate_clicks(p_session_token text, p_days_back integer DEFAULT 30)
RETURNS TABLE(click_date date, click_count bigint, unique_referrers bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID := public.affiliate_session_owner(p_session_token);
BEGIN
  IF v_affiliate_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  RETURN QUERY
  SELECT DATE(c.created_at) AS click_date,
         COUNT(*) AS click_count,
         COUNT(DISTINCT COALESCE(c.ip_hash, c.referrer, c.user_agent, 'unknown')) AS unique_referrers
    FROM affiliate_clicks c
   WHERE c.affiliate_id = v_affiliate_id
     AND c.created_at > now() - make_interval(days => least(greatest(coalesce(p_days_back, 30), 1), 400))
   GROUP BY DATE(c.created_at)
   ORDER BY click_date DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_affiliate_clicks(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_clicks(text, integer) TO anon, authenticated, service_role;

-- Closed since the census (no caller); re-pointed so it does not read a
-- column that no longer holds tokens.
CREATE OR REPLACE FUNCTION public.get_affiliate_stats_by_date(
  p_session_token text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE(total_clicks bigint, total_conversions bigint, total_revenue bigint, pending_payout bigint, paid_out bigint, conversion_rate numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID := public.affiliate_session_owner(p_session_token);
  v_start timestamptz;
  v_end timestamptz;
  v_clicks bigint;
  v_conv bigint;
BEGIN
  IF v_affiliate_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  v_start := COALESCE(p_start_date::timestamptz, '1970-01-01'::timestamptz);
  v_end := COALESCE((p_end_date + interval '1 day')::timestamptz, now() + interval '1 day');
  SELECT COUNT(*) INTO v_clicks FROM affiliate_clicks
   WHERE affiliate_id = v_affiliate_id AND created_at >= v_start AND created_at < v_end;
  SELECT COUNT(*) INTO v_conv FROM affiliate_conversions
   WHERE affiliate_id = v_affiliate_id AND status != 'rejected' AND created_at >= v_start AND created_at < v_end;
  RETURN QUERY
  SELECT v_clicks,
         v_conv,
         (SELECT COALESCE(SUM(sale_amount), 0)::bigint FROM affiliate_conversions
           WHERE affiliate_id = v_affiliate_id AND status != 'rejected' AND created_at >= v_start AND created_at < v_end),
         (SELECT COALESCE(SUM(commission_amount), 0)::bigint FROM affiliate_conversions
           WHERE affiliate_id = v_affiliate_id AND status = 'approved' AND created_at >= v_start AND created_at < v_end),
         (SELECT COALESCE(SUM(commission_amount), 0)::bigint FROM affiliate_conversions
           WHERE affiliate_id = v_affiliate_id AND status = 'paid' AND created_at >= v_start AND created_at < v_end),
         CASE WHEN v_clicks > 0 THEN ROUND(v_conv::numeric / v_clicks::numeric * 100, 2) ELSE 0::numeric END;
END;
$$;
REVOKE ALL ON FUNCTION public.get_affiliate_stats_by_date(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_stats_by_date(text, date, date) TO service_role;

-- Self-verifying: the catalogue (every new definer closed to the client
-- roles, the five sign-in functions still open, no token stored as itself),
-- then, inside a rolled-back block, a sign-in round trip: the token handed
-- back is stored only as its hash, a stranger's failures leave the owner
-- signing in, and pausing the account ends the session.
DO $$
DECLARE
  f text;
  v_j jsonb;
  v_tok text;
  v_aff uuid;
  v_n integer;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.affiliate_network_key(text)', 'public.affiliate_session_owner(text)',
    'public.affiliate_link_mint(text,uuid,text,text)', 'public.affiliate_link_use(text,text,text)',
    'public.client_write_budget_left(text,integer,integer,integer)', 'public.affiliate_sessions_end_with_account()',
    'public.affiliate_keyed_hash(text,text)', 'public.affiliate_note_network(uuid)', 'public.get_affiliate_stats_by_date(text,date,date)'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION 'self-check: % is missing', f; END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.login_affiliate(text,text)', 'public.register_affiliate(text,text)', 'public.logout_affiliate(text)',
    'public.get_affiliate_dashboard(text)', 'public.get_affiliate_clicks(text,integer)'
  ] LOOP
    IF NOT has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION 'self-check: % must stay open to anon', f; END IF;
    IF position('affiliate_session_owner' in pg_get_functiondef(f::regprocedure)) = 0
       AND position('token_hash' in pg_get_functiondef(f::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'self-check: % does not read the hashed session', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.affiliate_hash_keys', 'public.affiliate_sign_in_networks', 'public.affiliate_account_links', 'public.affiliate_sessions'] LOOP
    IF has_table_privilege('anon', f, 'SELECT') OR has_table_privilege('authenticated', f, 'SELECT') THEN
      RAISE EXCEPTION 'self-check: a client role can read %', f;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.affiliate_hash_keys WHERE purpose IN ('click', 'network');
  IF v_n <> 2 THEN RAISE EXCEPTION 'self-check: % hashing keys, want 2', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.affiliate_sessions WHERE session_token IS NOT NULL) THEN
    RAISE EXCEPTION 'self-check: a session token is stored as itself';
  END IF;
  IF public.affiliate_network_key('203.0.113.7') IS DISTINCT FROM public.affiliate_network_key('203.0.113.250')
     OR public.affiliate_network_key('203.0.113.7') = public.affiliate_network_key('203.0.114.7')
     OR public.affiliate_network_key('::ffff:203.0.113.9') IS DISTINCT FROM public.affiliate_network_key('203.0.113.7') THEN
    RAISE EXCEPTION 'self-check: affiliate_network_key does not key the /24';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'affiliate_sessions_end_with_account'
                  AND t.tgrelid = 'public.affiliates'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'self-check: the session trigger is missing';
  END IF;

  BEGIN
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"192.0.2.201"}', true);
    v_j := public.register_affiliate('affiliate-signin-selfcheck@example.invalid', 'selfcheck password 1');
    IF NOT coalesce((v_j ->> 'success')::boolean, false) THEN
      RAISE NOTICE 'self-check: the sign-up probe was refused (%); the behaviour probe is skipped', v_j ->> 'error';
      RAISE EXCEPTION 'affiliate-signin-selfcheck-rollback';
    END IF;
    v_tok := v_j ->> 'session_token';
    v_aff := (v_j ->> 'affiliate_id')::uuid;
    IF EXISTS (SELECT 1 FROM public.affiliate_sessions s WHERE s.affiliate_id = v_aff
                AND (s.session_token = v_tok OR s.token_hash = v_tok)) THEN
      RAISE EXCEPTION 'self-check: the token is stored as itself';
    END IF;
    IF public.affiliate_session_owner(v_tok) IS DISTINCT FROM v_aff THEN
      RAISE EXCEPTION 'self-check: the token handed back does not open its session';
    END IF;
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"198.51.100.201"}', true);
    FOR v_n IN 1..12 LOOP
      PERFORM public.login_affiliate('affiliate-signin-selfcheck@example.invalid', 'not the password');
    END LOOP;
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"192.0.2.201"}', true);
    v_j := public.login_affiliate('affiliate-signin-selfcheck@example.invalid', 'selfcheck password 1');
    IF NOT coalesce((v_j ->> 'success')::boolean, false) THEN
      RAISE EXCEPTION 'self-check: a stranger''s failures locked the owner out (%)', v_j ->> 'error';
    END IF;
    UPDATE public.affiliates SET status = 'paused' WHERE id = v_aff;
    IF EXISTS (SELECT 1 FROM public.affiliate_sessions WHERE affiliate_id = v_aff) THEN
      RAISE EXCEPTION 'self-check: a paused account kept its sessions';
    END IF;
    RAISE EXCEPTION 'affiliate-signin-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'affiliate-signin-selfcheck-rollback' THEN RAISE; END IF;
  END;
END $$;
