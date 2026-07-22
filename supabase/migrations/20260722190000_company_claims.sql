-- Claim-your-profile: employers verify a work email at a company on the board
-- and earn a "Verified employer" chip on that company's lander. Verification
-- proves identity ONLY — it never grants editing rights over any computed data
-- (fills, churn flags, badges); that fence is policy, stated on /trust.
--
-- Flow: anonymous claim request (edge function company-claim, service role)
-- -> verification email -> link click. If the work-email domain matches the
-- company, the click fully verifies; otherwise it only confirms the address
-- and the owner reviews before the badge shows.

CREATE TABLE IF NOT EXISTS public.company_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_token text NOT NULL,
  company_name text,
  work_email text NOT NULL,
  contact_name text,
  website text,
  note text,
  verify_token uuid NOT NULL DEFAULT gen_random_uuid(),
  domain_match boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','email_confirmed','verified','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  UNIQUE (company_token, work_email)
);

-- Service-role only: RLS on with no public policies. The single public
-- surface is the badge RPC below, which exposes nothing but a boolean.
ALTER TABLE public.company_claims ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_company_claims_token
  ON public.company_claims (company_token);

CREATE OR REPLACE FUNCTION public.get_company_claim_status(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('verified', true, 'verified_at', c.verified_at)
       FROM public.company_claims c
      WHERE c.company_token = p_token AND c.status = 'verified'
      ORDER BY c.verified_at DESC NULLS LAST
      LIMIT 1),
    jsonb_build_object('verified', false)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_company_claim_status(text) TO anon, authenticated;
