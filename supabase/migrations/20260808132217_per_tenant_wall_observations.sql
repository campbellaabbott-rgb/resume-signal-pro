-- THE WALL IS A TENANT'S CHOICE, NOT A VENDOR'S.
--
-- Measured 2026-08-07 at 30 tenants per vendor, by loading each employer's own
-- apply page and recording what the page itself requested:
--
--     recruitee        22/29 walled     24% clean     7,945 live postings
--     ashby            25/30            17%          21,003
--     bamboohr         27/30            10%          45,999
--     greenhouse       28/30             7%          61,851
--     workable         30/30             0%          22,081
--     rippling         30/30             0%          10,053
--     lever            30/30             0%          12,957
--     smartrecruiters  30/30             0%          43,583
--
-- Four vendors are uniformly walled and stay closed. Four have real clean
-- fractions worth roughly 14,100 postings against a current drivable inventory
-- of 34,265 — about +41% agent reach from boards ALREADY in the catalog.
--
-- Nothing here crosses the boundary. A tenant that deployed a wall is recorded
-- as walled and left alone; the reach comes from tenants that never deployed
-- one, which is ordinary reachability and not circumvention.
--
-- WHY A TABLE AND NOT A CONSTANT. SENDABLE_VENDORS is a hand-maintained mirror
-- of the worker's adapters and it is right to be static — an adapter either
-- exists or it does not. A tenant's protection setting is a live fact about
-- somebody else's configuration that can change any morning, so it has to be
-- observed, dated, and allowed to expire.
--
-- OBSERVED, NEVER INFERRED. There is no "probably clean". A row exists only
-- because a probe loaded that employer's form and watched the requests. Absence
-- means unknown, and unknown is never treated as sendable — see
-- tenantSendable() in _shared/apply-automation.ts, where the default is false.

CREATE TABLE IF NOT EXISTS public.apply_tenant_walls (
  vendor        text        NOT NULL,
  company_token text        NOT NULL,
  -- TRUE means a wall was seen. FALSE means the page was reached and none was
  -- seen. There is deliberately no third value: a probe that could not reach
  -- the page writes NO ROW, because "we could not look" and "we looked and it
  -- is clean" must never be the same record. That conflation is the exact bug
  -- class this project has spent the week removing from its own monitoring.
  walled        boolean     NOT NULL,
  -- Which protections were seen, for the walled case. Empty for a clean one.
  -- Kept because "captcha" and "turnstile" have different implications if a
  -- vendor ever partially lifts one.
  walls         text[]      NOT NULL DEFAULT '{}',
  checked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor, company_token)
);

COMMENT ON TABLE public.apply_tenant_walls IS
  'Observed bot-wall state per employer tenant. A row exists only because a '
  'probe loaded that employer''s apply form and watched its requests. Absence '
  'means unknown and is never treated as sendable. Rows expire by age in '
  'tenantSendable() rather than being deleted, so a stale observation is '
  'visible as stale instead of silently trusted.';

-- Read is open to the agent's own paths only. The public badge deliberately
-- does NOT consume this yet: it would make a user-facing claim depend on a
-- probe that can go stale between page view and send, and the board's sparkle
-- mark currently means something simpler and always-true.
ALTER TABLE public.apply_tenant_walls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.apply_tenant_walls FROM anon, authenticated;

-- Recording an observation. SECURITY DEFINER so the apply-broker can write on
-- the worker's behalf — the worker has held no service-role key since the
-- broker was built, so the observation has to travel through a function.
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
  -- Guard the shape rather than trusting the caller: a blank token would
  -- create a row that matches every posting of that vendor.
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
        -- Always advanced, even when the verdict is unchanged: the value of
        -- this row is as much "when did we last look" as "what did we see".
        checked_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_tenant_wall(text, text, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tenant_wall(text, text, boolean, text[]) TO service_role;

COMMENT ON FUNCTION public.record_tenant_wall(text, text, boolean, text[]) IS
  'Records one observed tenant wall state. Refuses a null verdict on purpose: '
  'a probe that could not reach the page must write nothing rather than a row '
  'that reads as clean.';

-- Index for the runner's read path: "the clean tenants of this vendor".
CREATE INDEX IF NOT EXISTS apply_tenant_walls_open_idx
  ON public.apply_tenant_walls (vendor, checked_at)
  WHERE walled = false;
