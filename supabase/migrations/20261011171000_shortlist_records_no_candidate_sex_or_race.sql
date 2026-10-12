-- SHORTLIST RECORDS NO CANDIDATE SEX OR RACE (owner decision D14, 2026-10-12;
-- wave 4 round 2, account-compliance).
--
-- WHAT WAS WRONG. Any signed-in account could upload strangers' resumes to
-- /shortlist and record each candidate's sex and race (shortlist_demographics,
-- 20260703120000): special-category data about third parties, entered by the
-- uploader, with no stated legal basis and no notice to the person.
--
-- WHAT THIS DOES. The page no longer offers the fields (src/pages/Shortlist.tsx)
-- and nothing writes them: the insert and update policies go and the client
-- roles lose INSERT and UPDATE. Rows already recorded stay readable by their
-- owner and go with the candidate, the role or the account (ON DELETE CASCADE);
-- erasing them outright is an owner step, because it cannot be undone:
--   DELETE FROM public.shortlist_demographics;
-- The uploader's attestation is enforced by shortlist-evaluate and logged on
-- each candidate's decision history (_shared/shortlist-attestation.ts), so no
-- schema change is needed for it.
--
-- Depends on 20260703120000. Safe to re-run. Verify: the DO block below, and
-- src/test/w4b-a-deleted-account-takes-its-keys-and-lists.test.ts runs this
-- file in pglite from Supabase's default grants.

SET LOCAL statement_timeout = '2min';

DROP POLICY IF EXISTS "owners insert own demographics" ON public.shortlist_demographics;
DROP POLICY IF EXISTS "owners update own demographics" ON public.shortlist_demographics;
REVOKE INSERT, UPDATE ON TABLE public.shortlist_demographics FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.shortlist_demographics IS
  'Closed to new data (owner decision D14, 20261011171000): candidates'' sex and race are no longer recorded. '
  'Existing rows stay readable by their owner until the candidate, role or account is deleted.';

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.shortlist_demographics', 'INSERT')
     OR has_table_privilege('authenticated', 'public.shortlist_demographics', 'INSERT')
     OR has_table_privilege('anon', 'public.shortlist_demographics', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.shortlist_demographics', 'UPDATE') THEN
    RAISE EXCEPTION 'shortlist_demographics is still writable by a client role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'shortlist_demographics' AND cmd IN ('INSERT', 'UPDATE', 'ALL')) THEN
    RAISE EXCEPTION 'shortlist_demographics still has a policy that lets a row be written';
  END IF;
END $$;
