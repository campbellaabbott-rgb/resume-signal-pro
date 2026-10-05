-- A MAIL WE SEND NEEDS A PROOF, AND A KEY NEEDS A MAILBOX.
--
-- Defect sweep 2026-10-02, items 1.43, 1.59 and 2.23. Every function below
-- sends mail from the verified resumebooster.work domain, and every one of
-- them could be made to mail an address of a stranger's choosing:
--
--   send-market-pulse {action:'send'} was unauthenticated, ignored
--     suppressed_emails, and throttled with a read-then-write, so N concurrent
--     triggers mailed every due subscriber N times (2.23). send-search-digest
--     and send-agent-digest had the same shape.
--   The pulse enrolled people who never opted in: the box was pre-ticked, any
--     third party could subscribe any address, and the mail then told them they
--     had asked for it (1.59).
--   api-key-request minted a working key for any typed address, handed it back
--     in the response, and mailed that address on every mint -- unlimited free
--     keys, each with its own quota, which made the per-key quota bound nothing
--     (1.43). That is the harvesting door.
--
-- WHAT THIS FILE BUILDS (the edge functions that use it ship with it):
--
--   1. email_cron_key -- a vault secret the three email crons (the pulse and
--      both digests) send as x-email-cron, checked by email_cron_key_matches
--      (a boolean, never the secret). Each batch send now refuses any caller
--      without it or the service-role key. search_digest_claim_batch and
--      agent_digest_claim_batch claim the digests' rows the way the pulse's
--      claim does: chosen and stamped in one statement, FOR UPDATE SKIP LOCKED.
--
--   2. Double opt-in for the market pulse. market_pulse_subscribers gains
--      confirmed_at, and the send selects ONLY confirmed rows. Every row that
--      exists today is left unconfirmed on purpose: those addresses were
--      enrolled by a pre-ticked box or by whoever typed them, which is not
--      consent, so the pulse stops for them until they confirm.
--      market_pulse_request_confirm records a request atomically and says
--      whether a confirmation mail is due (at most one per address per 7
--      days, at most 3 in any 90 days while unconfirmed -- a window, so a
--      stranger's requests can never shut an address out for good -- and
--      never to a suppressed address). Past 100 mails in a day only networks
--      that have not asked today are served ('shed'), and 400 stops it for
--      everyone ('paused'); the function tells the owner. market_pulse_confirm turns a single-use
--      token into confirmed_at. market_pulse_claim_batch claims due rows with
--      FOR UPDATE SKIP LOCKED and stamps them in the same statement, so two
--      triggers can never both mail one subscriber, and it skips every
--      suppressed address.
--
--   3. A key requires a mailbox. api_key_request_open records a request and a
--      single-use token (only its sha256 is stored); the function mails a link
--      to the address that asked, and nothing is minted. api_key_issue is now
--      the CONFIRM step: it takes that token, so a key exists only after the
--      address clicked its link, and the key is shown once to whoever did.
--      Bounds: two confirmation mails per mailbox a day (plus-tags and Gmail
--      dots are one mailbox), five requests an hour and twenty a day per
--      network; five keys a day per network, five a day per domain outside
--      the big shared providers; three live keys per mailbox, and a fourth
--      confirmed by the mailbox's owner retires the one used least recently --
--      never a key bound to an account (user_id). The daily totals have a soft
--      ceiling past which only networks that have not used the door today are
--      served (150 requests, 20 keys) and a hard one (600 requests, 60 keys);
--      a cheap actor can no longer turn the door off for everyone by filling
--      it, and reaching either tells the owner.
--      The old api_key_issue(p_email, p_name, ...) is dropped by catalogue
--      lookup, so an edge function still deployed from before this file gets
--      PGRST202 and mints nothing.
--      THE POOL THAT DOOR FILLED IS RETIRED. Every account-less free key
--      minted before this file (none has a confirmed request behind it) is
--      revoked here: each was handed to whoever typed an address, so a script
--      may hold any number of them. Their owners get a new key from the page,
--      behind their mailbox. And api_key_retire_idle, daily, retires a free
--      account-less key nobody has used for 30 days, so a pool cannot be
--      gathered again at the daily ceiling and kept.
--
--   4. mail_door_take -- an atomic fixed-window counter for the doors anyone
--      can knock on (send-scan-report: per network, per recipient, per day,
--      one drip a month per address; the pulse sign-up and confirm: per
--      network). check_rate_limit cannot hold a day-long window (each of its
--      calls sweeps every row older than its own window), so these doors no
--      longer use it.
--
-- Networks and recipients arrive as keyed hashes computed by the edge
-- functions; no network, and no address outside the tables that exist to
-- hold one, is stored here in the clear.

-- ── 1. The cron's key ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'vault is not installed here; email_cron_key not generated (the pulse cron will be refused)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_cron_key') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'email_cron_key'
    );
    RAISE NOTICE 'generated email_cron_key; the pulse cron is armed';
  ELSE
    RAISE NOTICE 'email_cron_key already present; left untouched';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.email_cron_key_matches(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_key IS NULL OR length(p_key) < 32 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = $1 AND s.decrypted_secret = $2)'
     INTO v_ok USING 'email_cron_key', p_key;
  RETURN COALESCE(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.email_cron_key_matches(text) IS
  'True when the argument equals the vault-held email_cron_key the email crons send as x-email-cron. '
  'Returns a boolean and never the key. An empty, short or missing key never matches. service_role only.';

REVOKE ALL ON FUNCTION public.email_cron_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_cron_key_matches(text) TO service_role;

-- ── 2. Market pulse: double opt-in, suppression, an atomic claim ────────────
ALTER TABLE public.market_pulse_subscribers
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_token_hash text,
  ADD COLUMN IF NOT EXISTS confirm_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_sends integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirm_window_start timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_net text;

COMMENT ON COLUMN public.market_pulse_subscribers.confirm_net IS
  'Keyed hash of the network that last asked for a confirmation for this address (never the address of the network). Counts a network''s requests per day.';

CREATE UNIQUE INDEX IF NOT EXISTS market_pulse_subscribers_confirm_token_idx
  ON public.market_pulse_subscribers (confirm_token_hash)
  WHERE confirm_token_hash IS NOT NULL;

-- Service-role only, by name: RLS already refuses anon, and a grant that
-- answers nothing is still a grant nobody needs.
REVOKE ALL ON TABLE public.market_pulse_subscribers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.market_pulse_subscribers TO service_role;

-- The four-argument form never shipped from main; a database that ran an
-- earlier copy of this file loses it here, so only one form can be called.
DROP FUNCTION IF EXISTS public.market_pulse_request_confirm(text, text, integer, text);

CREATE OR REPLACE FUNCTION public.market_pulse_request_confirm(
  p_email text,
  p_industry text,
  p_score integer,
  p_token_hash text,
  p_net text
)
RETURNS TABLE (
  pc_send boolean,
  pc_reason text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hit text;
  v_today integer;
  v_net_today integer;
  c_resend_after interval := interval '7 days';
  -- Three unconfirmed mails in any 90 days. A WINDOW, not a lifetime: a
  -- lifetime count let three requests from a stranger, a week apart, stop an
  -- address from ever being sent its own confirmation.
  c_max_unconfirmed_sends integer := 3;
  c_unconfirmed_window interval := interval '90 days';
  -- Past the soft ceiling only a network that has not asked today is served;
  -- the hard ceiling stops everyone. The edge function tells the owner.
  c_global_soft integer := 100;
  c_global_day integer := 400;
  c_net_share integer := 1;
BEGIN
  IF length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
    RETURN QUERY SELECT false, 'invalid_email'::text; RETURN;
  END IF;
  IF coalesce(length(p_token_hash), 0) <> 64 THEN
    RETURN QUERY SELECT false, 'bad_request'::text; RETURN;
  END IF;

  -- The day's counts and the write below are one decision. The day and the
  -- caller's network are judged BEFORE anything about the address: the edge
  -- function refuses 'shed' and 'paused' out loud and answers every address
  -- state alike, so this order keeps the refusal from telling anyone whether
  -- the address is suppressed.
  PERFORM pg_advisory_xact_lock(hashtext('market_pulse_request_confirm'));

  SELECT count(*) INTO v_today
    FROM public.market_pulse_subscribers s
   WHERE s.confirm_sent_at > now() - interval '24 hours';
  IF v_today >= c_global_day THEN
    RETURN QUERY SELECT false, 'paused'::text; RETURN;
  END IF;
  IF v_today >= c_global_soft THEN
    SELECT count(*) INTO v_net_today
      FROM public.market_pulse_subscribers s
     WHERE s.confirm_net = p_net AND s.confirm_sent_at > now() - interval '24 hours';
    IF p_net IS NULL OR v_net_today >= c_net_share THEN
      RETURN QUERY SELECT false, 'shed'::text; RETURN;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.suppressed_emails se WHERE lower(se.email) = v_email) THEN
    RETURN QUERY SELECT false, 'suppressed'::text; RETURN;
  END IF;

  -- One statement decides and records: a concurrent request for the same
  -- address meets the row this one wrote and is refused by the WHERE.
  INSERT INTO public.market_pulse_subscribers AS m
         (email, industry, last_score, confirm_token_hash, confirm_sent_at, confirm_sends, confirm_window_start, confirm_net)
  VALUES (v_email, left(coalesce(nullif(btrim(p_industry), ''), 'general'), 64), p_score, p_token_hash, now(), 1, now(), p_net)
  ON CONFLICT (email) DO UPDATE
     SET industry = EXCLUDED.industry,
         last_score = coalesce(EXCLUDED.last_score, m.last_score),
         confirm_token_hash = EXCLUDED.confirm_token_hash,
         confirm_sent_at = now(),
         confirm_sends = CASE WHEN m.confirm_window_start IS NULL OR m.confirm_window_start < now() - c_unconfirmed_window
                              THEN 1 ELSE m.confirm_sends + 1 END,
         confirm_window_start = CASE WHEN m.confirm_window_start IS NULL OR m.confirm_window_start < now() - c_unconfirmed_window
                                     THEN now() ELSE m.confirm_window_start END,
         confirm_net = EXCLUDED.confirm_net
   WHERE (m.confirmed_at IS NULL OR m.unsubscribed_at IS NOT NULL)
     AND (m.confirm_sent_at IS NULL OR m.confirm_sent_at < now() - c_resend_after)
     AND (m.confirm_sends < c_max_unconfirmed_sends
          OR m.confirm_window_start IS NULL
          OR m.confirm_window_start < now() - c_unconfirmed_window)
  RETURNING m.email INTO v_hit;

  IF v_hit IS NULL THEN
    RETURN QUERY SELECT false,
      (CASE WHEN EXISTS (SELECT 1 FROM public.market_pulse_subscribers s
                          WHERE s.email = v_email AND s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL)
            THEN 'already_confirmed' ELSE 'recently_sent' END)::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, 'sent'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_pulse_confirm(p_token_hash text)
RETURNS TABLE (
  cf_confirmed boolean,
  cf_reason text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_hit text;
BEGIN
  IF coalesce(length(p_token_hash), 0) <> 64 THEN
    RETURN QUERY SELECT false, 'invalid'::text; RETURN;
  END IF;
  -- Single use: the token is cleared by the same statement that confirms.
  -- confirm_sends restarts, so "three unconfirmed mails" is counted afresh
  -- if this person later unsubscribes and asks again.
  UPDATE public.market_pulse_subscribers m
     SET confirmed_at = now(),
         unsubscribed_at = NULL,
         confirm_token_hash = NULL,
         confirm_sends = 0,
         confirm_window_start = NULL
   WHERE m.confirm_token_hash = p_token_hash
     AND m.confirm_sent_at > now() - interval '7 days'
  RETURNING m.email INTO v_hit;
  IF v_hit IS NULL THEN
    RETURN QUERY SELECT false, 'invalid_or_expired'::text; RETURN;
  END IF;
  RETURN QUERY SELECT true, 'confirmed'::text;
END;
$$;

-- LANGUAGE sql: the claim is one UPDATE ... RETURNING, which a SQL function
-- returns directly. FOR UPDATE SKIP LOCKED gives two concurrent triggers
-- disjoint sets, and the stamp lands in the same statement as the choice.
CREATE OR REPLACE FUNCTION public.market_pulse_claim_batch(p_limit integer)
RETURNS TABLE (
  cl_email text,
  cl_industry text,
  cl_last_score integer,
  cl_confirmed_at timestamptz,
  cl_prev_sent_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH due AS (
    SELECT s.email AS d_email, s.last_sent_at AS d_prev
      FROM public.market_pulse_subscribers s
     WHERE s.confirmed_at IS NOT NULL
       AND s.unsubscribed_at IS NULL
       AND (s.last_sent_at IS NULL OR s.last_sent_at < now() - interval '28 days')
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails se WHERE lower(se.email) = lower(s.email))
     ORDER BY s.last_sent_at ASC NULLS FIRST, s.email
     LIMIT least(greatest(coalesce(p_limit, 0), 1), 200)
     FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE public.market_pulse_subscribers m
     SET last_sent_at = now()
    FROM due
   WHERE m.email = due.d_email
  RETURNING m.email, m.industry, m.last_score, m.confirmed_at, due.d_prev;
$$;

REVOKE ALL ON FUNCTION public.market_pulse_request_confirm(text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_pulse_request_confirm(text, text, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.market_pulse_confirm(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_pulse_confirm(text) TO service_role;
REVOKE ALL ON FUNCTION public.market_pulse_claim_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_pulse_claim_batch(integer) TO service_role;

-- ── 2b. The digests: claimed, not read-then-written ─────────────────────────
-- send-search-digest and send-agent-digest selected their due rows and
-- stamped each only after its awaited send, so two runs in flight mailed the
-- same people twice. These claims choose and stamp in one statement, each row
-- coming back with the stamp it had before (the "new since" window, and what
-- the function writes back when it skips a row for a passing reason).
-- Cadence floors: a saved search on 'daily' waits 20 hours, any other 6 days;
-- the morning shortlist waits 20 hours.
CREATE OR REPLACE FUNCTION public.search_digest_claim_batch(p_limit integer)
RETURNS TABLE (
  sd_id uuid,
  sd_user_id uuid,
  sd_name text,
  sd_params jsonb,
  sd_prev_sent_at timestamptz,
  sd_fit_threshold integer,
  sd_cadence text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH due AS (
    SELECT s.id AS d_id, s.digest_last_sent_at AS d_prev
      FROM public.user_job_searches s
     WHERE s.digest_opt_in = true
       AND (s.digest_last_sent_at IS NULL
            OR s.digest_last_sent_at < now() - CASE WHEN s.digest_cadence = 'daily'
                                                    THEN interval '20 hours' ELSE interval '6 days' END)
     ORDER BY s.digest_last_sent_at ASC NULLS FIRST, s.id
     LIMIT least(greatest(coalesce(p_limit, 0), 1), 400)
     FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE public.user_job_searches m
     SET digest_last_sent_at = now()
    FROM due
   WHERE m.id = due.d_id
  RETURNING m.id, m.user_id, m.name, m.params, due.d_prev, m.fit_threshold, m.digest_cadence;
$$;

CREATE OR REPLACE FUNCTION public.agent_digest_claim_batch(p_limit integer)
RETURNS TABLE (
  ad_user_id uuid,
  ad_email text,
  ad_prev_sent_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH due AS (
    SELECT a.user_id AS d_user, a.email_last_sent_at AS d_prev
      FROM public.agent_mandates a
     WHERE a.email_opt_in = true
       AND (a.email_last_sent_at IS NULL OR a.email_last_sent_at < now() - interval '20 hours')
     ORDER BY a.email_last_sent_at ASC NULLS FIRST, a.user_id
     LIMIT least(greatest(coalesce(p_limit, 0), 1), 500)
     FOR UPDATE OF a SKIP LOCKED
  )
  UPDATE public.agent_mandates m
     SET email_last_sent_at = now()
    FROM due
   WHERE m.user_id = due.d_user
  RETURNING m.user_id, m.email, due.d_prev;
$$;

REVOKE ALL ON FUNCTION public.search_digest_claim_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_digest_claim_batch(integer) TO service_role;
REVOKE ALL ON FUNCTION public.agent_digest_claim_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_digest_claim_batch(integer) TO service_role;

-- The schedules, now carrying the key. The pulse keeps the minute it always
-- ran. A digest job keeps whatever schedule it has today, and a digest job
-- that does not exist is left absent (its absence is someone's decision, and
-- creating it would start mail nobody scheduled). A database without the
-- vault secret fires nothing rather than a refused call.
DO $$
DECLARE
  r record;
  v_sched text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; the email crons were not rescheduled';
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES ('send-market-pulse', '47 15 * * *', true),
                          ('send-search-digest', '23 14 * * *', false),
                          ('send-agent-digest', '40 6 * * *', false)) v(job, default_schedule, always)
  LOOP
    SELECT j.schedule INTO v_sched FROM cron.job j WHERE j.jobname = r.job;
    IF v_sched IS NULL AND NOT r.always THEN
      RAISE NOTICE 'no % cron job here; left absent', r.job;
      CONTINUE;
    END IF;
    IF r.always THEN v_sched := r.default_schedule; END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = r.job) THEN
      PERFORM cron.unschedule(r.job);
    END IF;
    PERFORM cron.schedule(r.job, v_sched, format($job$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-email-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_cron_key' LIMIT 1)
      ),
      body := '{"action":"send"}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_cron_key');
    $job$, 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/' || r.job));
  END LOOP;
END $$;

-- ── 3. A key requires a mailbox ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_key_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  mailbox text NOT NULL,
  key_name text,
  token_hash text NOT NULL UNIQUE,
  request_net text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  confirm_net text,
  issued_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL
);
ALTER TABLE public.api_key_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_key_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_key_requests TO service_role;
CREATE INDEX IF NOT EXISTS api_key_requests_mailbox_idx ON public.api_key_requests (mailbox, created_at);
CREATE INDEX IF NOT EXISTS api_key_requests_request_net_idx ON public.api_key_requests (request_net, created_at);
CREATE INDEX IF NOT EXISTS api_key_requests_confirm_net_idx ON public.api_key_requests (confirm_net, confirmed_at);
COMMENT ON TABLE public.api_key_requests IS
  'Pending and confirmed data-API key requests. Only the sha256 of each single-use confirmation token is stored; networks are keyed hashes. Service-role only.';

-- One mailbox, however it is spelled: case, a +tag, and (for Gmail) dots
-- all deliver to the same inbox, so they share one allowance.
CREATE OR REPLACE FUNCTION public.api_key_mailbox(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := lower(btrim(coalesce(p_email, '')));
  v_local text;
  v_domain text;
BEGIN
  IF v !~ '^[^@]+@[^@]+$' THEN
    RETURN v;
  END IF;
  v_local := split_part(split_part(v, '@', 1), '+', 1);
  v_domain := split_part(v, '@', 2);
  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_domain := 'gmail.com';
    v_local := replace(v_local, '.', '');
  END IF;
  RETURN v_local || '@' || v_domain;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_mailbox(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_mailbox(text) TO service_role;

CREATE OR REPLACE FUNCTION public.api_key_request_open(
  p_email text,
  p_name text,
  p_token_hash text,
  p_net text
)
RETURNS TABLE (
  rq_send boolean,
  rq_reason text,
  rq_live_keys integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_mailbox text;
  v_n integer;
  v_net_day integer := 0;
  v_live integer;
  c_per_mailbox_day integer := 2;
  c_per_net_hour integer := 5;
  c_per_net_day integer := 20;
  -- Past the soft ceiling only a network with no request today is served
  -- ('shed'); the hard ceiling stops everyone ('paused'). Either one is a
  -- day a real visitor may be turned away, and the edge function tells the
  -- owner. Fifteen networks used to be enough to fill a hard 300.
  c_global_soft integer := 150;
  c_global_day integer := 600;
  c_net_share integer := 1;
BEGIN
  IF length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
    RETURN QUERY SELECT false, 'invalid_email'::text, 0; RETURN;
  END IF;
  IF coalesce(length(p_token_hash), 0) <> 64 THEN
    RETURN QUERY SELECT false, 'bad_request'::text, 0; RETURN;
  END IF;

  -- Every count below and the insert after them are one decision: requests
  -- and mints share this lock, so no two can both read the last free slot.
  PERFORM pg_advisory_xact_lock(hashtext('api_key_issuance'));
  v_mailbox := public.api_key_mailbox(v_email);

  -- THE CALLER'S NETWORK AND THE DAY FIRST, THE ADDRESS LAST. The edge
  -- function answers an address-specific refusal (bounced, complained, two
  -- links already today) exactly as it answers a mailed request, and refuses
  -- a busy network or day out loud. Were the address checked first, a busy
  -- network would hear 'network busy' for an ordinary address and 'check your
  -- inbox' for a suppressed one: the order itself would be the oracle.
  IF p_net IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.api_key_requests kr
     WHERE kr.request_net = p_net AND kr.created_at > now() - interval '1 hour';
    IF v_n >= c_per_net_hour THEN
      RETURN QUERY SELECT false, 'network_busy'::text, 0; RETURN;
    END IF;
    SELECT count(*) INTO v_net_day FROM public.api_key_requests kr
     WHERE kr.request_net = p_net AND kr.created_at > now() - interval '24 hours';
    IF v_net_day >= c_per_net_day THEN
      RETURN QUERY SELECT false, 'network_busy'::text, 0; RETURN;
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM public.api_key_requests kr
   WHERE kr.created_at > now() - interval '24 hours';
  IF v_n >= c_global_day THEN
    RETURN QUERY SELECT false, 'paused'::text, 0; RETURN;
  END IF;
  IF v_n >= c_global_soft AND (p_net IS NULL OR v_net_day >= c_net_share) THEN
    RETURN QUERY SELECT false, 'shed'::text, 0; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.suppressed_emails se
              WHERE lower(se.email) = v_email AND se.reason IN ('bounce', 'complaint')) THEN
    RETURN QUERY SELECT false, 'undeliverable'::text, 0; RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM public.api_key_requests kr
   WHERE kr.mailbox = v_mailbox AND kr.created_at > now() - interval '24 hours';
  IF v_n >= c_per_mailbox_day THEN
    RETURN QUERY SELECT false, 'too_many_requests'::text, 0; RETURN;
  END IF;

  INSERT INTO public.api_key_requests (email, mailbox, key_name, token_hash, request_net, expires_at)
  VALUES (v_email, v_mailbox, left(coalesce(nullif(btrim(p_name), ''), 'Untitled key'), 80),
          p_token_hash, p_net, now() + interval '24 hours');

  SELECT count(*) INTO v_live FROM public.api_keys ak
   WHERE ak.user_id IS NULL AND ak.revoked_at IS NULL
     AND public.api_key_mailbox(ak.owner_email) = v_mailbox;

  RETURN QUERY SELECT true, 'sent'::text, v_live;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_request_open(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_request_open(text, text, text, text) TO service_role;

-- The old mint, by catalogue lookup rather than a hand-listed signature: it
-- took an address and returned a key, which is the door this file closes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'api_key_issue'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

-- THE MINT, now behind a mailbox. Its only input that names a person is a
-- confirmation token, which exists only in the mail sent to the address that
-- asked. The free-tier constants (c_rate, c_quota) are the ones the MCP
-- config and the pages mirror.
CREATE FUNCTION public.api_key_issue(
  p_token_hash text,
  p_key_hash text,
  p_key_prefix text,
  p_net text
)
RETURNS TABLE (
  ik_issued boolean,
  ik_reason text,
  ik_key_id uuid,
  ik_tier text,
  ik_rate integer,
  ik_quota integer,
  ik_retired text[]
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  r RECORD;
  v_domain text;
  v_n integer;
  v_new uuid;
  v_retired text[] := '{}';
  c_rate integer := 60;
  c_quota integer := 1000;
  c_tier text := 'free';
  v_net_day integer := 0;
  c_max_active integer := 3;
  c_per_net_day integer := 5;
  c_per_domain_day integer := 5;
  -- Past the soft ceiling only a network that has created no key today is
  -- served ('shed'); the hard ceiling stops everyone ('paused'). Eight
  -- networks used to be enough to fill a hard 40.
  c_global_soft integer := 20;
  c_global_day integer := 60;
  c_net_share integer := 1;
  c_shared_domains text[] := ARRAY[
    'gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
    'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com',
    'gmx.de', 'web.de', 'fastmail.com', 'hotmail.co.uk', 'yahoo.co.uk', 'outlook.de'
  ];
BEGIN
  IF coalesce(length(p_token_hash), 0) <> 64 OR coalesce(length(p_key_hash), 0) <> 64
     OR coalesce(length(p_key_prefix), 0) = 0 THEN
    RETURN QUERY SELECT false, 'invalid_link'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
  END IF;

  -- A token nobody was mailed never reaches the lock below, so a flood of
  -- made-up links cannot queue in front of real ones.
  IF NOT EXISTS (SELECT 1 FROM public.api_key_requests kr WHERE kr.token_hash = p_token_hash) THEN
    RETURN QUERY SELECT false, 'invalid_link'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('api_key_issuance'));

  SELECT kr.id AS req_id, kr.email AS req_email, kr.mailbox AS req_mailbox, kr.key_name AS req_name,
         kr.expires_at AS req_expires, kr.confirmed_at AS req_confirmed
    INTO r
    FROM public.api_key_requests kr
   WHERE kr.token_hash = p_token_hash
   FOR UPDATE;

  IF r.req_id IS NULL THEN
    RETURN QUERY SELECT false, 'invalid_link'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
  END IF;
  IF r.req_confirmed IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_used'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
  END IF;
  IF r.req_expires < now() THEN
    RETURN QUERY SELECT false, 'expired'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
  END IF;

  -- The refusals below leave the token unspent, so the owner can retry it
  -- from another network or tomorrow while it is still inside its 24 hours.
  IF p_net IS NOT NULL THEN
    SELECT count(*) INTO v_net_day FROM public.api_key_requests kr
     WHERE kr.confirm_net = p_net AND kr.confirmed_at > now() - interval '24 hours';
    IF v_net_day >= c_per_net_day THEN
      RETURN QUERY SELECT false, 'network_limit'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM public.api_keys ak
   WHERE ak.user_id IS NULL AND ak.created_at > now() - interval '24 hours';
  IF v_n >= c_global_day THEN
    RETURN QUERY SELECT false, 'paused'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
  END IF;
  IF v_n >= c_global_soft AND (p_net IS NULL OR v_net_day >= c_net_share) THEN
    RETURN QUERY SELECT false, 'shed'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
  END IF;

  v_domain := split_part(r.req_mailbox, '@', 2);
  IF NOT (v_domain = ANY (c_shared_domains)) THEN
    SELECT count(*) INTO v_n FROM public.api_keys ak
     WHERE ak.user_id IS NULL AND ak.created_at > now() - interval '24 hours'
       AND split_part(lower(ak.owner_email), '@', 2) = v_domain;
    IF v_n >= c_per_domain_day THEN
      RETURN QUERY SELECT false, 'domain_limit'::text, NULL::uuid, NULL::text, 0, 0, '{}'::text[]; RETURN;
    END IF;
  END IF;

  -- Three live keys per mailbox. The owner has just proved they read this
  -- mailbox, so making room is their act: the least recently used of their
  -- OWN account-less keys retire. A key bound to an account is never touched.
  WITH live AS (
    SELECT ak.id AS l_id,
           row_number() OVER (ORDER BY coalesce(ak.last_used_at, ak.created_at) DESC, ak.created_at DESC) AS l_rank
      FROM public.api_keys ak
     WHERE ak.user_id IS NULL AND ak.revoked_at IS NULL
       AND public.api_key_mailbox(ak.owner_email) = r.req_mailbox
  ), gone AS (
    UPDATE public.api_keys ak
       SET revoked_at = now(), notes = 'retired: its mailbox confirmed a newer key past the cap of three'
      FROM live
     WHERE ak.id = live.l_id AND live.l_rank >= c_max_active
    RETURNING ak.key_prefix AS g_prefix
  )
  SELECT coalesce(array_agg(gone.g_prefix), '{}'::text[]) INTO v_retired FROM gone;

  INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, rate_per_min, daily_quota)
  VALUES (p_key_hash, p_key_prefix, coalesce(r.req_name, 'Untitled key'), r.req_email, c_tier, c_rate, c_quota)
  RETURNING id INTO v_new;

  UPDATE public.api_key_requests kr
     SET confirmed_at = now(), confirm_net = p_net, issued_key_id = v_new
   WHERE kr.id = r.req_id;

  RETURN QUERY SELECT true, 'issued'::text, v_new, c_tier, c_rate, c_quota, v_retired;
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_issue(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_issue(text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.api_key_issue(text, text, text, text) IS
  'Mints a free data-API key against a confirmed request: the argument is the sha256 of the single-use token mailed to the address that asked. '
  'Bounded per network, per domain and overall per day (a soft ceiling sheds networks that already minted today); three live keys per mailbox. service_role only.';

-- THE POOL THE OLD DOOR FILLED. Until this file, api_key_issue handed a
-- working free key to whoever typed an address, so a script may hold any
-- number of them, each with its own minute rate and daily quota. Every free
-- account-less key that no confirmed request stands behind is revoked. A key
-- minted through the confirmation flow always has one (issued_key_id), so if
-- the staged runner re-runs this file later, those keys are untouched. A key
-- bound to an account (user_id), and any key provisioned by hand in another
-- tier, is never touched. Holders get a new key from /data-api, behind their
-- mailbox, and the refusal they meet says so.
UPDATE public.api_keys ak
   SET revoked_at = now(),
       notes = 'revoked 20261004100000: a free key issued before keys needed a confirmed mailbox'
 WHERE ak.user_id IS NULL
   AND ak.tier = 'free'
   AND ak.revoked_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.api_key_requests kr WHERE kr.issued_key_id = ak.id);

-- AND IT CANNOT BE GATHERED AGAIN AND KEPT. A free account-less key nobody
-- has used for 30 days retires (last_used_at is stamped by api_key_check on
-- every allowed call), so the most a patient script can hold is what it
-- minted, through real mailboxes, in the last month and keeps using.
CREATE OR REPLACE FUNCTION public.api_key_retire_idle()
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH gone AS (
    UPDATE public.api_keys ak
       SET revoked_at = now(),
           notes = 'retired: a free key unused for 30 days'
     WHERE ak.user_id IS NULL
       AND ak.tier = 'free'
       AND ak.revoked_at IS NULL
       AND coalesce(ak.last_used_at, ak.created_at) < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

REVOKE ALL ON FUNCTION public.api_key_retire_idle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_retire_idle() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; api-key-retire-idle was not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api-key-retire-idle') THEN
    PERFORM cron.unschedule('api-key-retire-idle');
  END IF;
  PERFORM cron.schedule('api-key-retire-idle', '17 3 * * *', 'SELECT public.api_key_retire_idle()');
END $$;

-- ── 4. A count that lasts as long as it says ────────────────────────────────
-- The doors anyone can knock on (send-scan-report, the pulse sign-up and its
-- confirm) count per network, per recipient and per day. check_rate_limit
-- cannot hold a day: each of its calls has a 1% chance to delete every row
-- older than ITS OWN window, and its callers' windows run from 24 minutes to a
-- day, so a day-long count is wiped by the next short-window caller's sweep.
-- mail_door_take is one atomic upsert per count, and it sweeps only its own
-- door's expired rows, so no door can reset another.
CREATE TABLE IF NOT EXISTS public.mail_door_counts (
  door text NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (door, bucket)
);
ALTER TABLE public.mail_door_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mail_door_counts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mail_door_counts TO service_role;
COMMENT ON TABLE public.mail_door_counts IS
  'Fixed-window counters for the public mail doors. bucket is a keyed hash (of a network or a recipient) or a constant, never an address. Service-role only.';

CREATE OR REPLACE FUNCTION public.mail_door_take(
  p_door text,
  p_bucket text,
  p_max integer,
  p_window_minutes integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_hits integer;
  v_window interval;
BEGIN
  IF coalesce(length(p_door), 0) NOT BETWEEN 1 AND 64
     OR coalesce(length(p_bucket), 0) NOT BETWEEN 1 AND 64
     OR p_max IS NULL OR p_max NOT BETWEEN 1 AND 100000
     OR p_window_minutes IS NULL OR p_window_minutes NOT BETWEEN 1 AND 43200 THEN
    RAISE EXCEPTION 'mail_door_take: invalid arguments' USING ERRCODE = '22023';
  END IF;
  v_window := make_interval(mins => p_window_minutes);

  -- One statement counts: two concurrent knocks meet the same row lock, and
  -- the second sees the first's hit. A window that has ended starts again.
  INSERT INTO public.mail_door_counts AS c (door, bucket, window_start, hits)
  VALUES (p_door, p_bucket, now(), 1)
  ON CONFLICT (door, bucket) DO UPDATE
     SET hits = CASE WHEN c.window_start <= now() - v_window THEN 1 ELSE c.hits + 1 END,
         window_start = CASE WHEN c.window_start <= now() - v_window THEN now() ELSE c.window_start END
  RETURNING c.hits INTO v_hits;

  IF random() < 0.02 THEN
    DELETE FROM public.mail_door_counts c
     WHERE c.door = p_door AND c.window_start <= now() - v_window;
  END IF;

  RETURN v_hits <= p_max;
END;
$$;

COMMENT ON FUNCTION public.mail_door_take(text, text, integer, integer) IS
  'Counts one knock at a mail door and answers whether it is within p_max for the current p_window_minutes window. Atomic; sweeps only its own door. service_role only.';

REVOKE ALL ON FUNCTION public.mail_door_take(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_door_take(text, text, integer, integer) TO service_role;

-- ── 5. Self-verifying ────────────────────────────────────────────────────────
-- A copy the staged runner edited must not be able to report success: every
-- function is here, a definer with its search_path, closed to anon and
-- authenticated BY NAME and open to service_role; the old mint and the old
-- four-argument pulse request are gone; the request, subscriber and counter
-- tables are closed to client roles for every verb; the old door's free keys
-- are revoked; a door's count refuses the knock past its limit; the pulse
-- claim hands back ONLY a confirmed, unsuppressed, due row (run and rolled
-- back, so no real subscriber is touched); every email cron carries its key.
DO $$
DECLARE
  v_sig text;
  v_oid oid;
  v_n integer;
  v_cmd text;
  v_job text;
  v_tbl text;
  v_role text;
  v_priv text;
  v_claimed text[];
  v_probe_bad text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.email_cron_key_matches(text)',
    'public.market_pulse_request_confirm(text,text,integer,text,text)',
    'public.market_pulse_confirm(text)',
    'public.market_pulse_claim_batch(integer)',
    'public.search_digest_claim_batch(integer)',
    'public.agent_digest_claim_batch(integer)',
    'public.api_key_request_open(text,text,text,text)',
    'public.api_key_issue(text,text,text,text)',
    'public.api_key_retire_idle()',
    'public.api_key_mailbox(text)',
    'public.mail_door_take(text,text,integer,integer)'
  ] LOOP
    v_oid := to_regprocedure(v_sig)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'self-check: % is missing', v_sig;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by anon or authenticated', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is not executable by service_role', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
                    WHERE p.oid = v_oid AND c.setting LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'self-check: % has no search_path of its own', v_sig;
    END IF;
    IF v_sig <> 'public.api_key_mailbox(text)'
       AND NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false) THEN
      RAISE EXCEPTION 'self-check: % is not SECURITY DEFINER', v_sig;
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'api_key_issue';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'self-check: api_key_issue has % overloads, want exactly 1', v_n;
  END IF;
  IF (SELECT p.proargnames[1] FROM pg_proc p WHERE p.oid = to_regprocedure('public.api_key_issue(text,text,text,text)')::oid)
     IS DISTINCT FROM 'p_token_hash' THEN
    RAISE EXCEPTION 'self-check: api_key_issue does not take a confirmation token first; the address-taking mint survived';
  END IF;
  SELECT count(*)::integer INTO v_n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'market_pulse_request_confirm';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'self-check: market_pulse_request_confirm has % overloads, want exactly 1 (the one that takes the network)', v_n;
  END IF;

  IF public.api_key_mailbox(' Jane.Doe+news@GoogleMail.com ') <> 'janedoe@gmail.com'
     OR public.api_key_mailbox('dev+a@example.org') <> 'dev@example.org'
     OR public.api_key_mailbox('first.last@example.org') <> 'first.last@example.org' THEN
    RAISE EXCEPTION 'self-check: api_key_mailbox does not fold +tags and Gmail dots into one mailbox';
  END IF;

  SELECT count(*)::integer INTO v_n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname IN ('api_key_requests', 'mail_door_counts') AND c.relrowsecurity;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'self-check: api_key_requests or mail_door_counts is missing or has row level security off';
  END IF;
  -- Every verb, not only SELECT: a write grant a later edit added would be a
  -- grant nobody needs, whatever RLS does with it today.
  FOREACH v_tbl IN ARRAY ARRAY['public.api_key_requests', 'public.market_pulse_subscribers', 'public.mail_door_counts'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv) THEN
          RAISE EXCEPTION 'self-check: % holds % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- The counter counts: the first knock at a one-knock door is let in, the
  -- second is not, and the probe leaves no row behind.
  IF NOT public.mail_door_take('self-check:20261004100000', 'probe', 1, 1)
     OR public.mail_door_take('self-check:20261004100000', 'probe', 1, 1) THEN
    RAISE EXCEPTION 'self-check: mail_door_take does not refuse the knock past its limit';
  END IF;
  DELETE FROM public.mail_door_counts WHERE door = 'self-check:20261004100000';

  SELECT count(*)::integer INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'market_pulse_subscribers'
     AND column_name IN ('confirmed_at', 'confirm_token_hash', 'confirm_sent_at', 'confirm_sends', 'confirm_window_start', 'confirm_net');
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'self-check: market_pulse_subscribers has % of the 6 opt-in columns', v_n;
  END IF;

  -- THE CLAIM'S CONSENT FILTER, BY BEHAVIOUR. Three probe rows (one never
  -- confirmed, one confirmed but suppressed, one confirmed and due) and one
  -- claim: exactly the third must come back. Inside a block that always ends
  -- in an exception, so the probe rows, the suppression and any real row the
  -- claim stamped are all rolled back; only v_probe_bad survives.
  BEGIN
    INSERT INTO public.market_pulse_subscribers (email, industry, confirmed_at)
    VALUES ('0000000000-self-check-unconfirmed@probe.invalid', 'technology', NULL),
           ('0000000000-self-check-suppressed@probe.invalid', 'technology', now()),
           ('0000000000-self-check-due@probe.invalid', 'technology', now());
    INSERT INTO public.suppressed_emails (email, reason)
    VALUES ('0000000000-self-check-suppressed@probe.invalid', 'complaint');
    SELECT coalesce(array_agg(c.cl_email ORDER BY c.cl_email), '{}'::text[]) INTO v_claimed
      FROM public.market_pulse_claim_batch(200) c
     WHERE c.cl_email LIKE '0000000000-self-check-%';
    IF v_claimed IS DISTINCT FROM ARRAY['0000000000-self-check-due@probe.invalid'] THEN
      v_probe_bad := array_to_string(v_claimed, ', ');
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'self-check-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'self-check-rollback' THEN RAISE; END IF;
  END;
  IF v_probe_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check: market_pulse_claim_batch claimed [%]; it must claim only the confirmed, unsuppressed, due row', v_probe_bad;
  END IF;

  -- The old door's pool: no free account-less key is live without a
  -- confirmed request behind it.
  SELECT count(*)::integer INTO v_n
    FROM public.api_keys ak
   WHERE ak.user_id IS NULL AND ak.tier = 'free' AND ak.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.api_key_requests kr WHERE kr.issued_key_id = ak.id);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'self-check: % free keys minted without a confirmed mailbox are still live', v_n;
  END IF;

  -- Nested, not AND-ed: a condition naming vault.secrets is planned whole,
  -- and on a database without the vault that plan fails before the AND.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_cron_key') THEN
      RAISE EXCEPTION 'self-check: the vault exists but email_cron_key was not created';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'send-market-pulse';
    IF v_cmd IS NULL OR position('x-email-cron' IN v_cmd) = 0 OR position('email_cron_key' IN v_cmd) = 0 THEN
      RAISE EXCEPTION 'self-check: the send-market-pulse cron does not carry the email cron key: %', coalesce(v_cmd, '(no job)');
    END IF;
    -- A digest job may be absent (left so on purpose); one that exists
    -- carries the key, or its every run is refused.
    FOREACH v_job IN ARRAY ARRAY['send-search-digest', 'send-agent-digest'] LOOP
      v_cmd := NULL;
      SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = v_job;
      IF v_cmd IS NOT NULL AND (position('x-email-cron' IN v_cmd) = 0 OR position('email_cron_key' IN v_cmd) = 0) THEN
        RAISE EXCEPTION 'self-check: the % cron does not carry the email cron key: %', v_job, v_cmd;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'api-key-retire-idle'
                    AND position('api_key_retire_idle' IN j.command) > 0) THEN
      RAISE EXCEPTION 'self-check: the api-key-retire-idle cron is missing';
    END IF;
  END IF;
END $$;
