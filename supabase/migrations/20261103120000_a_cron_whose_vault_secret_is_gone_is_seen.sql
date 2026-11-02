-- A CRON WHOSE VAULT SECRET IS GONE IS SEEN (audit 2026-10-31, S13-081).
--
-- WHAT WAS WRONG. Thirteen function crons post only WHERE EXISTS a vault
-- secret (the heartbeat, the digests, the error-spike check, the layoff jobs
-- and more), so that a cron scheduled before its key is set does nothing
-- instead of posting a refused call. A secret deleted or renamed later has the
-- same effect, forever: each run 'succeeds' in no time and posts nothing, so
-- pg_net records no answer (cron_http_answers sees nothing to judge) and
-- cron.job_run_details records no failure (get_cron_health sees nothing to
-- judge). mail-watch, the one reader that rings, could not tell such a job
-- from a healthy one.
--
-- WHAT THIS ADDS. Two read-only functions, service_role only:
--   public.cron_command_secret_names(text) - the vault secret names a cron
--     command reads (each `decrypted_secrets ... name = '<name>'`), sorted
--     and distinct; pure, so this file checks it on the command shapes the
--     repo's crons use.
--   public.cron_disarmed_jobs() - every ACTIVE pg_cron job whose command
--     reads a vault secret that does not exist, with the missing name. Never
--     a command's text and never a secret's value: a job name and a secret
--     name. Nothing where pg_cron or the vault is absent.
-- mail-watch R10 (2026-11-03.1) reads the second and rings, naming the job
-- and the secret it waits for.
--
-- Depends on: nothing of ours (pg_cron's cron.job and Supabase Vault's
-- vault.decrypted_secrets, both read only when present).
-- Safe to re-run (CREATE OR REPLACE, grants restated). Verify:
-- src/test/mail-watch-judges-each-order-by-its-own-mail-and-rings-for-any-failing-job.test.ts
-- runs this file twice in pglite from Supabase's default grants, with a cron
-- and a vault of its own; the DO block below checks the catalogue, the grants
-- and the name reader, and, where pg_cron is installed, that the reader runs.

CREATE OR REPLACE FUNCTION public.cron_command_secret_names(p_command text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(DISTINCT m.hit[1] ORDER BY m.hit[1]), '{}'::text[])
    FROM regexp_matches(
           coalesce(p_command, ''),
           'decrypted_secrets[^)]*?\mname\s*=\s*''([A-Za-z0-9_.:-]+)''',
           'gi'
         ) AS m(hit);
$$;

REVOKE ALL ON FUNCTION public.cron_command_secret_names(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_command_secret_names(text) TO service_role;

COMMENT ON FUNCTION public.cron_command_secret_names(text) IS
  'The vault secret names a cron command reads (decrypted_secrets ... name = ''<name>''), sorted and distinct. '
  'Pure. 20261103120000. service_role only.';

CREATE OR REPLACE FUNCTION public.cron_disarmed_jobs()
RETURNS TABLE (cd_jobname text, cd_missing_secret text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT j.jobname::text, n.secret_name::text
      FROM cron.job j
      CROSS JOIN LATERAL unnest(public.cron_command_secret_names(j.command)) AS n(secret_name)
     WHERE j.active
       AND NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = n.secret_name)
     ORDER BY 1, 2
  $q$;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_disarmed_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_disarmed_jobs() TO service_role;

COMMENT ON FUNCTION public.cron_disarmed_jobs() IS
  'Every active pg_cron job whose command reads a vault secret that does not exist, with the missing secret''s name: '
  'a job that runs, succeeds and posts nothing. Never a command''s text or a secret''s value. Read by mail-watch R10. '
  '20261103120000. service_role only.';

-- Self-verifying: one function of each name, the reader a definer with a
-- fixed search_path, both closed to the client roles and open to the service
-- role; the name reader finds the secret in each command shape the repo's
-- crons use and nothing in a command that reads none; and, where pg_cron and
-- the vault are installed, the reader runs.
DO $$
DECLARE
  n integer;
  f text := 'public.cron_disarmed_jobs()';
  k text := 'public.cron_command_secret_names(text)';
  v_def boolean;
  v_cfg text[];
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN ('cron_disarmed_jobs', 'cron_command_secret_names');
  IF n <> 2 THEN RAISE EXCEPTION 'cron_disarmed_jobs and cron_command_secret_names must be one function each, found %', n; END IF;
  SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg FROM pg_proc p WHERE p.oid = f::regprocedure;
  IF NOT coalesce(v_def, false) OR v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION '% is not a definer with a fixed search_path', f;
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR has_function_privilege('anon', k, 'EXECUTE') OR has_function_privilege('authenticated', k, 'EXECUTE') THEN
    RAISE EXCEPTION 'cron_disarmed_jobs or cron_command_secret_names is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', f, 'EXECUTE') OR NOT has_function_privilege('service_role', k, 'EXECUTE') THEN
    RAISE EXCEPTION 'cron_disarmed_jobs or cron_command_secret_names is not executable by the service role';
  END IF;

  IF public.cron_command_secret_names($c$SET statement_timeout = '5min'; SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/mail-watch',
       headers := jsonb_build_object('x-email-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_cron_key')))
     WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'email_cron_key');$c$) IS DISTINCT FROM ARRAY['email_cron_key']
     OR public.cron_command_secret_names($c$SELECT net.http_post(url := 'u', headers := jsonb_build_object('x-layoff-key',
       (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name='layoff_cron_key' LIMIT 1), 'x-alerts', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'alerts_cron_key')))$c$)
        IS DISTINCT FROM ARRAY['alerts_cron_key', 'layoff_cron_key']
     OR public.cron_command_secret_names('SELECT public.refresh_stats_cache()') IS DISTINCT FROM '{}'::text[]
     OR public.cron_command_secret_names($c$SELECT 1 FROM cron.job WHERE jobname = 'x'$c$) IS DISTINCT FROM '{}'::text[]
     OR public.cron_command_secret_names(NULL) IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION 'cron_command_secret_names does not read the vault secret names a cron command reads';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    PERFORM count(*) FROM public.cron_disarmed_jobs();
  END IF;
END $$;
