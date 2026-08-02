-- Comp the owner's own accounts so the apply agent can be tested end to end.
--
-- WHY THIS IS A MIGRATION AND NOT A ONE-OFF QUERY. It has to be idempotent, it
-- has to be reviewable, and it has to be undoable by someone who finds it in a
-- year and wonders why an account is entitled without a Stripe subscription
-- behind it. A hand-run INSERT satisfies none of those. This is a deliberate
-- grant with its reason attached.
--
-- WHAT IT DOES NOT DO: fake a payment. The row carries a NULL
-- stripe_customer_id, which is precisely what marks it as a manual grant rather
-- than a cached Stripe answer. Every consumer already treats status and period
-- end as the truth, and as of 883d3f6 the Stripe sync in _shared/agent.ts only
-- overwrites rows Stripe owns — so this grant survives the Account page being
-- loaded, and a REAL subscription later would simply take over the row.
--
-- BOTH ADDRESSES, DELIBERATELY. The agent matches on agent_mandates.email,
-- which is whatever the owner signed up to resumebooster.work with. The
-- codebase's owner-notification address is resumeboostersupp@gmail.com; the
-- operator's personal address is campbellabbott@gmail.com. Which of the two
-- carries the mandate is not knowable from here, and picking wrong fails
-- SILENTLY — the agent skips the mandate and does nothing, which looks exactly
-- like "no matching jobs". Two rows costs nothing and removes the guess.
--
-- 90 DAYS, NOT FOREVER. An unbounded grant is one nobody ever revisits. This
-- one lapses on its own, and re-running this migration is how it gets extended.

DO $$
DECLARE
  comp_email text;
  granted int := 0;
BEGIN
  FOREACH comp_email IN ARRAY ARRAY[
    'resumeboostersupp@gmail.com',
    'campbellabbott@gmail.com'
  ] LOOP
    INSERT INTO public.agent_subscribers (email, status, current_period_end, stripe_customer_id)
    VALUES (comp_email, 'active', now() + interval '90 days', NULL)
    ON CONFLICT (email) DO UPDATE
      SET status             = 'active',
          current_period_end = EXCLUDED.current_period_end,
          updated_at         = now()
      -- Never overwrite a row Stripe owns. If this address has a real
      -- subscription, Stripe is the authority and this migration stands aside.
      WHERE public.agent_subscribers.stripe_customer_id IS NULL;

    granted := granted + 1;
  END LOOP;

  RAISE NOTICE 'comped % owner address(es) for agent access, 90 days', granted;
END $$;

-- Read this back after applying. If a mandate exists whose email is NOT listed
-- here, that is the address that actually needs the grant.
--
--   SELECT s.email, s.status, s.current_period_end, s.stripe_customer_id,
--          EXISTS (SELECT 1 FROM public.agent_mandates m WHERE m.email = s.email) AS has_mandate
--     FROM public.agent_subscribers s;
--
--   SELECT email, apply_mode FROM public.agent_mandates;
--
-- TO REVOKE:
--   DELETE FROM public.agent_subscribers
--    WHERE stripe_customer_id IS NULL
--      AND email IN ('resumeboostersupp@gmail.com', 'campbellabbott@gmail.com');
