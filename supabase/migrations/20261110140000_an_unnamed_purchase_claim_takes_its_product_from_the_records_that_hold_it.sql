-- AN UNNAMED PURCHASE CLAIM TAKES ITS PRODUCT FROM THE RECORDS THAT HOLD IT
-- (bug round S14, M-S14-057; hotfix lane spend).
--
-- WHAT WAS WRONG. assertPaidSession (_shared/paid-session.ts), the gate in
-- front of every paid generator, compares a claim's product_type with the
-- products the generator sells, and accepted a claim with NO product as a
-- purchase of everything. Claims written before 20260827180000 have none, so
-- the id of a $2 scan pack, of a $5 Full Analysis, or a link a buyer
-- forwarded ran the retired premium package and every other paid generator.
--
-- WHAT THIS CHANGES. Every unnamed claim whose product our own records still
-- hold is named, from four of them, keyed on the same session id:
--   - purchased_content: the content delivered for the session;
--   - product_deliveries: the order row stripe-webhook writes for every
--     session it claims, in the spelling the checkout wrote into Stripe
--     ('unknown' when the session carried none, which names nothing);
--   - checkout_starts: the product the checkout minted the session for;
--   - pro_grants: a Pro member's grant, whose claim is 'pro_' and its id.
-- A claim is named only when these agree on ONE product. The gate (this
-- round's paid-session.ts) refuses an unnamed claim the row itself rules out
-- (a test-mode id, an address beside it, a date after products were named)
-- and accepts the rest as an older buyer's.
--
-- ONE CASE IS NAMED FROM THE SHAPE OF THE SALE, NOT A RECORD. From the
-- table's first day every checkout but one wrote a product into Stripe:
-- create-scan-pack-checkout, create-product-checkout, create-subscription-
-- checkout, create-agent-checkout and create-pass-checkout did from the
-- commit that added each. create-checkout, the Full Analysis, wrote none
-- until 2026-06-30, and create-test-checkout mints only cs_test_ sessions.
-- So a live session claimed with no address, whose order rows were written
-- before 2026-07-01 and all say 'unknown', and that no other record names,
-- was a Full Analysis, and is named 'full_analysis'. That changes nothing for
-- the analysis itself: analyze-resume reads such a claim, unnamed or named
-- for the analysis, as paid and not yet analysed, and still judges the
-- Stripe session by create-checkout's legacy shape.
--
-- WHAT IS NEVER WRITTEN. A claim with an address was written by
-- analyze-resume, verify-scan-pack-purchase or generate-ats-defense. For one
-- of those, 'full_analysis' is written only beside the delivered content:
-- analyze-resume refuses an unnamed claim with an address (its pre-fix mark,
-- which may have been analysed) and would read one named for the analysis
-- as paid and not yet analysed, a second analysis for one payment. A claim
-- that already names a product, 'refunded' included, is never touched.
--
-- WHAT IS LEFT UNNAMED, AND COUNTED. The notice below and job_board_meta
-- 'paid_session_names' say how many unnamed claims remain, split by what
-- the gate does with them: 'unnamedStillOpen' (not a cs_test_ id, no
-- address, written before 2026-08-27 18:00 UTC: a buyer of something we can
-- no longer tell, let through rather than locked out) and 'unnamedRefused'
-- (the rest). 'named' counts every claim that names a product after the run.
-- 'firstRun' keeps the first application's counts; 'lastRun' the latest.
--
-- APPLY ORDER: any. Before this applies, the new gate accepts every claim it
-- names (unnamed, no address, before 2026-08-27), as today's does; after
-- it, today's gate checks the names it wrote. Safe to re-run: it writes only
-- where product_type IS NULL, and a second run names nothing new. No object
-- is created, so nothing new needs its privileges withdrawn.
-- Verify: the DO block below; src/test/a-two-dollar-receipt-opens-no-paid-
-- generator-once-its-claim-is-named.test.ts runs this file on Postgres and
-- the gate against it.

SET LOCAL statement_timeout = '2min';

-- Named from the records, where they agree on one product.
WITH evidence AS (
  SELECT pc.stripe_session_id AS session_id, btrim(pc.product_type) AS product_type, true AS delivered
    FROM public.purchased_content pc
   WHERE coalesce(btrim(pc.product_type), '') <> ''
  UNION ALL
  SELECT d.stripe_session_id, btrim(d.product_type), false
    FROM public.product_deliveries d
   WHERE coalesce(btrim(d.product_type), '') NOT IN ('', 'unknown')
  UNION ALL
  SELECT cs.stripe_session_id, btrim(cs.product_type), false
    FROM public.checkout_starts cs
   WHERE coalesce(btrim(cs.product_type), '') <> ''
  UNION ALL
  SELECT 'pro_' || g.id::text, btrim(g.product_type), false
    FROM public.pro_grants g
   WHERE coalesce(btrim(g.product_type), '') <> ''
),
named AS (
  SELECT u.session_id, min(e.product_type) AS product_type, bool_or(e.delivered) AS delivered
    FROM public.used_stripe_sessions u
    JOIN evidence e ON e.session_id = u.session_id
   WHERE u.product_type IS NULL
   GROUP BY u.session_id
  HAVING count(DISTINCT e.product_type) = 1
)
UPDATE public.used_stripe_sessions u
   SET product_type = n.product_type
  FROM named n
 WHERE u.session_id = n.session_id
   AND u.product_type IS NULL
   AND NOT (u.ip_address IS NOT NULL AND n.product_type = 'full_analysis' AND NOT n.delivered);

-- Named from the shape of the sale: create-checkout's Full Analysis before it
-- wrote a product.
UPDATE public.used_stripe_sessions u
   SET product_type = 'full_analysis'
 WHERE u.product_type IS NULL
   AND u.ip_address IS NULL
   AND left(u.session_id, 8) = 'cs_live_'
   AND EXISTS (
     SELECT 1 FROM public.product_deliveries d
      WHERE d.stripe_session_id = u.session_id AND d.product_type = 'unknown')
   AND NOT EXISTS (
     SELECT 1 FROM public.product_deliveries d
      WHERE d.stripe_session_id = u.session_id
        AND (coalesce(btrim(d.product_type), '') <> 'unknown' OR d.created_at >= timestamptz '2026-07-01 00:00:00+00'))
   AND NOT EXISTS (SELECT 1 FROM public.purchased_content pc WHERE pc.stripe_session_id = u.session_id)
   AND NOT EXISTS (SELECT 1 FROM public.checkout_starts cs WHERE cs.stripe_session_id = u.session_id);

-- Self-verifying: no unnamed claim is left that the records name, or that the
-- shape names; the counts are said and kept.
DO $$
DECLARE
  v_missed integer;
  v_shape_missed integer;
  v_named integer;
  v_open integer;
  v_refused integer;
  v_run jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'used_stripe_sessions' AND column_name = 'product_type'
  ) THEN
    RAISE EXCEPTION 'used_stripe_sessions.product_type is missing: 20260827180000 has not applied';
  END IF;

  WITH evidence AS (
    SELECT pc.stripe_session_id AS session_id, btrim(pc.product_type) AS product_type, true AS delivered
      FROM public.purchased_content pc WHERE coalesce(btrim(pc.product_type), '') <> ''
    UNION ALL
    SELECT d.stripe_session_id, btrim(d.product_type), false
      FROM public.product_deliveries d WHERE coalesce(btrim(d.product_type), '') NOT IN ('', 'unknown')
    UNION ALL
    SELECT cs.stripe_session_id, btrim(cs.product_type), false
      FROM public.checkout_starts cs WHERE coalesce(btrim(cs.product_type), '') <> ''
    UNION ALL
    SELECT 'pro_' || g.id::text, btrim(g.product_type), false
      FROM public.pro_grants g WHERE coalesce(btrim(g.product_type), '') <> ''
  )
  SELECT count(*) INTO v_missed
    FROM (
      SELECT u.session_id, min(e.product_type) AS product_type, bool_or(e.delivered) AS delivered, min(u.ip_address) AS ip_address
        FROM public.used_stripe_sessions u
        JOIN evidence e ON e.session_id = u.session_id
       WHERE u.product_type IS NULL
       GROUP BY u.session_id
      HAVING count(DISTINCT e.product_type) = 1
    ) n
   WHERE NOT (n.ip_address IS NOT NULL AND n.product_type = 'full_analysis' AND NOT n.delivered);
  IF v_missed > 0 THEN
    RAISE EXCEPTION '% unnamed purchase claim(s) are still unnamed although the records name one product for each', v_missed;
  END IF;

  SELECT count(*) INTO v_shape_missed
    FROM public.used_stripe_sessions u
   WHERE u.product_type IS NULL AND u.ip_address IS NULL AND left(u.session_id, 8) = 'cs_live_'
     AND EXISTS (SELECT 1 FROM public.product_deliveries d WHERE d.stripe_session_id = u.session_id AND d.product_type = 'unknown')
     AND NOT EXISTS (
       SELECT 1 FROM public.product_deliveries d
        WHERE d.stripe_session_id = u.session_id
          AND (coalesce(btrim(d.product_type), '') <> 'unknown' OR d.created_at >= timestamptz '2026-07-01 00:00:00+00'))
     AND NOT EXISTS (SELECT 1 FROM public.purchased_content pc WHERE pc.stripe_session_id = u.session_id)
     AND NOT EXISTS (SELECT 1 FROM public.checkout_starts cs WHERE cs.stripe_session_id = u.session_id);
  IF v_shape_missed > 0 THEN
    RAISE EXCEPTION '% Full Analysis claim(s) from before products were named are still unnamed', v_shape_missed;
  END IF;

  SELECT count(*) INTO v_named FROM public.used_stripe_sessions WHERE product_type IS NOT NULL;
  SELECT count(*) INTO v_open
    FROM public.used_stripe_sessions u
   WHERE u.product_type IS NULL AND u.ip_address IS NULL
     AND left(u.session_id, 8) <> 'cs_test_'
     AND u.used_at < timestamptz '2026-08-27 18:00:00+00';
  SELECT count(*) INTO v_refused FROM public.used_stripe_sessions WHERE product_type IS NULL;
  v_refused := v_refused - v_open;

  v_run := jsonb_build_object('at', now(), 'named', v_named, 'unnamedStillOpen', v_open, 'unnamedRefused', v_refused);
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('paid_session_names', jsonb_build_object('migration', '20261110140000', 'firstRun', v_run, 'lastRun', v_run), now())
  ON CONFLICT (k) DO UPDATE
    SET v = jsonb_build_object(
          'migration', '20261110140000',
          'firstRun', coalesce(public.job_board_meta.v -> 'firstRun', EXCLUDED.v -> 'lastRun'),
          'lastRun', EXCLUDED.v -> 'lastRun'),
        updated_at = EXCLUDED.updated_at;

  RAISE NOTICE 'purchase claims: % named; % unnamed and let through as an older buyer''s (no address, before 2026-08-27 18:00 UTC, not test mode); % unnamed and refused by the gate',
    v_named, v_open, v_refused;
END $$;
