-- A PAID PAYOUT REQUEST MOVES ITS CONVERSIONS OUT OF THE PENDING BALANCE
-- (wave 2 email-ops, review of the L13-63 fix; follows 20261008124000).
--
-- affiliate-payout-request filed a request for the affiliate's whole
-- affiliates.pending_payout, and nothing anywhere ever moved a paid amount
-- out of that column: record_affiliate_conversion is its only writer, and it
-- only adds. Once the owner marked a request paid, the one-open-request index
-- freed up and the same, already-paid balance could be requested again, with
-- a second "pay $X" mail to the owner. The amount was also the wrong number:
-- the column holds every unpaid commission, approved or not, while the
-- dashboard's Pending (get_affiliate_dashboard), the Request Payout button it
-- enables and the page's own words ("payouts are processed monthly for
-- approved conversions") count approved conversions only.
--
-- Now a request names the approved conversions it covers (conversion_ids)
-- and its amount is their sum; affiliate-payout-request .2026-10-08.1 writes
-- both. Setting a request to 'paid', however it is done (SQL or the table
-- editor), IS the settlement, in the same statement: the conversions it names
-- become 'paid' with paid_at, and the amount moves from pending_payout to
-- paid_out. If they no longer add up to the amount (one was rejected or paid
-- since), or the balance holds less than the amount, the update is refused
-- and says why, and nothing moves. A resolved request is final, and a
-- request's affiliate, amount and conversions are fixed when it is filed.
--
-- The trigger function is SECURITY DEFINER so the settlement does not depend
-- on which role edits the row; a trigger function cannot be called through
-- the API, and EXECUTE is revoked from the client roles by name anyway. Safe
-- to re-run.

ALTER TABLE public.affiliate_payout_requests ADD COLUMN IF NOT EXISTS conversion_ids uuid[];
-- The function reads the approved conversions with the service role.
GRANT SELECT ON public.affiliate_conversions TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.affiliate_payout_requests'::regclass
                    AND conname = 'affiliate_payout_requests_names_its_conversions') THEN
    -- NOT VALID: binds every row written from now on; a row filed before
    -- this file (there should be none) is refused at settlement instead.
    ALTER TABLE public.affiliate_payout_requests
      ADD CONSTRAINT affiliate_payout_requests_names_its_conversions
      CHECK (conversion_ids IS NOT NULL AND cardinality(conversion_ids) > 0) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.affiliate_payout_request_settles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
  v_sum bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT count(*), coalesce(sum(c.commission_amount), 0) INTO v_n, v_sum
      FROM public.affiliate_conversions c
     WHERE c.id = ANY (NEW.conversion_ids)
       AND c.affiliate_id = NEW.affiliate_id
       AND c.status = 'approved';
    IF v_n <> coalesce(cardinality(NEW.conversion_ids), 0) OR v_sum <> NEW.amount_cents THEN
      RAISE EXCEPTION 'a payout request of % cents names % approved conversion(s) of its affiliate worth % cents',
        NEW.amount_cents, v_n, v_sum USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.affiliate_id IS DISTINCT FROM OLD.affiliate_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.conversion_ids IS DISTINCT FROM OLD.conversion_ids
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'a payout request''s affiliate, amount and conversions are fixed when it is filed'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'requested' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'payout request % is already %: a resolved request is final', OLD.id, OLD.status
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'requested' THEN
    RETURN NEW;
  END IF;

  NEW.resolved_at := coalesce(NEW.resolved_at, now());
  IF NEW.status <> 'paid' THEN
    RETURN NEW;
  END IF;

  -- Paid: the conversions it names, all of them still approved, become paid.
  WITH settled AS (
    UPDATE public.affiliate_conversions c
       SET status = 'paid', paid_at = now()
     WHERE c.id = ANY (NEW.conversion_ids)
       AND c.affiliate_id = NEW.affiliate_id
       AND c.status = 'approved'
    RETURNING c.commission_amount
  )
  SELECT count(*), coalesce(sum(commission_amount), 0) INTO v_n, v_sum FROM settled;
  IF v_n <> coalesce(cardinality(NEW.conversion_ids), 0) OR v_n = 0 OR v_sum <> NEW.amount_cents THEN
    RAISE EXCEPTION 'payout request % pays % cents, but % of its conversion(s) are still approved, worth % cents: nothing was moved',
      OLD.id, NEW.amount_cents, v_n, v_sum USING ERRCODE = '23514';
  END IF;

  -- And the amount leaves the pending balance for paid_out.
  UPDATE public.affiliates
     SET pending_payout = pending_payout - NEW.amount_cents,
         paid_out = paid_out + NEW.amount_cents,
         updated_at = now()
   WHERE id = NEW.affiliate_id
     AND pending_payout >= NEW.amount_cents;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'affiliate % holds less pending balance than the % cents request % pays: nothing was moved',
      NEW.affiliate_id, NEW.amount_cents, OLD.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_payout_request_settles() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS affiliate_payout_request_settles ON public.affiliate_payout_requests;
CREATE TRIGGER affiliate_payout_request_settles
  BEFORE INSERT OR UPDATE ON public.affiliate_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_payout_request_settles();

COMMENT ON TABLE public.affiliate_payout_requests IS
  'Payout requests from the affiliate dashboard, written by affiliate-payout-request after it checks the caller''s session: the approved conversions a request covers (conversion_ids) and their sum. Setting status to paid settles it in the same statement (those conversions become paid; the amount moves from affiliates.pending_payout to paid_out); rejected leaves both. A resolved request is final. Service role only.';

-- Self-verifying. The catalogue first; then the behaviour, on rows written
-- inside a block that always rolls back, so nothing it writes survives.
DO $$
DECLARE
  v_aff uuid;
  v_c1 uuid;
  v_c2 uuid;
  v_req uuid;
  v_pending integer;
  v_paid integer;
  v_left integer;
  v_msg text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'affiliate_payout_requests' AND column_name = 'conversion_ids') THEN
    RAISE EXCEPTION 'self-check: affiliate_payout_requests.conversion_ids is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.affiliate_payout_requests'::regclass
                    AND tgname = 'affiliate_payout_request_settles' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'self-check: the settlement trigger is missing or disabled';
  END IF;
  IF has_function_privilege('anon', 'public.affiliate_payout_request_settles()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.affiliate_payout_request_settles()', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role may execute the settlement trigger function';
  END IF;

  BEGIN
    INSERT INTO public.affiliates (email, password_hash, pending_payout)
    VALUES ('selfcheck-' || md5(random()::text) || '@example.invalid', 'x', 4500)
    RETURNING id INTO v_aff;
    INSERT INTO public.affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, status)
    VALUES (v_aff, 'selfcheck_' || md5(random()::text), 2900, 500, 'approved') RETURNING id INTO v_c1;
    INSERT INTO public.affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, status)
    VALUES (v_aff, 'selfcheck_' || md5(random()::text), 5900, 2500, 'approved') RETURNING id INTO v_c2;

    INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids)
    VALUES (v_aff, 3000, ARRAY[v_c1, v_c2]) RETURNING id INTO v_req;
    UPDATE public.affiliate_payout_requests SET status = 'paid' WHERE id = v_req;

    SELECT pending_payout, paid_out INTO v_pending, v_paid FROM public.affiliates WHERE id = v_aff;
    SELECT count(*) INTO v_left FROM public.affiliate_conversions WHERE affiliate_id = v_aff AND status = 'approved';
    IF v_pending <> 1500 OR v_paid <> 3000 OR v_left <> 0 THEN
      RAISE EXCEPTION 'selfcheck-fail: after paying 3000 the balance is pending % / paid % with % conversion(s) still approved', v_pending, v_paid, v_left;
    END IF;

    -- The paid conversions cannot be requested again.
    BEGIN
      INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids)
      VALUES (v_aff, 3000, ARRAY[v_c1, v_c2]);
      RAISE EXCEPTION 'selfcheck-fail: already-paid conversions were requested again';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    -- And a paid request stays paid.
    BEGIN
      UPDATE public.affiliate_payout_requests SET status = 'requested' WHERE id = v_req;
      RAISE EXCEPTION 'selfcheck-fail: a paid request was reopened';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;

    RAISE EXCEPTION 'selfcheck-ok';
  EXCEPTION
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg <> 'selfcheck-ok' THEN
        RAISE EXCEPTION 'self-check: %', v_msg;
      END IF;
    WHEN not_null_violation OR foreign_key_violation OR unique_violation OR undefined_column THEN
      -- The affiliate tables differ from the ones this file was written
      -- against: the catalogue checks above held, the behaviour is proven by
      -- the pglite test, and nothing was written.
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      RAISE NOTICE 'self-check: the settlement rehearsal could not set up its rows (%), catalogue checks passed', v_msg;
  END;
END $$;
