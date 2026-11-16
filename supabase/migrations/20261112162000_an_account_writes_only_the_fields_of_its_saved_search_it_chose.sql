-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- AN ACCOUNT WRITES ONLY THE FIELDS OF ITS SAVED SEARCH IT CHOSE (NB-2, the
-- column half; the same pattern as NB-14's agent kick clock).
--
-- WHAT WAS WRONG. user_job_searches was granted whole-row INSERT and UPDATE to
-- authenticated (20260711152606), so a signed-in account could write the
-- digest's own bookkeeping on its rows: digest_last_sent_at and
-- digest_attempted_at (the claim queue's order, so a row written back to the
-- past jumped ahead of every real subscriber's alert), created_at (which the
-- digest reads to decide a first-match subject) and id.
--
-- WHAT HOLDS NOW. authenticated keeps SELECT and DELETE as before and may
-- INSERT and UPDATE only the eight fields the site's pages write: user_id,
-- name, params, digest_opt_in, fit_threshold, digest_cadence, locale and
-- last_seen_at (every insert and update in Jobs.tsx, Explore.tsx,
-- SavedSearchPills.tsx, SavedSearchesCard.tsx and NotificationsPanel.tsx
-- names only these). The row policy is unchanged, so an account still writes
-- only its own rows. anon and PUBLIC write nothing; service_role keeps ALL.
--
-- Re-runnable: REVOKE and GRANT are idempotent. The DO block at the end
-- raises if any of it did not take.

REVOKE INSERT, UPDATE ON public.user_job_searches FROM PUBLIC, anon, authenticated;

GRANT INSERT (user_id, name, params, digest_opt_in, fit_threshold, digest_cadence, locale, last_seen_at)
  ON public.user_job_searches TO authenticated;
GRANT UPDATE (user_id, name, params, digest_opt_in, fit_threshold, digest_cadence, locale, last_seen_at)
  ON public.user_job_searches TO authenticated;
GRANT ALL ON public.user_job_searches TO service_role;

DO $check$
DECLARE
  v_bad text[] := ARRAY[]::text[];
  v_col text;
BEGIN
  IF has_table_privilege('authenticated', 'public.user_job_searches', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_job_searches', 'UPDATE') THEN
    v_bad := v_bad || 'authenticated still holds whole-row INSERT or UPDATE'::text;
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.user_job_searches', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.user_job_searches', 'DELETE') THEN
    v_bad := v_bad || 'authenticated lost SELECT or DELETE, which the pages use'::text;
  END IF;
  FOREACH v_col IN ARRAY ARRAY['user_id', 'name', 'params', 'digest_opt_in', 'fit_threshold', 'digest_cadence', 'locale', 'last_seen_at'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.user_job_searches', v_col, 'INSERT')
       OR NOT has_column_privilege('authenticated', 'public.user_job_searches', v_col, 'UPDATE') THEN
      v_bad := v_bad || ('authenticated cannot write ' || v_col || ', which the pages write');
    END IF;
  END LOOP;
  FOREACH v_col IN ARRAY ARRAY['id', 'created_at', 'digest_last_sent_at', 'digest_attempted_at'] LOOP
    IF has_column_privilege('authenticated', 'public.user_job_searches', v_col, 'INSERT')
       OR has_column_privilege('authenticated', 'public.user_job_searches', v_col, 'UPDATE') THEN
      v_bad := v_bad || ('authenticated can still write ' || v_col);
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.user_job_searches', 'INSERT')
     OR has_table_privilege('anon', 'public.user_job_searches', 'UPDATE')
     OR has_column_privilege('anon', 'public.user_job_searches', 'name', 'UPDATE') THEN
    v_bad := v_bad || 'anon can write saved searches'::text;
  END IF;
  IF NOT has_table_privilege('service_role', 'public.user_job_searches', 'UPDATE') THEN
    v_bad := v_bad || 'service_role lost UPDATE, which the digest needs'::text;
  END IF;
  IF array_length(v_bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'NB-2 self-check failed: %', array_to_string(v_bad, '; ');
  END IF;
END
$check$;

NOTIFY pgrst, 'reload schema';
