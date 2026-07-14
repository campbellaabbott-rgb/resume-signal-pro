-- Disk/table-size introspection for the heartbeat.
--
-- The capacity governor bounds the corpus by ROW COUNT (300k), but nothing
-- watched actual BYTES on the 8GB database plan — so we could approach disk
-- pressure blind and only discover it under load (the runbook flagged this as
-- the gate to clear before raising the governor again). This exposes read-only
-- size stats (no row data) so a heartbeat check can warn well before the tier
-- fills, and we widen it deliberately instead of reactively.
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

-- Only the heartbeat (service role) needs this; no anon/authenticated exposure.
revoke all on function public.get_db_size_stats() from public;
grant execute on function public.get_db_size_stats() to service_role;
