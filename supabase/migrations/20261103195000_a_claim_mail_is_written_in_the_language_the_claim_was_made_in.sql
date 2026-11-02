-- A CLAIM MAIL IS WRITTEN IN THE LANGUAGE THE CLAIM WAS MADE IN (audit
-- 2026-10-31, S13-102; the audit-rest fixer, 2026-11-03).
--
-- company-claim mailed its verification link, and later the owner's
-- "verified" notice, in English whatever the employer's language. The
-- verification mail answers a request and is written in that request's
-- language (company-claim/copy.ts: the page's `language`, else the browser's
-- Accept-Language, else English). The "verified" notice is sent days later,
-- from the owner's decision, with no request of the employer's in hand. So
-- the claim keeps the language:
--   company_claims.locale  written by company-claim when the verification
--     mail goes out, read when the owner verifies the claim.
-- The function reads and writes the column on its own, apart from every
-- other read and write, so a function deployed before this migration only
-- loses the translation. NULL is English. Only the site's nine languages may
-- be stored. (The API key's confirmation mail is sent inside the request
-- that asks for it, so api_key_requests needs no column.)
--
-- A column on an existing service-role table: RLS stays on, no policy and no
-- grant is added. Safe to re-run.

ALTER TABLE public.company_claims ADD COLUMN IF NOT EXISTS locale text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'company_claims_locale_known'
       AND conrelid = 'public.company_claims'::regclass
  ) THEN
    ALTER TABLE public.company_claims
      ADD CONSTRAINT company_claims_locale_known
      CHECK (locale IS NULL OR locale IN ('en', 'en-GB', 'de', 'es', 'fr', 'hi', 'nl', 'pt', 'tl'));
  END IF;
END $$;

COMMENT ON COLUMN public.company_claims.locale IS
  'The site language the claim''s verification mail was written in (company-claim); the "verified" notice uses it. NULL is English. S13-102.';

-- SELF-CHECK, read-only: the column exists as text, refuses a language we do
-- not write, and the table is still under row level security.
DO $$
DECLARE
  v_bad text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'company_claims'
       AND column_name = 'locale' AND data_type = 'text'
  ) THEN
    v_bad := v_bad || 'public.company_claims.locale is missing or not text'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.company_claims'::regclass
       AND c.contype = 'c'
       AND c.conname = 'company_claims_locale_known'
       AND pg_get_constraintdef(c.oid) LIKE '%en-GB%'
  ) THEN
    v_bad := v_bad || 'public.company_claims has no locale check'::text;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.company_claims'::regclass) THEN
    v_bad := v_bad || 'public.company_claims lost row level security'::text;
  END IF;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'S13-102 self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'a claim keeps the language its verification mail was written in';
END $$;

NOTIFY pgrst, 'reload schema';
