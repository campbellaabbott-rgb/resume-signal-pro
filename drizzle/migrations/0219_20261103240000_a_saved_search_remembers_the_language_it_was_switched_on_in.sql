-- A SAVED SEARCH REMEMBERS THE LANGUAGE ITS OWNER READS THE SITE IN (audit
-- 2026-10-31, S13-102; the held-mail round, 2026-11-03; the review of
-- audit-rest, 2026-11-05).
--
-- The saved-search digest arrived in English whatever the reader's site
-- language, and nothing stored a language it could read: the mail is sent by
-- the scheduler, with no request of the reader's in hand. So the search keeps
-- it:
--   user_job_searches.locale  written by the owner's page with every write it
--     makes to the row: saving, switching the mail on or off, opening the
--     search. send-search-digest reads it on its own, apart from its claim, so
--     a function deployed before this migration, or this migration before that
--     function, only stays English. NULL is English, as it always was.
--
-- No trigger fills it from the browser's Accept-Language. An earlier form of
-- this file did, and the review found what that did: a reader who chose English
-- on a German browser would have got a German digest, and one who chose Spanish
-- on an English browser an English one. The page knows the language it is read
-- in; the header only guesses it.
--
-- The page is published ahead of this column. A database without it refuses a
-- write that names it, and the page goes again without it
-- (src/lib/saved-search-locale.ts), so no order can stop a save.
--
-- A column on an existing table: its row level security and grants do not
-- change, and the owner's policy already covers it. Safe to re-run.

ALTER TABLE public.user_job_searches ADD COLUMN IF NOT EXISTS locale text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_job_searches_locale_known'
       AND conrelid = 'public.user_job_searches'::regclass
  ) THEN
    ALTER TABLE public.user_job_searches
      ADD CONSTRAINT user_job_searches_locale_known
      CHECK (locale IS NULL OR locale IN ('en', 'en-GB', 'de', 'es', 'fr', 'hi', 'nl', 'pt', 'tl'));
  END IF;
END $$;

COMMENT ON COLUMN public.user_job_searches.locale IS
  'The language the digest is written in: the site language the owner''s page was read in at its last write to the row; NULL is English. S13-102.';

-- SELF-CHECK: the column, its check, and the table's row level security.
DO $$
DECLARE
  v_bad text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_job_searches'
       AND column_name = 'locale' AND data_type = 'text'
  ) THEN
    v_bad := v_bad || 'public.user_job_searches.locale is missing or not text'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.user_job_searches'::regclass
       AND c.contype = 'c'
       AND c.conname = 'user_job_searches_locale_known'
       AND pg_get_constraintdef(c.oid) LIKE '%en-GB%'
  ) THEN
    v_bad := v_bad || 'public.user_job_searches has no locale check'::text;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.user_job_searches'::regclass) THEN
    v_bad := v_bad || 'public.user_job_searches lost row level security'::text;
  END IF;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'S13-102 self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'a saved search keeps the language its owner reads the site in';
END $$;

NOTIFY pgrst, 'reload schema';
