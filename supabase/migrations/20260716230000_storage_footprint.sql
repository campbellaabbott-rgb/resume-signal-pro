-- Scale prerequisite (runbook item): disk was unwatched, and the growth plan
-- pushes the corpus past the 300k governor toward 500k+. The heartbeat needs
-- to see storage BEFORE the 8GB plan binds — an out-of-disk Postgres is the
-- one failure mode that takes everything down at once. Service-role only:
-- operational introspection, not a public stat.
CREATE OR REPLACE FUNCTION public.get_storage_footprint()
RETURNS TABLE (postings_bytes bigint, closures_bytes bigint, db_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pg_total_relation_size('public.job_board_postings'),
    pg_total_relation_size('public.job_board_closures'),
    pg_database_size(current_database());
$$;
REVOKE EXECUTE ON FUNCTION public.get_storage_footprint() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_footprint() TO service_role;
