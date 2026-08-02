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
      WHERE public.agent_subscribers.stripe_customer_id IS NULL;

    granted := granted + 1;
  END LOOP;

  RAISE NOTICE 'comped % owner address(es) for agent access, 90 days', granted;
END $$;