CREATE OR REPLACE FUNCTION public._mig_exec(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  EXECUTE p_sql;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mig_exec(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mig_exec(text) TO sandbox_exec;