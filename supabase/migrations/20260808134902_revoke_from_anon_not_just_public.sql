-- "REVOKE ALL FROM PUBLIC" DOES NOT LOCK A FUNCTION IN THIS PROJECT.
--
-- Measured 2026-08-08, as anon, against production:
--
--     POST /rpc/record_tenant_wall     204   wrote a row
--     POST /rpc/reconcile_stripe_tick  204   posted to reconcile-stripe AND
--                                            stamped lastCronAt
--
-- Both functions carried `REVOKE ALL ON FUNCTION … FROM PUBLIC` and a GRANT to
-- service_role only, and Lovable applied both statements verbatim. They were
-- callable anyway.
--
-- THE MECHANISM. This database grants EXECUTE to `anon` on newly created
-- functions in `public` (default privileges). A grant held DIRECTLY by anon is
-- not removed by revoking from PUBLIC — PUBLIC is a different grantee. So the
-- revoke ran, succeeded, and removed a privilege that was not the one doing the
-- work. This is the same class as the "107 of 121 definer functions were
-- anon-callable" finding already in the runbook, and the reason
-- refresh_stats_cache is NOT affected is instructive: it was created by an
-- earlier migration and only ever CREATE OR REPLACE'd, and REPLACE preserves
-- existing grants. Only FRESH creations inherit the default.
--
-- WHAT THIS COST, stated plainly rather than filed under hardening:
--
--   record_tenant_wall — anyone could mark any walled employer "clean", and the
--   agent's per-tenant sendability check reads exactly that table. Poisoning it
--   steers the agent at forms it cannot complete.
--
--   reconcile_stripe_tick — anyone could stamp lastCronAt, which is the ONLY
--   evidence that the payment-reconciliation safety net still runs. The commit
--   that introduced it called that timestamp unforgeable and explicitly
--   rejected the body-source pattern used elsewhere on the grounds that an open
--   endpoint could fake it. The reasoning was right; the implementation did not
--   achieve it. It also lets a caller trigger the Stripe sweep at will.
--
-- THE FIX IS TO NAME THE GRANTEES. Revoking from PUBLIC is necessary and not
-- sufficient; anon and authenticated have to be revoked explicitly. Every
-- service-role-only function created from here on needs all three.

REVOKE ALL ON FUNCTION public.record_tenant_wall(text, text, boolean, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_wall(text, text, boolean, text[])
  TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_stripe_tick()
  FROM PUBLIC, anon, authenticated;
-- Note: NOT granted to service_role either. Only the scheduler needs it, and
-- pg_cron runs as the table owner — so the narrowest correct grant is none at
-- all beyond the owner's implicit rights.

-- The poisoned rows. An anonymous probe wrote at least one
-- (greenhouse/probe, marked clean) while demonstrating the hole; any other
-- caller could have written more. Nothing legitimate has written here yet —
-- the observation pipeline is not wired — so the whole table is safe to clear,
-- and clearing it is cheaper than reasoning about which rows to trust.
DELETE FROM public.apply_tenant_walls;

COMMENT ON FUNCTION public.record_tenant_wall(text, text, boolean, text[]) IS
  'Records one observed tenant wall state. service_role only: a caller who can '
  'write here can steer which employers the apply agent submits to. Revoked '
  'from anon and authenticated BY NAME — revoking from PUBLIC alone leaves the '
  'default-privilege grant this database gives anon on new functions, which is '
  'how this function shipped world-writable on 2026-08-08.';
