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