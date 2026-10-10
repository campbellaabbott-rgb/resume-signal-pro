-- AN API KEY REQUEST KEEPS THE TERMS IT WAS SHOWN.
--
-- WHAT WAS WRONG (commercial-readiness plan 2026-10-08, item 12). No button
-- that starts a purchase or an account said "By continuing you agree to the
-- Terms", and nothing recorded which Terms anyone agreed to. The checkouts
-- now carry the version on the Stripe session and the start record, and a
-- sign-up on the account's metadata; the free data API key form (/data-api)
-- shows the line and sends the version with the request, and api-key-request
-- (2026-10-09.1) writes it here, on the request row its link redeems.
--
-- A nullable column on a service_role-only table: no grant changes, nothing a
-- client can read. Safe to re-run.

ALTER TABLE public.api_key_requests
  ADD COLUMN IF NOT EXISTS terms_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_key_requests'::regclass
       AND conname = 'api_key_requests_terms_version_is_a_date'
  ) THEN
    ALTER TABLE public.api_key_requests
      ADD CONSTRAINT api_key_requests_terms_version_is_a_date
      CHECK (terms_version IS NULL OR terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN public.api_key_requests.terms_version IS
  'The Terms version (the date /terms prints) shown above the request button, as the page sent it. NULL: an older page. 20261009132000.';

-- Self-verifying: the column is there, still closed to the client roles, and
-- a value that is not a version is refused.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'api_key_requests' AND column_name = 'terms_version'
  ) THEN
    RAISE EXCEPTION 'api_key_requests.terms_version was not added';
  END IF;
  IF has_table_privilege('anon', 'public.api_key_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.api_key_requests', 'SELECT') THEN
    RAISE EXCEPTION 'api_key_requests is readable by a client role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_key_requests'::regclass
       AND conname = 'api_key_requests_terms_version_is_a_date'
  ) THEN
    RAISE EXCEPTION 'api_key_requests.terms_version has no format check';
  END IF;
END $$;
