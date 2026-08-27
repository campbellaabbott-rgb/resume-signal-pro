-- One $2 purchase unlocked every paid generator, permanently.
--
-- assertPaidSession (_shared/paid-session.ts) is the purchase gate on six
-- public, verify_jwt=false streaming generators. It asks one question:
--
--     SELECT session_id FROM used_stripe_sessions WHERE session_id = $1
--
-- Existence. Nothing else. And the table it queries is
--     (session_id TEXT PRIMARY KEY, used_at TIMESTAMPTZ, ip_address TEXT)
-- so it CANNOT distinguish what was bought — there is no product column to
-- check. A session id minted by the cheapest item in the catalogue is
-- byte-for-byte as good as one from the most expensive.
--
-- The attack is not subtle: buy the $2 scan pack, keep the session_id from the
-- success-page URL, and post it to generate-premium-package-stream,
-- generate-career-snapshot, generate-graduate-gameplan or generate-keyword-fix
-- for as long as the row exists — which is forever, because the claim is
-- permanent by design (it has to be, so a real buyer can refresh the page).
--
-- product_type is recorded at claim time by BOTH writers, which already have it
-- in hand before they insert: verify-product-purchase reads it from
-- session.metadata at :182 and claims at :199; stripe-webhook reads it at :147
-- and claims at :160.
--
-- NULLABLE, AND NULL IS ACCEPTED BY THE GATE. Every row written before this
-- migration has no product, and a real buyer's session is claimed once and
-- reused on every refresh — so rejecting NULL would 402 people who genuinely
-- paid. The hole therefore narrows rather than closes completely: it shuts for
-- every session claimed from now on, and stays open for sessions already in the
-- table. That is the honest description of this change, and the residual is
-- bounded and shrinking rather than permanent.
ALTER TABLE public.used_stripe_sessions
  ADD COLUMN IF NOT EXISTS product_type text;

COMMENT ON COLUMN public.used_stripe_sessions.product_type IS
  'Which product this session paid for, recorded at claim time. assertPaidSession '
  'compares it against what the generator being called actually sells. NULL means '
  'the row predates 20260827180000 (or arrived with no product metadata) and is '
  'grandfathered — without a product this table cannot tell a $2 purchase from a '
  '$59 one, which is exactly the defect this column exists to close.';
