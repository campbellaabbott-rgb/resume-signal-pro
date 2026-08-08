REVOKE ALL ON FUNCTION public.record_tenant_wall(text, text, boolean, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_wall(text, text, boolean, text[])
  TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_stripe_tick()
  FROM PUBLIC, anon, authenticated;

DELETE FROM public.apply_tenant_walls;

COMMENT ON FUNCTION public.record_tenant_wall(text, text, boolean, text[]) IS
  'Records one observed tenant wall state. service_role only: a caller who can write here can steer which employers the apply agent submits to. Revoked from anon and authenticated BY NAME.';