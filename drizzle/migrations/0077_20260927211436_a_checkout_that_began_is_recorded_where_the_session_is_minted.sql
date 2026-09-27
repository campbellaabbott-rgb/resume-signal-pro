CREATE TABLE IF NOT EXISTS public.checkout_starts (
  stripe_session_id text PRIMARY KEY,
  visitor_id text,
  product_type text NOT NULL,
  product_id text,
  amount_cents integer,
  currency text,
  origin_path text,
  checkout_function text NOT NULL,
  mode text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_starts_visitor_shape
    CHECK (visitor_id IS NULL OR char_length(visitor_id) BETWEEN 8 AND 64),
  CONSTRAINT checkout_starts_origin_is_a_path
    CHECK (origin_path IS NULL OR (left(origin_path, 1) = '/' AND position('?' in origin_path) = 0 AND position('#' in origin_path) = 0))
);

CREATE INDEX IF NOT EXISTS idx_checkout_starts_visitor_created
  ON public.checkout_starts (visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checkout_starts_created
  ON public.checkout_starts (created_at);

COMMENT ON TABLE public.checkout_starts IS
  'One row per Stripe Checkout session minted by a checkout edge function, written server-side '
  'before the url is returned to the browser. Keyed on the session id, which is the same string '
  'the payment side stores in used_stripe_sessions.session_id, product_deliveries.stripe_session_id '
  'and agent_passes.stripe_session_id; visitor_id carries the client visitor id (8 to 64 characters) '
  'that ab_test_events.visitor_id also carries, which is how a purchase reaches its landing page. '
  'origin_path is a pathname only. Service role only.';

ALTER TABLE public.checkout_starts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_starts FROM PUBLIC;
REVOKE ALL ON TABLE public.checkout_starts FROM anon;
REVOKE ALL ON TABLE public.checkout_starts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkout_starts TO service_role;

CREATE OR REPLACE FUNCTION public.record_checkout_start(
  p_stripe_session_id text,
  p_checkout_function text,
  p_product_type text,
  p_product_id text DEFAULT NULL,
  p_visitor_id text DEFAULT NULL,
  p_amount_cents integer DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_origin_path text DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor text;
  v_path text;
  v_metadata jsonb;
  v_rows integer;
BEGIN
  IF p_stripe_session_id IS NULL
     OR char_length(p_stripe_session_id) < 8
     OR char_length(p_stripe_session_id) > 255 THEN
    RAISE EXCEPTION 'record_checkout_start: a Stripe session id is required' USING ERRCODE = '22023';
  END IF;
  IF p_checkout_function IS NULL OR char_length(p_checkout_function) < 1 THEN
    RAISE EXCEPTION 'record_checkout_start: the minting function must name itself' USING ERRCODE = '22023';
  END IF;
  IF p_product_type IS NULL OR char_length(p_product_type) < 1 THEN
    RAISE EXCEPTION 'record_checkout_start: a product type is required' USING ERRCODE = '22023';
  END IF;

  v_visitor := CASE
    WHEN p_visitor_id IS NOT NULL AND char_length(p_visitor_id) BETWEEN 8 AND 64 THEN p_visitor_id
    ELSE NULL
  END;

  v_path := split_part(split_part(coalesce(p_origin_path, ''), '?', 1), '#', 1);
  v_path := CASE WHEN left(v_path, 1) = '/' THEN left(v_path, 200) ELSE NULL END;

  v_metadata := CASE
    WHEN p_metadata IS NULL THEN '{}'::jsonb
    WHEN octet_length(p_metadata::text) > 4096 THEN jsonb_build_object('truncated', true)
    ELSE p_metadata
  END;

  INSERT INTO public.checkout_starts (
    stripe_session_id, visitor_id, product_type, product_id, amount_cents,
    currency, origin_path, checkout_function, mode, metadata
  )
  VALUES (
    p_stripe_session_id, v_visitor, left(p_product_type, 64), left(p_product_id, 64), p_amount_cents,
    lower(left(p_currency, 8)), v_path, left(p_checkout_function, 64), left(p_mode, 32), v_metadata
  )
  ON CONFLICT (stripe_session_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.record_checkout_start(text, text, text, text, text, integer, text, text, text, jsonb) IS
  'The single writer to checkout_starts, called by the checkout edge functions with the service key '
  'right after Stripe answers with a session. Keyed on the session id: a repeat of the same id writes '
  'nothing and answers false; a second session for the same visitor is a second row. No window, no budget.';

REVOKE ALL ON FUNCTION public.record_checkout_start(text, text, text, text, text, integer, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_checkout_start(text, text, text, text, text, integer, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_checkout_start(text, text, text, text, text, integer, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_checkout_start(text, text, text, text, text, integer, text, text, text, jsonb) TO service_role;