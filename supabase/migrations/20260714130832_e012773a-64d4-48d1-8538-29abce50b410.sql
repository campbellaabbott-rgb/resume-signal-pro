create or replace function public.get_db_size_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'db_bytes',       pg_database_size(current_database()),
    'postings_bytes', coalesce(pg_total_relation_size(to_regclass('public.job_board_postings')), 0),
    'postings_rows',  coalesce((select reltuples::bigint from pg_class where oid = to_regclass('public.job_board_postings')), 0)
  );
$$;
revoke all on function public.get_db_size_stats() from public;
grant execute on function public.get_db_size_stats() to service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stripe') THEN
    PERFORM cron.schedule(
      'reconcile-stripe',
      '17 15 * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/reconcile-stripe',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"lookbackHours": 48}'::jsonb
      );
      $job$
    );
  END IF;
END $$;