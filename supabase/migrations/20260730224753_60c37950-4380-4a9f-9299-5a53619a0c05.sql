-- 20260730050000_sent_today_revoke_public.sql
REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agent_sent_today(p_user uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user) THEN
    RAISE EXCEPTION 'agent_sent_today: you may only read your own count'
      USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*)::integer
    FROM public.agent_submissions
    WHERE user_id = p_user
      AND submitted_at >= date_trunc('day', now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_sent_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_sent_today(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.agent_sent_today(uuid) IS
  'Daily send count. Service role may ask about any user; an authenticated caller may only ask about itself; anon is refused twice over (REVOKE, and an auth.role() check inside). A GRANT alone does not remove the default PUBLIC grant.';

-- 20260730060000_resume_bucket_split.sql (bucket itself already exists and is private)
COMMENT ON COLUMN public.agent_mandates.resume_file_url IS
  'Storage path inside the private `resumes` bucket, shaped {user_id}/{filename} — NOT a public URL. The worker downloads it with the service key at submit time.';

-- 20260730070000_definer_lockdown.sql
DO $do$
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
      AND p.proname = ANY (ARRAY[
        'add_scan_credits',
        'save_purchased_content',
        'get_purchased_content_by_email',
        'get_purchased_content_by_session',
        'get_failed_deliveries_for_retry',
        'update_delivery_retry',
        'record_affiliate_conversion',
        'increment_free_scan_count',
        'roll_up_and_prune_closures',
        'cleanup_expired_analyses',
        'cleanup_expired_stripe_sessions',
        'cleanup_expired_temp_resumes',
        'cleanup_old_rate_limits',
        'enqueue_email',
        'read_email_batch',
        'delete_email',
        'move_to_dlq',
        'log_email_send',
        'acquire_scan_slot',
        'release_scan_slot',
        'check_rate_limit',
        'check_global_rate_limit',
        'build_speed_indexes_oneshot',
        'refresh_explore_cache',
        'refresh_stats_cache',
        'seed_embedding_row',
        'get_empty_boards',
        'log_webhook_event',
        'log_delivery_step',
        'track_ab_event',
        'track_ab_event_optimized',
        'get_ab_test_stats'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'definer lockdown: % function signature(s) restricted to service_role', n;
  IF n = 0 THEN
    RAISE WARNING 'definer lockdown matched NOTHING — the function names may have changed';
  END IF;
END
$do$;