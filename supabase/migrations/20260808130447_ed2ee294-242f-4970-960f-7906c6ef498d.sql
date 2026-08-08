CREATE TABLE IF NOT EXISTS public.apply_tenant_walls (
  vendor        text        NOT NULL,
  company_token text        NOT NULL,
  walled        boolean     NOT NULL,
  walls         text[]      NOT NULL DEFAULT '{}',
  checked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor, company_token)
);

COMMENT ON TABLE public.apply_tenant_walls IS
  'Observed bot-wall state per employer tenant. A row exists only because a probe loaded that employer''s apply form and watched its requests. Absence means unknown and is never treated as sendable.';

ALTER TABLE public.apply_tenant_walls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.apply_tenant_walls FROM anon, authenticated;
GRANT ALL ON TABLE public.apply_tenant_walls TO service_role;

CREATE OR REPLACE FUNCTION public.record_tenant_wall(
  p_vendor text,
  p_token  text,
  p_walled boolean,
  p_walls  text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_vendor IS NULL OR btrim(p_vendor) = '' OR p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'record_tenant_wall: vendor and token are required';
  END IF;
  IF p_walled IS NULL THEN
    RAISE EXCEPTION 'record_tenant_wall: walled must be true or false, never null — an unreachable probe writes no row';
  END IF;

  INSERT INTO public.apply_tenant_walls (vendor, company_token, walled, walls, checked_at)
  VALUES (lower(btrim(p_vendor)), btrim(p_token), p_walled, COALESCE(p_walls, '{}'), now())
  ON CONFLICT (vendor, company_token) DO UPDATE
    SET walled = EXCLUDED.walled,
        walls  = EXCLUDED.walls,
        checked_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_tenant_wall(text, text, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tenant_wall(text, text, boolean, text[]) TO service_role;

CREATE INDEX IF NOT EXISTS apply_tenant_walls_open_idx
  ON public.apply_tenant_walls (vendor, checked_at)
  WHERE walled = false;