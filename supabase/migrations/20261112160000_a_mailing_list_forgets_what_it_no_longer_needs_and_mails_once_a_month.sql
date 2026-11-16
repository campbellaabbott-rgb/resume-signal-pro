-- SUB-HOURLY CRON REVIEW MARKER: not required. Every job this file schedules
-- runs once a day (reviewed 2026-11-16 in the bug round A integration).
--
-- A MAILING LIST FORGETS WHAT IT NO LONGER NEEDS, AND THE PULSE GOES ONCE A
-- CALENDAR MONTH (bug round 2026-11-08, lane mail: S14X-102, S14X-238).
--
-- 1. THE PULSE GOES AT MOST ONCE A CALENDAR MONTH (S14X-238).
--    market_pulse_claim_batch took any confirmed row 28 days after its last
--    pulse, and two jobs call it: the daily 'send-market-pulse' and, in
--    production, 'send-market-pulse-monthly' on the 1st. A pulse on the 1st
--    and the next on the 29th is two in one month, and a 28-day rhythm is
--    thirteen a year for a list that promises a monthly mail. It is re-issued
--    as (p_limit integer, p_now timestamptz DEFAULT now()): a row is claimed
--    when it has never had a pulse, or its last one is over 28 days old AND
--    fell in an earlier calendar month (UTC) than p_now. The one-argument form
--    is dropped in the same transaction; send-market-pulse's call, which
--    names p_limit alone, resolves to this one through the default. Granted
--    to service_role only, as before.
--
-- 2. A MAILING LIST FORGETS WHAT IT NO LONGER NEEDS (S14X-102).
--    mail_lists_prune(p_now timestamptz DEFAULT now()), service_role only,
--    run daily as 'mail-lists-prune' (the statement_timeout is set in the
--    job's own command, where the cron session honours it and get_cron_health
--    reads it):
--      - deletes pulse rows never confirmed whose last request
--        (coalesce(confirm_sent_at, subscribed_at)) is over 90 days old;
--      - deletes pulse rows unsubscribed over 90 days ago with no
--        confirmation sent in the last 90 days. 90 days is
--        market_pulse_request_confirm's three-per-90-day window, so a row
--        it could still count is never removed;
--      - deletes data-API key requests never confirmed whose link expired
--        over 90 days ago (every api_key_request_open link lasts a day or
--        less);
--      - writes 'withheld' over email_send_log.recipient_email (NOT NULL) on
--        rows over 90 days old, in batches of 5,000, at most 40 a run.
--    And once, here: rows already unsubscribed lose the score, the field and
--    the language they gave (send-market-pulse and account-settings now
--    clear all three at the stop; a new request writes them again).
--
-- Re-runnable: the overload is dropped IF EXISTS, the functions are CREATE OR
-- REPLACE, the job is scheduled by name, the one-off update matches nothing
-- the second time. The self-check at the end runs both functions on probe
-- rows dated in 1999 and 2000, inside a block that always rolls back.

-- ── 1. the claim ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.market_pulse_claim_batch(integer);

CREATE OR REPLACE FUNCTION public.market_pulse_claim_batch(p_limit integer, p_now timestamptz DEFAULT now())
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
       AND (s.last_sent_at IS NULL
            OR (s.last_sent_at < coalesce(p_now, now()) - interval '28 days'
                AND date_trunc('month', s.last_sent_at AT TIME ZONE 'UTC')
                    < date_trunc('month', coalesce(p_now, now()) AT TIME ZONE 'UTC')))
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails se WHERE lower(se.email) = lower(s.email))
     ORDER BY s.last_sent_at ASC NULLS FIRST, s.email
     LIMIT least(greatest(coalesce(p_limit, 0), 1), 200)
     FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE public.market_pulse_subscribers m
     SET last_sent_at = coalesce(p_now, now())
    FROM due
   WHERE m.email = due.d_email
  RETURNING m.email, m.industry, m.last_score, m.confirmed_at, due.d_prev;
$$;

REVOKE ALL ON FUNCTION public.market_pulse_claim_batch(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_pulse_claim_batch(integer, timestamptz) TO service_role;

COMMENT ON FUNCTION public.market_pulse_claim_batch(integer, timestamptz) IS
  'Claims up to p_limit confirmed, unsuppressed pulse rows that have never had a pulse, or whose last one is over 28 days old and in an earlier calendar month (UTC) than p_now; stamps them p_now in the same statement. At most one pulse a calendar month. S14X-238.';

-- ── 2. the prune ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mail_lists_prune(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cut constant timestamptz := coalesce(p_now, now()) - interval '90 days';
  v_unconfirmed integer := 0;
  v_unsubscribed integer := 0;
  v_requests integer := 0;
  v_withheld integer := 0;
  v_batch integer;
  v_round integer := 0;
BEGIN
  DELETE FROM public.market_pulse_subscribers s
   WHERE s.confirmed_at IS NULL
     AND coalesce(s.confirm_sent_at, s.subscribed_at) < v_cut;
  GET DIAGNOSTICS v_unconfirmed = ROW_COUNT;

  DELETE FROM public.market_pulse_subscribers s
   WHERE s.unsubscribed_at IS NOT NULL
     AND s.unsubscribed_at < v_cut
     AND (s.confirm_sent_at IS NULL OR s.confirm_sent_at < v_cut);
  GET DIAGNOSTICS v_unsubscribed = ROW_COUNT;

  DELETE FROM public.api_key_requests r
   WHERE r.confirmed_at IS NULL
     AND r.expires_at < v_cut;
  GET DIAGNOSTICS v_requests = ROW_COUNT;

  LOOP
    UPDATE public.email_send_log l
       SET recipient_email = 'withheld'
     WHERE l.id IN (SELECT x.id FROM public.email_send_log x
                     WHERE x.created_at < v_cut
                       AND x.recipient_email <> 'withheld'
                     LIMIT 5000);
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_withheld := v_withheld + v_batch;
    v_round := v_round + 1;
    EXIT WHEN v_batch < 5000 OR v_round >= 40;
  END LOOP;

  RETURN jsonb_build_object(
    'pulse_unconfirmed', v_unconfirmed,
    'pulse_unsubscribed', v_unsubscribed,
    'key_requests', v_requests,
    'send_log_withheld', v_withheld);
END;
$$;

REVOKE ALL ON FUNCTION public.mail_lists_prune(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_lists_prune(timestamptz) TO service_role;

COMMENT ON FUNCTION public.mail_lists_prune(timestamptz) IS
  'Daily (mail-lists-prune): deletes pulse rows unconfirmed for 90 days and rows unsubscribed 90 days ago with no confirmation sent since, unconfirmed data-API key requests expired 90 days ago, and withholds email_send_log recipients older than 90 days. S14X-102.';

-- ── 3. the job ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; mail-lists-prune is not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule('mail-lists-prune', '37 4 * * *',
    'SET statement_timeout = ''5min''; SELECT public.mail_lists_prune();');
END $$;

-- ── 4. once: the rows already off the list ──────────────────────────────
UPDATE public.market_pulse_subscribers
   SET last_score = NULL, locale = NULL, industry = 'general'
 WHERE unsubscribed_at IS NOT NULL
   AND (last_score IS NOT NULL OR locale IS NOT NULL OR industry IS DISTINCT FROM 'general');

-- ── SELF-CHECK ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_sig text;
  v_oid oid;
  v_n integer;
  v_args text;
  v_cmd text;
  v_claimed text[];
  v_left text[];
  v_bad text[] := ARRAY[]::text[];
  v_probe text;
BEGIN
  SELECT count(*)::integer, min(pg_get_function_identity_arguments(p.oid)) INTO v_n, v_args
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'market_pulse_claim_batch';
  IF v_n <> 1 OR v_args IS DISTINCT FROM 'p_limit integer, p_now timestamp with time zone' THEN
    v_bad := v_bad || format('market_pulse_claim_batch has %s overloads (%s); want exactly (p_limit integer, p_now timestamp with time zone)', v_n, coalesce(v_args, 'none'));
  END IF;

  FOREACH v_sig IN ARRAY ARRAY['public.market_pulse_claim_batch(integer,timestamptz)', 'public.mail_lists_prune(timestamptz)'] LOOP
    v_oid := to_regprocedure(v_sig)::oid;
    IF v_oid IS NULL THEN
      v_bad := v_bad || format('%s is missing', v_sig);
      CONTINUE;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad || format('%s is executable by anon or authenticated', v_sig);
    END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      v_bad := v_bad || format('%s is not executable by service_role', v_sig);
    END IF;
    IF NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false) THEN
      v_bad := v_bad || format('%s is not SECURITY DEFINER', v_sig);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
                    WHERE p.oid = v_oid AND c.setting LIKE 'search_path=%') THEN
      v_bad := v_bad || format('%s has no search_path of its own', v_sig);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'mail-lists-prune';
    IF v_cmd IS NULL THEN
      v_bad := v_bad || 'no mail-lists-prune job'::text;
    ELSIF v_cmd !~* '^[[:space:]]*SET[[:space:]]+statement_timeout[[:space:]]*=' OR position('public.mail_lists_prune()' IN v_cmd) = 0 THEN
      v_bad := v_bad || format('mail-lists-prune runs %s; it must set its statement_timeout first and call public.mail_lists_prune()', v_cmd);
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_n FROM public.market_pulse_subscribers
   WHERE unsubscribed_at IS NOT NULL AND (last_score IS NOT NULL OR locale IS NOT NULL);
  IF v_n <> 0 THEN
    v_bad := v_bad || format('%s unsubscribed pulse rows still hold a score or a language', v_n);
  END IF;

  -- BY BEHAVIOUR, inside a block that always ends in an exception, so every
  -- probe row, every parked row and every stamp is rolled back.
  BEGIN
    -- The claim: every real row is parked first, so the 200-row limit is
    -- spent on the probes alone.
    UPDATE public.market_pulse_subscribers SET unsubscribed_at = coalesce(unsubscribed_at, now())
     WHERE email NOT LIKE '0000000000-self-check-%';
    INSERT INTO public.market_pulse_subscribers (email, industry, confirmed_at, last_sent_at)
    VALUES ('0000000000-self-check-same-month@probe.invalid', 'technology', '2000-01-01', '2000-03-01 12:00+00'),
           ('0000000000-self-check-last-month@probe.invalid', 'technology', '2000-01-01', '2000-02-27 12:00+00'),
           ('0000000000-self-check-never@probe.invalid', 'technology', '2000-01-01', NULL);
    SELECT coalesce(array_agg(c.cl_email ORDER BY c.cl_email), '{}'::text[]) INTO v_claimed
      FROM public.market_pulse_claim_batch(200, '2000-03-30 12:00+00') c;
    IF v_claimed IS DISTINCT FROM ARRAY['0000000000-self-check-last-month@probe.invalid', '0000000000-self-check-never@probe.invalid'] THEN
      v_probe := format('the claim on 2000-03-30 took [%s]; it must take the row last sent 2000-02-27 and the row never sent, never the one sent 2000-03-01', array_to_string(v_claimed, ', '));
    END IF;

    -- The prune, on 2000-01-01 (cut 1999-10-03): only rows dated before the
    -- cut can be touched, and no real row is that old.
    IF v_probe IS NULL THEN
      INSERT INTO public.market_pulse_subscribers (email, industry, subscribed_at, confirm_sent_at, confirmed_at, unsubscribed_at)
      VALUES ('0000000000-self-check-unconfirmed-old@probe.invalid', 'general', '1999-09-01', '1999-09-01', NULL, NULL),
             ('0000000000-self-check-unconfirmed-new@probe.invalid', 'general', '1999-12-01', '1999-12-01', NULL, NULL),
             ('0000000000-self-check-off-old@probe.invalid', 'general', '1999-01-01', '1999-01-01', '1999-01-02', '1999-09-01'),
             ('0000000000-self-check-off-asked-again@probe.invalid', 'general', '1999-01-01', '1999-12-20', '1999-01-02', '1999-09-01');
      INSERT INTO public.email_send_log (template_name, recipient_email, status, created_at)
      VALUES ('self-check', '0000000000-self-check-log-old@probe.invalid', 'sent', '1999-09-01'),
             ('self-check', '0000000000-self-check-log-new@probe.invalid', 'sent', '1999-12-15');
      INSERT INTO public.api_key_requests (email, mailbox, token_hash, created_at, expires_at, confirmed_at)
      VALUES ('0000000000-self-check-key-old@probe.invalid', '0000000000-self-check-key-old@probe.invalid', '0000000000-self-check-key-old', '1999-09-01', '1999-09-02', NULL),
             ('0000000000-self-check-key-used@probe.invalid', '0000000000-self-check-key-used@probe.invalid', '0000000000-self-check-key-used', '1999-09-01', '1999-09-02', '1999-09-01 01:00+00');
      PERFORM public.mail_lists_prune('2000-01-01 00:00+00');
      SELECT coalesce(array_agg(s.email ORDER BY s.email), '{}'::text[]) INTO v_left
        FROM public.market_pulse_subscribers s
       WHERE s.email LIKE '0000000000-self-check-%' AND s.subscribed_at < '2000-01-01';
      IF v_left IS DISTINCT FROM ARRAY['0000000000-self-check-off-asked-again@probe.invalid', '0000000000-self-check-unconfirmed-new@probe.invalid'] THEN
        v_probe := format('the prune on 2000-01-01 left pulse rows [%s]; it must keep only the fresh request and the one asked again', array_to_string(v_left, ', '));
      ELSIF EXISTS (SELECT 1 FROM public.api_key_requests WHERE token_hash = '0000000000-self-check-key-old')
         OR NOT EXISTS (SELECT 1 FROM public.api_key_requests WHERE token_hash = '0000000000-self-check-key-used') THEN
        v_probe := 'the prune kept the unconfirmed key request that expired 1999-09-02, or deleted the confirmed one';
      ELSIF EXISTS (SELECT 1 FROM public.email_send_log WHERE recipient_email = '0000000000-self-check-log-old@probe.invalid')
         OR NOT EXISTS (SELECT 1 FROM public.email_send_log WHERE recipient_email = '0000000000-self-check-log-new@probe.invalid') THEN
        v_probe := 'the prune did not withhold the 1999-09-01 send-log recipient, or withheld the 1999-12-15 one';
      END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'self-check-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'self-check-rollback' THEN RAISE; END IF;
  END;
  IF v_probe IS NOT NULL THEN
    v_bad := v_bad || v_probe;
  END IF;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'S14X-102/S14X-238 self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'the pulse goes once a calendar month, and the mailing lists forget what they no longer need';
END $$;

NOTIFY pgrst, 'reload schema';
