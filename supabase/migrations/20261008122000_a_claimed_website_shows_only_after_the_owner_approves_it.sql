-- A CLAIMED WEBSITE SHOWS ONLY AFTER THE OWNER APPROVES IT, AND A CLAIM MAIL
-- IS RESENT ONLY AFTER ITS LAST SEND'S COOLDOWN (wave 2 email-ops, register
-- L13-06 and L10-12).
--
-- L13-06. company-claim auto-verified a claim when the email domain's label
-- and the board's token or name were substrings of each other (x@nth.io for
-- Anthropic, hr@dbank.xyz for TD Bank), and get_company_claim_status handed
-- the verified claimant's own website to every visitor, linked beside the
-- "Verified employer" badge: an attacker-controlled link under our badge.
-- company-claim .2026-10-08.1 verifies only an exact registrable-domain match
-- with a host the board links to; this file adds owner_approved_at (set by the
-- owner's admin-decide, cleared by a revoke) and the status reader returns the
-- website only when it is set. Existing verified claims keep their badge and
-- lose the link until the owner approves them on /admin/claims.
--
-- L10-12. The function's 10-minute no-resend guard read created_at, which a
-- repeat request never refreshed, so after a row's first 10 minutes every
-- request re-sent. last_sent_at is stamped after each send and the guard reads
-- it; existing rows start from their created_at.
--
-- get_company_claim_status stays a definer the publishable key may call (it is
-- on the client-callable allowlist, caller src/components/jobs/CompanyClaim.tsx);
-- its grants are restated after the revoke. Safe to re-run.

ALTER TABLE public.company_claims ADD COLUMN IF NOT EXISTS owner_approved_at timestamptz;
ALTER TABLE public.company_claims ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
UPDATE public.company_claims SET last_sent_at = created_at WHERE last_sent_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_company_claim_status(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
              'verified', true,
              'verified_at', c.verified_at,
              -- The claimant's own link, only once the owner has approved it.
              'website', CASE WHEN c.owner_approved_at IS NOT NULL THEN c.website END)
       FROM public.company_claims c
      WHERE c.company_token = p_token AND c.status = 'verified'
      ORDER BY (c.owner_approved_at IS NOT NULL) DESC, c.verified_at DESC NULLS LAST
      LIMIT 1),
    jsonb_build_object('verified', false)
  );
$$;

REVOKE ALL ON FUNCTION public.get_company_claim_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_claim_status(text) TO anon, authenticated, service_role;

DO $$
DECLARE
  v_token text := '__selfcheck_' || md5(random()::text);
  v_out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_claims' AND column_name = 'owner_approved_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_claims' AND column_name = 'last_sent_at') THEN
    RAISE EXCEPTION 'self-check: company_claims is missing owner_approved_at or last_sent_at';
  END IF;
  -- A verified claim nobody approved: the badge, never the link.
  INSERT INTO public.company_claims (company_token, work_email, website, status, verified_at)
  VALUES (v_token, 'selfcheck@example.invalid', 'https://attacker.example', 'verified', now());
  v_out := public.get_company_claim_status(v_token);
  DELETE FROM public.company_claims WHERE company_token = v_token;
  IF (v_out ->> 'verified') IS DISTINCT FROM 'true' OR (v_out ->> 'website') IS NOT NULL THEN
    RAISE EXCEPTION 'self-check: get_company_claim_status shows an unapproved website: %', v_out;
  END IF;
END $$;
