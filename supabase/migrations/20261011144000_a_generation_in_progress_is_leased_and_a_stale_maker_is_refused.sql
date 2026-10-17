-- A GENERATION IN PROGRESS IS LEASED, AND A STALE MAKER IS REFUSED.
--
-- WHAT WAS WRONG (critical-path plan 2026-10-12, CP-019 and its review note;
-- CP-C items 1 and 2). Three makers can work one paid order: the webhook
-- (which claims the Stripe session and generates in the background), the
-- success page's verifier (which generates when the webhook was late or
-- died) and the retry sweep (which takes a 'generating' row fifteen minutes
-- after it started). Nothing told them apart. A maker whose isolate outlived
-- the sweep's fifteen minutes still saved its copy, wrote 'content_generated'
-- and mailed the buyer after the sweep had already made and mailed the same
-- order: two model runs and two mails for one purchase, and the row's
-- history overwritten by whichever writer came last. 20261011140000 stops a
-- closed order from reopening; this stops two open makers from both
-- finishing.
--
-- THE RULE NOW. A maker takes a LEASE on the order before it makes anything:
-- take_delivery_lease moves the row to 'generating' and hands back a token
-- that lives ten minutes (longer than any edge isolate). While the lease is
-- live nobody else can take it (NULL: the other maker answers "in progress"
-- and makes nothing). When it has expired, the sweep or the verifier reclaims
-- the row with a NEW token. The finish (finish_delivery_generation) and the
-- failure record (update_delivery_retry) carry the token: a write whose token
-- is not the row's current one is refused, so a maker that finished late
-- keeps its saved copy, mails nobody, and the row stays with the maker that
-- holds it. The success page records a failed generation through its own
-- step writer (log_delivery_step, unchanged) and then gives the lease back by
-- its token (release_delivery_lease). A row with no live lease accepts a
-- tokenless failure record as before (the writers that never lease: the Full
-- Analysis page and the Freelance intake).
--
-- The retry sweep already selects a 'generating' row only fifteen minutes
-- after it started (20261009140000), which is after the lease has expired, so
-- it reclaims only expired leases; the token is what keeps a late first maker
-- out once it has.
--
-- Apply BEFORE stripe-webhook, verify-product-purchase and
-- retry-failed-deliveries 2026-10-11.22 (they call the two new functions and
-- name p_lease_token, which no older function takes; the ledger's default
-- order runs migrations before functions). The old four-argument retry
-- recorder is found in the catalogue and dropped, so its callers resolve to
-- this one with p_lease_token NULL. Safe to re-run.

SET LOCAL statement_timeout = '2min';

ALTER TABLE public.product_deliveries ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.product_deliveries ADD COLUMN IF NOT EXISTS lease_until timestamptz;

COMMENT ON COLUMN public.product_deliveries.lease_token IS
  'The token of the maker that holds this order while it is generated (take_delivery_lease); every finish and failure write must carry it while lease_until is in the future. 20261011144000.';
COMMENT ON COLUMN public.product_deliveries.lease_until IS
  'When the maker''s lease expires (ten minutes from take_delivery_lease): a row past it may be reclaimed. 20261011144000.';

-- THE LEASE. The row must be in the status the maker saw and hold no live
-- lease, and must not be closed (delivered, refunded, or mailed from its
-- copy). A row that does not exist yet (the claim landed but the webhook's
-- own insert failed) is created, so the maker is never told "in progress"
-- about an order nobody holds.
CREATE OR REPLACE FUNCTION public.take_delivery_lease(
  p_stripe_session_id text,
  p_seen_status text,
  p_minutes integer DEFAULT 10,
  p_product_type text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.product_deliveries%ROWTYPE;
  v_token uuid := gen_random_uuid();
  v_mins  integer := GREATEST(COALESCE(p_minutes, 10), 1);
BEGIN
  IF p_stripe_session_id IS NULL OR p_stripe_session_id = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM public.product_deliveries
   WHERE stripe_session_id = p_stripe_session_id
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.product_deliveries (stripe_session_id, status, product_type, customer_email,
                                           content_generation_started_at, lease_token, lease_until)
    VALUES (p_stripe_session_id, 'generating', COALESCE(NULLIF(p_product_type, ''), 'unknown'), NULLIF(p_email, ''),
            now(), v_token, now() + make_interval(mins => v_mins));
    RETURN v_token;
  END IF;

  -- Closed orders are never leased (20261011140000 refuses the move anyway).
  IF v_row.status IN ('delivered', 'refunded') OR v_row.email_sent_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- The order moved since the maker read it: somebody else is on it.
  IF v_row.status IS DISTINCT FROM p_seen_status THEN
    RETURN NULL;
  END IF;
  -- A live lease belongs to another maker.
  IF v_row.lease_until IS NOT NULL AND v_row.lease_until > now() THEN
    RETURN NULL;
  END IF;

  UPDATE public.product_deliveries
     SET status = 'generating',
         content_generation_started_at = now(),
         lease_token = v_token,
         lease_until = now() + make_interval(mins => v_mins)
   WHERE id = v_row.id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.take_delivery_lease(text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_delivery_lease(text, text, integer, text, text) TO service_role;

COMMENT ON FUNCTION public.take_delivery_lease(text, text, integer, text, text) IS
  'A maker takes the order: the row (created when missing) must be in p_seen_status, not closed and under no live lease; '
  'it becomes generating with a fresh lease_token good for p_minutes (default 10), which is returned. NULL when refused. '
  'service_role only. 20261011144000.';

-- THE FINISH. Only the maker holding the lease may record that the order was
-- made; its token is checked against the row's and the lease is released.
-- false when the row is held by another maker, moved, or closed: the caller
-- keeps its saved copy and mails nobody.
CREATE OR REPLACE FUNCTION public.finish_delivery_generation(
  p_stripe_session_id text,
  p_lease_token uuid,
  p_status text DEFAULT 'content_generated',
  p_duration_ms integer DEFAULT NULL,
  p_model text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lease_token IS NULL THEN
    RETURN false;
  END IF;
  IF p_status NOT IN ('content_generated', 'generated') THEN
    RAISE EXCEPTION 'finish_delivery_generation: % is not a made-order status', p_status;
  END IF;
  UPDATE public.product_deliveries
     SET status = p_status,
         generation_success = true,
         ai_response_valid = true,
         ai_parse_error = NULL,
         generation_error = NULL,
         content_generation_completed_at = now(),
         generation_duration_ms = COALESCE(p_duration_ms, generation_duration_ms),
         ai_model_used = COALESCE(p_model, ai_model_used),
         lease_token = NULL,
         lease_until = NULL
   WHERE stripe_session_id = p_stripe_session_id
     AND status = 'generating'
     AND lease_token = p_lease_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_delivery_generation(text, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_delivery_generation(text, uuid, text, integer, text) TO service_role;

COMMENT ON FUNCTION public.finish_delivery_generation(text, uuid, text, integer, text) IS
  'The maker holding the lease records the order as made (content_generated, or generated for the success page) and the '
  'lease is released; false when the token is not the row''s current one or the row is no longer generating, so a late '
  'maker mails nobody. service_role only. 20261011144000.';

-- THE FAILURE RECORD, now carrying the token. Every other overload is found
-- in the catalogue and dropped first (PostgREST refuses two candidates), so
-- the four-argument calls of the writers that never lease resolve here with
-- p_lease_token NULL.
DO $drop_retry$
DECLARE
  keep CONSTANT text := 'p_id uuid, p_status text, p_error text, p_increment_retry boolean, p_lease_token uuid';
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'update_delivery_retry'
       AND pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM keep
  LOOP
    RAISE NOTICE 'dropping update_delivery_retry overload %', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END
$drop_retry$;

CREATE OR REPLACE FUNCTION public.update_delivery_retry(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_increment_retry boolean DEFAULT false,
  p_lease_token uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.product_deliveries%ROWTYPE;
  v_retry integer;
  v_transient integer;
  v_step integer;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_row FROM public.product_deliveries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Another maker holds this order: a late failure from the one that lost
  -- its lease is not this order's failure.
  IF v_row.lease_until IS NOT NULL AND v_row.lease_until > now()
     AND v_row.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN false;
  END IF;

  IF NOT p_increment_retry THEN
    UPDATE public.product_deliveries
       SET status = p_status,
           last_retry_error = COALESCE(p_error, last_retry_error),
           next_retry_at = NULL,
           lease_token = NULL,
           lease_until = NULL
     WHERE id = p_id;
    RETURN true;
  END IF;

  v_retry := v_row.retry_count;
  v_transient := v_row.transient_failures;
  IF v_row.created_at <= now() - interval '24 hours' THEN
    -- The day is over: the résumé is gone, so no retry can work.
    v_retry := GREATEST(v_row.max_retries, v_retry + 1);
  ELSIF public.delivery_error_is_transient(p_error) THEN
    v_transient := v_transient + 1;
  ELSE
    v_retry := v_retry + 1;
  END IF;

  -- The schedule follows every failure, counted or not.
  v_step := v_retry + v_transient;
  v_next := now() + CASE LEAST(v_step, 7)
    WHEN 1 THEN interval '5 minutes'
    WHEN 2 THEN interval '15 minutes'
    WHEN 3 THEN interval '1 hour'
    WHEN 4 THEN interval '2 hours'
    WHEN 5 THEN interval '4 hours'
    WHEN 6 THEN interval '6 hours'
    ELSE interval '8 hours'
  END;
  -- A try that would land after the résumé's day spends the row now.
  IF v_retry >= v_row.max_retries OR v_next > v_row.created_at + interval '24 hours' THEN
    v_retry := GREATEST(v_retry, v_row.max_retries);
    v_next := NULL;
  END IF;

  UPDATE public.product_deliveries
     SET status = p_status,
         last_retry_error = COALESCE(p_error, last_retry_error),
         retry_count = v_retry,
         transient_failures = v_transient,
         next_retry_at = v_next,
         lease_token = NULL,
         lease_until = NULL
   WHERE id = p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_delivery_retry(uuid, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_delivery_retry(uuid, text, text, boolean, uuid) TO service_role;

COMMENT ON FUNCTION public.update_delivery_retry(uuid, text, text, boolean, uuid) IS
  'Records a failed delivery attempt and releases the lease: a transient error (delivery_error_is_transient) adds to '
  'transient_failures, any other to retry_count; the next try waits 5m, 15m, 1h, 2h, 4h, 6h, 8h by failure; a try past '
  '24 hours after the purchase spends the row. Refused (false) while another maker holds a live lease whose token this '
  'write does not carry. S11-014 (20261009134100), 20261011144000. service_role only.';

-- THE RELEASE, for the maker whose generation ended in a failure it records
-- through another writer (the success page records through log_delivery_step,
-- which knows nothing of leases): the lease is given back only by its token.
CREATE OR REPLACE FUNCTION public.release_delivery_lease(
  p_stripe_session_id text,
  p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_lease_token IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.product_deliveries
     SET lease_token = NULL,
         lease_until = NULL
   WHERE stripe_session_id = p_stripe_session_id
     AND lease_token = p_lease_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.release_delivery_lease(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_delivery_lease(text, uuid) TO service_role;

COMMENT ON FUNCTION public.release_delivery_lease(text, uuid) IS
  'The maker holding the lease gives it back (after recording a failure through a writer that does not carry the token); '
  'false when the token is not the row''s current one. service_role only. 20261011144000.';

-- Self-verifying: the columns and the four functions exist with one
-- signature each, closed to the client roles; and on probe rows (rolled back)
-- a lease is taken once, refused while live, finished only by its token,
-- reclaimed once expired with the first maker then refused; a late failure
-- is refused while another maker holds the row and lands otherwise; a closed
-- order is never leased; the lease is released only by its token; a missing
-- row is created.
DO $verify$
DECLARE
  v_bad      text[] := ARRAY[]::text[];
  v_n        integer;
  v_sid      constant text := 'cs_selfcheck_144000_leased';
  v_id       uuid;
  v_t1       uuid;
  v_t2       uuid;
  v_t3       uuid;
  v_ok       boolean;
  v_status   text;
  v_ptype    text;
  v_lease    uuid;
  v_until    timestamptz;
  v_retry    integer;
  v_sentinel constant text := 'lease probe: rolled back';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_deliveries' AND column_name = 'lease_token')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_deliveries' AND column_name = 'lease_until') THEN
    RAISE EXCEPTION 'product_deliveries has no lease columns after this file';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'update_delivery_retry';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one update_delivery_retry, found % overloads', v_n;
  END IF;
  IF to_regprocedure('public.update_delivery_retry(uuid,text,text,boolean,uuid)') IS NULL THEN
    RAISE EXCEPTION 'update_delivery_retry does not take p_lease_token after this file';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN ('take_delivery_lease', 'finish_delivery_generation', 'release_delivery_lease');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'expected take_delivery_lease, finish_delivery_generation and release_delivery_lease once each, found % functions', v_n;
  END IF;

  IF has_function_privilege('anon', 'public.take_delivery_lease(text,text,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.take_delivery_lease(text,text,integer,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.finish_delivery_generation(text,uuid,text,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finish_delivery_generation(text,uuid,text,integer,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_delivery_lease(text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.release_delivery_lease(text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_delivery_retry(uuid,text,text,boolean,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.update_delivery_retry(uuid,text,text,boolean,uuid)', 'EXECUTE') THEN
    v_bad := v_bad || 'a lease function is executable by a client role'::text;
  END IF;
  IF NOT has_function_privilege('service_role', 'public.take_delivery_lease(text,text,integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.finish_delivery_generation(text,uuid,text,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.release_delivery_lease(text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.update_delivery_retry(uuid,text,text,boolean,uuid)', 'EXECUTE') THEN
    v_bad := v_bad || 'the service role cannot run a lease function'::text;
  END IF;

  BEGIN
    -- A paid order the webhook wrote.
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status)
      VALUES (v_sid, 'cover_letter', 'payment_received') RETURNING id INTO v_id;

    -- Taken once; refused while live (by a second maker that saw payment_received, and by one that saw generating).
    v_t1 := public.take_delivery_lease(v_sid, 'payment_received');
    IF v_t1 IS NULL THEN v_bad := v_bad || 'the first maker could not take the lease'::text; END IF;
    SELECT status, lease_token, lease_until INTO v_status, v_lease, v_until FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'generating' OR v_lease IS DISTINCT FROM v_t1 OR v_until IS NULL OR v_until <= now() + interval '9 minutes' THEN
      v_bad := v_bad || format('the lease did not land (%s, token match %s, until %s)', v_status, v_lease IS NOT DISTINCT FROM v_t1, v_until);
    END IF;
    IF public.take_delivery_lease(v_sid, 'payment_received') IS NOT NULL THEN v_bad := v_bad || 'a maker that saw the old status took a live lease'::text; END IF;
    IF public.take_delivery_lease(v_sid, 'generating') IS NOT NULL THEN v_bad := v_bad || 'a second maker took a live lease'::text; END IF;

    -- Finished only by its token.
    IF public.finish_delivery_generation(v_sid, gen_random_uuid()) THEN v_bad := v_bad || 'a stranger''s token finished the order'::text; END IF;
    IF public.finish_delivery_generation(v_sid, NULL) THEN v_bad := v_bad || 'a finish with no token landed'::text; END IF;
    IF NOT public.finish_delivery_generation(v_sid, v_t1, 'content_generated', 1234, 'probe-model') THEN v_bad := v_bad || 'the holder could not finish'::text; END IF;
    SELECT status, lease_token, lease_until INTO v_status, v_lease, v_until FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'content_generated' OR v_lease IS NOT NULL OR v_until IS NOT NULL THEN
      v_bad := v_bad || format('the finish did not land or did not release the lease (%s)', v_status);
    END IF;
    IF public.finish_delivery_generation(v_sid, v_t1) THEN v_bad := v_bad || 'a finished order was finished again'::text; END IF;

    -- The reclaim: a lease that expired is taken by the sweep with a new token, and the first maker is refused.
    UPDATE public.product_deliveries SET status = 'generating', lease_token = v_t1, lease_until = now() - interval '1 minute' WHERE id = v_id;
    v_t2 := public.take_delivery_lease(v_sid, 'generating');
    IF v_t2 IS NULL OR v_t2 = v_t1 THEN v_bad := v_bad || 'an expired lease was not reclaimed with a new token'::text; END IF;
    IF public.finish_delivery_generation(v_sid, v_t1) THEN v_bad := v_bad || 'the first maker finished an order the sweep had reclaimed'::text; END IF;
    IF public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 500', true, v_t1) THEN
      v_bad := v_bad || 'the first maker''s late failure landed on an order the sweep holds'::text;
    END IF;
    IF public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 500', true) THEN
      v_bad := v_bad || 'a tokenless failure landed on an order a maker holds'::text;
    END IF;
    SELECT status, retry_count, lease_token INTO v_status, v_retry, v_lease FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'generating' OR v_retry <> 0 OR v_lease IS DISTINCT FROM v_t2 THEN
      v_bad := v_bad || format('a refused failure still changed the row (%s, retries %s)', v_status, v_retry);
    END IF;
    -- The holder's failure lands and releases the lease; a tokenless one lands once nobody holds the row.
    IF NOT public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 400 - bad request', true, v_t2) THEN
      v_bad := v_bad || 'the holder could not record its failure'::text;
    END IF;
    SELECT status, retry_count, lease_token, lease_until INTO v_status, v_retry, v_lease, v_until FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'generation_failed' OR v_retry <> 1 OR v_lease IS NOT NULL OR v_until IS NOT NULL THEN
      v_bad := v_bad || format('the holder''s failure did not land or did not release the lease (%s, retries %s)', v_status, v_retry);
    END IF;
    IF NOT public.update_delivery_retry(v_id, 'generation_failed', 'Generation failed: 400 - bad request', true) THEN
      v_bad := v_bad || 'a tokenless failure was refused on an order nobody holds'::text;
    END IF;
    -- Taken again from generation_failed (the sweep's next try).
    v_t3 := public.take_delivery_lease(v_sid, 'generation_failed');
    IF v_t3 IS NULL THEN v_bad := v_bad || 'a failed order could not be leased for its next try'::text; END IF;
    IF NOT public.finish_delivery_generation(v_sid, v_t3, 'generated') THEN v_bad := v_bad || 'the success page''s finish was refused'::text; END IF;
    SELECT status INTO v_status FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'generated' THEN v_bad := v_bad || format('the success page''s finish wrote %s', v_status); END IF;

    -- The lease is given back only by its token.
    UPDATE public.product_deliveries SET status = 'payment_received', email_sent_at = NULL WHERE id = v_id;
    v_t3 := public.take_delivery_lease(v_sid, 'payment_received');
    IF public.release_delivery_lease(v_sid, gen_random_uuid()) THEN v_bad := v_bad || 'a stranger''s token released the lease'::text; END IF;
    IF public.release_delivery_lease(v_sid, NULL) THEN v_bad := v_bad || 'a release with no token landed'::text; END IF;
    SELECT lease_token INTO v_lease FROM public.product_deliveries WHERE id = v_id;
    IF v_lease IS DISTINCT FROM v_t3 THEN v_bad := v_bad || 'a refused release still cleared the lease'::text; END IF;
    IF NOT public.release_delivery_lease(v_sid, v_t3) THEN v_bad := v_bad || 'the holder could not release its lease'::text; END IF;
    SELECT status, lease_token, lease_until INTO v_status, v_lease, v_until FROM public.product_deliveries WHERE id = v_id;
    IF v_status <> 'generating' OR v_lease IS NOT NULL OR v_until IS NOT NULL THEN
      v_bad := v_bad || 'the release did not clear the lease, or changed the status'::text;
    END IF;
    IF public.take_delivery_lease(v_sid, 'generating') IS NULL THEN v_bad := v_bad || 'a released row could not be leased again'::text; END IF;

    -- Closed orders are never leased.
    UPDATE public.product_deliveries SET status = 'delivered' WHERE id = v_id;
    IF public.take_delivery_lease(v_sid, 'delivered') IS NOT NULL THEN v_bad := v_bad || 'a delivered order was leased'::text; END IF;
    UPDATE public.product_deliveries SET status = 'refunded' WHERE id = v_id;
    IF public.take_delivery_lease(v_sid, 'refunded') IS NOT NULL THEN v_bad := v_bad || 'a refunded order was leased'::text; END IF;
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, email_sent_at)
      VALUES ('cs_selfcheck_144000_mailed', 'cover_letter', 'content_generated', now());
    IF public.take_delivery_lease('cs_selfcheck_144000_mailed', 'content_generated') IS NOT NULL THEN
      v_bad := v_bad || 'a mailed order was leased'::text;
    END IF;

    -- A row nobody wrote is created by the maker.
    v_t3 := public.take_delivery_lease('cs_selfcheck_144000_missing', 'payment_received', 10, 'cover_letter', 'probe@example.invalid');
    SELECT status, product_type INTO v_status, v_ptype FROM public.product_deliveries WHERE stripe_session_id = 'cs_selfcheck_144000_missing';
    IF v_t3 IS NULL OR v_status IS DISTINCT FROM 'generating' OR v_ptype IS DISTINCT FROM 'cover_letter' THEN
      v_bad := v_bad || 'a missing row was not created by the lease'::text;
    END IF;

    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_bad := v_bad || ('the probe could not run: ' || SQLERRM);
    END IF;
  END;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'delivery-lease self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'self-verify 20261011144000: a generation is leased for ten minutes, finished or released only by its token, reclaimed once expired, and a stale maker is refused';
END
$verify$;
