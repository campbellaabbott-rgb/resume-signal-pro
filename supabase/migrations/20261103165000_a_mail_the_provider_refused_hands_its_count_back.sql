-- A MAIL THE PROVIDER REFUSED HANDS ITS COUNT BACK (S13-098, 2026-11-03).
--
-- company-claim takes its inbox and daily counts at mail_door_take
-- (20261004100000) before it calls the mail provider. When the provider
-- refused the send, or the call threw, those counts stayed taken: the inbox
-- allows two verification mails a day, so two refusals answered the claimant
-- "That address was already sent verification links today" when nothing had
-- been sent, and the global ceiling counted mail that never left.
--
-- mail_door_give hands one count back to a door, and only inside the window
-- that is still running: a window that has ended has already been reset by
-- the next take, so there is nothing of this knock left in it to return. It
-- never goes below zero and never creates a row. service_role only, like the
-- take.
--
-- Safe to re-run: CREATE OR REPLACE, explicit REVOKE and GRANT, and a
-- self-check that runs its probe on a door of its own and leaves no row.

CREATE OR REPLACE FUNCTION public.mail_door_give(
  p_door text,
  p_bucket text,
  p_window_minutes integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_given boolean;
BEGIN
  IF coalesce(length(p_door), 0) NOT BETWEEN 1 AND 64
     OR coalesce(length(p_bucket), 0) NOT BETWEEN 1 AND 64
     OR p_window_minutes IS NULL OR p_window_minutes NOT BETWEEN 1 AND 43200 THEN
    RAISE EXCEPTION 'mail_door_give: invalid arguments' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mail_door_counts c
     SET hits = c.hits - 1
   WHERE c.door = p_door
     AND c.bucket = p_bucket
     AND c.hits > 0
     AND c.window_start > now() - make_interval(mins => p_window_minutes)
  RETURNING true INTO v_given;

  RETURN coalesce(v_given, false);
END;
$$;

COMMENT ON FUNCTION public.mail_door_give(text, text, integer) IS
  'Hands one count back to a mail door whose send never left, inside the window still running; never below zero, never a new row. service_role only.';

REVOKE ALL ON FUNCTION public.mail_door_give(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_door_give(text, text, integer) TO service_role;

-- Self-verifying: the function is here, a definer with its own search_path,
-- closed to anon and authenticated and open to service_role; a one-knock door
-- refuses its second knock, opens again once the first is handed back, does
-- not go below zero, and a door with no row hands nothing back.
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.mail_door_give(text,text,integer)')::oid;
  v_door constant text := 'self-check:20261103165000';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'self-check: mail_door_give(text,text,integer) is missing';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: mail_door_give is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: mail_door_give is not executable by service_role';
  END IF;
  IF NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid), false)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
                     WHERE p.oid = v_oid AND c.setting LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'self-check: mail_door_give is not a definer with its own search_path';
  END IF;

  DELETE FROM public.mail_door_counts WHERE door = v_door;
  IF public.mail_door_give(v_door, 'probe', 60) THEN
    RAISE EXCEPTION 'self-check: mail_door_give handed back a count on a door with no row';
  END IF;
  IF NOT public.mail_door_take(v_door, 'probe', 1, 60) OR public.mail_door_take(v_door, 'probe', 1, 60) THEN
    RAISE EXCEPTION 'self-check: the probe door does not refuse its second knock';
  END IF;
  IF NOT public.mail_door_give(v_door, 'probe', 60) OR NOT public.mail_door_give(v_door, 'probe', 60) THEN
    RAISE EXCEPTION 'self-check: mail_door_give did not hand back the two counts taken';
  END IF;
  IF public.mail_door_give(v_door, 'probe', 60) THEN
    RAISE EXCEPTION 'self-check: mail_door_give went below zero';
  END IF;
  IF NOT public.mail_door_take(v_door, 'probe', 1, 60) THEN
    RAISE EXCEPTION 'self-check: a door whose count was handed back still refuses';
  END IF;
  DELETE FROM public.mail_door_counts WHERE door = v_door;
END $$;
