-- A SALE THE SUCCESS PAGE CLAIMS FIRST LEAVES A DELIVERY RECORD, AND THE
-- SWEEPER WAITS FOR THE WEBHOOK BEFORE IT RETRIES ONE.
--
-- 1. log_delivery_step could not create the row it logs to (platform sweep
--    L6-26, register 2.04). Its get-or-create branch ran
--      INSERT INTO product_deliveries (stripe_session_id, status)
--    while product_type is TEXT NOT NULL, so the insert raised 23502 and
--    verify-product-purchase, which never read the RPC's error, carried on.
--    That branch is the ONLY writer for a sale the success page claims before
--    the webhook does -- every Pro grant, and any purchase the webhook was
--    late for -- because the webhook then answers alreadyProcessed. Those
--    sales left no delivery record at all: no monitor saw them and the retry
--    sweeper could not retry them. The insert now carries the product type
--    (from p_metadata, 'unknown' when absent -- the webhook's own default)
--    and the buyer's address.
--
--    And the row now keeps what the sweeper needs to finish the sale. The
--    'payment_received' step wrote p_metadata into the row's columns and
--    dropped the rest, so a row the success page created had no metadata:
--    the sweeper re-credited a failed 50-credit pack with its default of 10
--    and had no resume_session_id to regenerate a product from (2026-10-05
--    review). That step now merges every OTHER key of p_metadata (credits,
--    resume_session_id, job_title, job_company, language, referral_code --
--    the keys the webhook writes on its own row) into metadata, nulls
--    dropped. Same signature, same body otherwise.
--
-- 2. get_failed_deliveries_for_retry picked up a 'payment_received' row the
--    moment it existed. The webhook writes that row and then generates for up
--    to ~90 seconds; a sweep landing in that window regenerated the same
--    product (twice the model spend, two emails) or stamped a sale the
--    webhook was about to deliver as failed. A payment_received row is now
--    picked up only once it is ten minutes old. The gate on next_retry_at and
--    the statuses it selects are unchanged -- rows written with next_retry_at
--    'infinity' (the full analysis, the Freelance Boost tiers) stay off the
--    queue, and retry-failed-deliveries takes rows it cannot deliver off the
--    schedule with the reason written down (L6-27). Same signature and
--    return shape, so CREATE OR REPLACE keeps every grant.
--
-- Both stay service-role only (20260730070000), re-stated BY NAME below.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.log_delivery_step(
  p_stripe_session_id TEXT,
  p_step TEXT,
  p_success BOOLEAN DEFAULT true,
  p_error TEXT DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery_id UUID;
BEGIN
  -- Get or create delivery record
  SELECT id INTO v_delivery_id
  FROM product_deliveries
  WHERE stripe_session_id = p_stripe_session_id;

  IF v_delivery_id IS NULL THEN
    -- product_type is NOT NULL: a row written without it was never written.
    INSERT INTO product_deliveries (stripe_session_id, status, product_type, customer_email)
    VALUES (
      p_stripe_session_id,
      p_step,
      COALESCE(NULLIF(p_metadata->>'product_type', ''), 'unknown'),
      NULLIF(p_metadata->>'email', '')
    )
    RETURNING id INTO v_delivery_id;
  END IF;

  -- Update based on step
  CASE p_step
    WHEN 'payment_received' THEN
      UPDATE product_deliveries SET
        payment_completed_at = now(),
        customer_email = COALESCE((p_metadata->>'email')::TEXT, customer_email),
        product_type = COALESCE((p_metadata->>'product_type')::TEXT, product_type),
        product_name = COALESCE((p_metadata->>'product_name')::TEXT, product_name),
        amount_cents = COALESCE((p_metadata->>'amount_cents')::INTEGER, amount_cents),
        -- Everything that is not a column above: what the sweeper reads.
        metadata = COALESCE(metadata, '{}'::JSONB)
          || jsonb_strip_nulls(COALESCE(p_metadata, '{}'::JSONB) - 'email' - 'product_type' - 'product_name' - 'amount_cents'),
        status = 'payment_received'
      WHERE id = v_delivery_id;

    WHEN 'generation_started' THEN
      UPDATE product_deliveries SET
        content_generation_started_at = now(),
        status = 'generating'
      WHERE id = v_delivery_id;

    WHEN 'generation_completed' THEN
      UPDATE product_deliveries SET
        content_generation_completed_at = now(),
        generation_success = p_success,
        generation_error = p_error,
        generation_duration_ms = p_duration_ms,
        ai_response_valid = p_success,
        ai_parse_error = CASE WHEN NOT p_success THEN p_error ELSE NULL END,
        status = CASE WHEN p_success THEN 'generated' ELSE 'generation_failed' END
      WHERE id = v_delivery_id;

    WHEN 'email_sent' THEN
      UPDATE product_deliveries SET
        email_sent_at = now(),
        email_success = p_success,
        email_error = p_error,
        status = CASE WHEN p_success THEN 'delivered' ELSE 'email_failed' END
      WHERE id = v_delivery_id;

    ELSE
      UPDATE product_deliveries SET
        status = p_step,
        metadata = COALESCE(metadata, '{}'::JSONB) || COALESCE(p_metadata, '{}'::JSONB)
      WHERE id = v_delivery_id;
  END CASE;

  RETURN v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_delivery_step(text, text, boolean, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_delivery_step(text, text, boolean, text, integer, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_failed_deliveries_for_retry(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  stripe_session_id text,
  product_type text,
  product_name text,
  customer_email text,
  status text,
  retry_count integer,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pd.id,
    pd.stripe_session_id,
    pd.product_type,
    pd.product_name,
    pd.customer_email,
    pd.status,
    pd.retry_count,
    pd.metadata
  FROM product_deliveries pd
  WHERE pd.status IN ('payment_received', 'generation_failed', 'email_failed')
    AND pd.retry_count < pd.max_retries
    AND (pd.next_retry_at IS NULL OR pd.next_retry_at <= now())
    -- The webhook may still be generating a row it wrote moments ago.
    AND (pd.status <> 'payment_received' OR pd.created_at <= now() - interval '10 minutes')
  ORDER BY pd.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_failed_deliveries_for_retry(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_failed_deliveries_for_retry(integer) TO service_role;

-- Self-check: the catalogue is what this file intended, or the migration fails.
DO $verify$
DECLARE
  v_bad text[] := ARRAY[]::text[];
  v_sig text;
  v_def text;
BEGIN
  v_def := pg_get_functiondef(to_regprocedure('public.log_delivery_step(text,text,boolean,text,integer,jsonb)'));
  IF v_def IS NULL THEN
    v_bad := v_bad || 'log_delivery_step(text,text,boolean,text,integer,jsonb) does not exist'::text;
  ELSE
    IF position('INSERT INTO product_deliveries (stripe_session_id, status, product_type, customer_email)' in v_def) = 0 THEN
      v_bad := v_bad || 'log_delivery_step still inserts a row without product_type'::text;
    END IF;
    IF position($k$- 'email' - 'product_type' - 'product_name' - 'amount_cents'$k$ in v_def) = 0 THEN
      v_bad := v_bad || 'log_delivery_step payment_received does not keep the sweeper''s metadata'::text;
    END IF;
  END IF;

  v_def := pg_get_functiondef(to_regprocedure('public.get_failed_deliveries_for_retry(integer)'));
  IF v_def IS NULL THEN
    v_bad := v_bad || 'get_failed_deliveries_for_retry(integer) does not exist'::text;
  ELSE
    IF position('interval ''10 minutes''' in v_def) = 0 THEN
      v_bad := v_bad || 'get_failed_deliveries_for_retry does not wait for the webhook'::text;
    END IF;
    IF position('next_retry_at IS NULL OR pd.next_retry_at <= now()' in v_def) = 0 THEN
      v_bad := v_bad || 'get_failed_deliveries_for_retry no longer gates on next_retry_at'::text;
    END IF;
  END IF;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.log_delivery_step(text,text,boolean,text,integer,jsonb)',
    'public.get_failed_deliveries_for_retry(integer)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN CONTINUE; END IF;
    IF has_function_privilege('anon', to_regprocedure(v_sig), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(v_sig), 'EXECUTE')
       OR NOT has_function_privilege('service_role', to_regprocedure(v_sig), 'EXECUTE') THEN
      v_bad := v_bad || ('not service-role only: ' || v_sig);
    END IF;
  END LOOP;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'delivery bookkeeping self-check failed (% problem(s)): %',
      cardinality(v_bad), array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'delivery bookkeeping: log_delivery_step creates its row with a product type and keeps the sweeper''s metadata; the sweeper waits ten minutes for the webhook';
END
$verify$;
