-- A QUEUE WRAPPER IS CLOSED BY WHAT IT TOUCHES, NOT BY ITS NAME.
--
-- WHAT WAS OPEN. The delayed email enqueue -- the SECURITY DEFINER wrapper
-- send-scan-report uses to schedule the 7-day fix-plan mail -- has been
-- executable by anon and authenticated since it was created on 2026-07-07.
-- Both of its definitions withdrew EXECUTE from PUBLIC only, and on this
-- database the API roles hold EXECUTE on new public functions directly, so
-- that revoke removed nothing (the lesson recorded in
-- revoking-from-public-does-not-revoke-from-anon.test.ts). The two
-- 2026-07-30 lockdowns then closed the email queue family by an exact-name
-- array that spelled the other four wrappers and not this one.
--
-- WHAT ANON COULD DO WITH IT, read from its body rather than probed (a probe
-- that succeeds would itself send mail): put any payload on any queue name,
-- with any delay, as the function owner -- the transactional queue that
-- process-email-queue drains through the verified sending domain, so a to,
-- from, subject and html of the caller's choosing. And on a queue name that
-- does not exist it CREATES the queue, so it also handed out unlimited pgmq
-- table creation. The publishable key that reaches it ships in the frontend
-- bundle.
--
-- WHY NOT JUST ADD THE NAME. An exact-name list is what let this through, and
-- the next variant of the family would be born open the same way. So:
--   1. the named wrapper is closed by its own signature, for the reader;
--   2. every SECURITY DEFINER function in public whose body touches pgmq is
--      closed by PROPERTY, overloads and unknown siblings included (the live
--      database is known to hold functions the migrations do not), and keeps
--      its service_role grant -- send-scan-report, auth-email-hook and
--      process-email-queue all call with the service key;
--   3. the migration refuses to finish while any such function in public is
--      still executable by anon or authenticated. Outside public it warns
--      instead of failing: this role cannot revoke on schemas it does not own,
--      and a failure there would roll back the fix for the functions it can.
--
-- HOW A DEPLOY IS PROVED WITHOUT SENDING MAIL. Calling a wrapper as anon to
-- see whether it refuses is not provably harmless: if the revoke did not
-- land, the call runs, and on some pgmq versions a malformed queue name falls
-- into the wrappers' create-the-queue branch. So this file also adds
-- queue_wrapper_exposure(): a plain (INVOKER) SQL function over the catalog
-- that answers how many definers touch pgmq and how many of them anon or
-- authenticated can still execute. It reads nothing but pg_proc and the
-- privilege functions, runs with the caller's rights, and returns two
-- numbers; scripts/verify-deploy.sh section 7f reads it with the publishable
-- key. It is also a standing monitor: a variant created later, by a migration
-- or by hand, shows up as a non-zero count.
--
-- The static half of the guard
-- (a-queue-wrapper-is-closed-by-what-it-touches-not-by-its-name.test.ts)
-- fails CI for any later migration that creates a definer touching pgmq
-- without closing it, because the loop below only sees what exists today.

DO $named$
BEGIN
  IF to_regprocedure('public.enqueue_email_delayed(text, jsonb, integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.enqueue_email_delayed(TEXT, JSONB, INT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.enqueue_email_delayed(TEXT, JSONB, INT) TO service_role;
  ELSE
    RAISE WARNING 'queue lockdown: the delayed enqueue does not exist here; the property loop below still runs';
  END IF;
END
$named$;

DO $family$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prosecdef
      AND p.prosrc ~* '\mpgmq(_public)?\.'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
    RAISE NOTICE 'queue lockdown: % restricted to service_role', r.sig;
  END LOOP;
  RAISE NOTICE 'queue lockdown: % definer function(s) touching pgmq restricted to service_role', n;
  -- The delayed enqueue alone guarantees one match. Zero means the matcher
  -- stopped reading bodies, not that the family is gone.
  IF n = 0 AND to_regprocedure('public.enqueue_email_delayed(text, jsonb, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'queue lockdown: the property loop matched nothing although the delayed enqueue exists';
  END IF;
END
$family$;

CREATE OR REPLACE FUNCTION public.queue_wrapper_exposure()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'definers', count(*),
    'open_to_clients', count(*) FILTER (
      WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
  )
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.prosecdef
    AND p.prosrc ~* '\mpgmq(_public)?\.';
$$;

COMMENT ON FUNCTION public.queue_wrapper_exposure() IS
  'How many SECURITY DEFINER functions in public touch pgmq, and how many of them anon or authenticated '
  'can still execute (should be 0). Invoker rights, catalog reads only, two numbers: safe for the '
  'publishable key, and the only way to prove the queue lockdown landed without calling a wrapper.';

GRANT EXECUTE ON FUNCTION public.queue_wrapper_exposure() TO anon, authenticated, service_role;

DO $verify$
DECLARE
  r record;
  still_open text := '';
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig, ns.nspname
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE p.prosecdef
      AND p.prosrc ~* '\mpgmq(_public)?\.'
      AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      IF r.nspname = 'public' THEN
        still_open := still_open || ' ' || r.sig::text;
      ELSE
        RAISE WARNING 'queue lockdown: %.% is a definer touching pgmq and is executable by anon or authenticated; it is outside public and was not revoked here', r.nspname, r.sig;
      END IF;
    END IF;
  END LOOP;
  IF still_open <> '' THEN
    RAISE EXCEPTION 'queue lockdown: still executable by anon or authenticated:%', still_open;
  END IF;
END
$verify$;
