-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- AN ACCOUNT CANNOT SET THE CLOCK THAT THROTTLES ITS AGENT KICK (bug round
-- 2026-11-08, lane mail: NB-14).
--
-- agent_kick_on_mandate (20260805010000) starts an apply-agent run when a
-- mandate is created or switched on, at most once per five minutes per
-- mandate. The five minutes were read from NEW.last_prepare_kick_at, a
-- column the account itself may write (agent_mandates is granted to
-- authenticated whole-row, 20260721185654), so any signed-in account could
-- send last_prepare_kick_at = NULL with every toggle of active and fire the
-- kick as often as it liked.
--
-- WHAT HOLDS NOW:
--   - the function keeps the stamp the database wrote: on an UPDATE by a
--     client role (anon or authenticated) NEW.last_prepare_kick_at is put
--     back to OLD's before the throttle reads it, and on a client INSERT it
--     starts empty. Our own service-role writers (agent-mcp's pass head
--     start) still set it;
--   - while the apply agent is switched off (APPLY_AGENT_ON false in
--     _shared/apply-agent-switch.ts since 2026-10-11) nothing is attached to
--     the table at all: the trigger agent_mandates_kick_prepare is dropped,
--     so no client write reaches agent_prepare_now. The hourly run stays the
--     floor it always was. Switching the agent back on re-attaches it with
--       CREATE TRIGGER agent_mandates_kick_prepare
--         BEFORE INSERT OR UPDATE OF active, last_prepare_kick_at
--         ON public.agent_mandates FOR EACH ROW
--         EXECUTE FUNCTION public.agent_kick_on_mandate();
--     (the stamp column is named so a client write of it alone is put back).
--
-- Re-runnable: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, explicit REVOKE.

CREATE OR REPLACE FUNCTION public.agent_kick_on_mandate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The throttle's clock is the database's: a client role's value is
  -- replaced by the one already stored (none on a new row).
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.last_prepare_kick_at := OLD.last_prepare_kick_at;
    ELSE
      NEW.last_prepare_kick_at := NULL;
    END IF;
  END IF;

  IF NOT COALESCE(NEW.active, false) THEN
    RETURN NEW;
  END IF;

  -- Five minutes since the last kick the database recorded; never kicked is
  -- eligible.
  IF NEW.last_prepare_kick_at IS NOT NULL
     AND NEW.last_prepare_kick_at > now() - interval '5 minutes' THEN
    RETURN NEW;
  END IF;

  NEW.last_prepare_kick_at := now();

  -- Never fail the save: the hourly run is the floor.
  BEGIN
    PERFORM public.agent_prepare_now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_kick_on_mandate() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.agent_kick_on_mandate() IS
  'Starts an apply-agent run when a mandate is created or switched on, throttled to one kick per five minutes by the stamp the database wrote (a client role''s last_prepare_kick_at is ignored). Not attached while the apply agent is switched off; see 20261112161000 for the trigger that re-attaches it. NB-14.';

DROP TRIGGER IF EXISTS agent_mandates_kick_prepare ON public.agent_mandates;

-- SELF-CHECK
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.agent_kick_on_mandate()')::oid;
  v_src text;
  v_bad text[] := ARRAY[]::text[];
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'NB-14 self-check failed: public.agent_kick_on_mandate() is missing';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_oid;
  IF position('OLD.last_prepare_kick_at' IN v_src) = 0 OR position('auth.role()' IN v_src) = 0 THEN
    v_bad := v_bad || 'agent_kick_on_mandate still reads the stamp a client sent'::text;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    v_bad := v_bad || 'agent_kick_on_mandate is executable by anon or authenticated'::text;
  END IF;
  IF NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false) THEN
    v_bad := v_bad || 'agent_kick_on_mandate is not SECURITY DEFINER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.agent_mandates'::regclass
                AND t.tgfoid = v_oid
                AND NOT t.tgisinternal) THEN
    v_bad := v_bad || 'a trigger on agent_mandates still runs agent_kick_on_mandate while the agent is switched off'::text;
  END IF;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'NB-14 self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'no client write can fire or unthrottle the agent kick';
END $$;
