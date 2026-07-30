-- Close the default PUBLIC grant on server-only SECURITY DEFINER functions.
--
-- HOW THIS WAS FOUND. Fixing agent_sent_today (granted to authenticated and
-- service_role, never revoked from PUBLIC, therefore anon-callable) I wrote a
-- test that looks for the same shape everywhere else. It found four more
-- immediately, so I audited all of them: of 121 SECURITY DEFINER functions in
-- this schema, 107 rely on the default PUBLIC grant.
--
-- Most of those are harmless — read-only aggregates over data that is public
-- anyway, or functions the browser is genuinely supposed to call. This
-- migration touches only the ones where I confirmed BOTH of the following:
--   * no hand-written frontend file references them (types.ts is generated and
--     names every RPC, so it proves nothing), and
--   * every edge-function caller builds its client with the service role key —
--     checked including getServiceClient(), which is where free-keyword-scan
--     gets its client and which a naive grep for SUPABASE_SERVICE_ROLE_KEY
--     misses.
-- So revoking anon and authenticated cannot break a caller that exists today.
--
-- WHAT ANON COULD ACTUALLY DO, verified live against production with the
-- publishable key. Each of these returned 200 or a body-level error, never
-- 42501 — and get_storage_footprint DID return 42501 on the same key in the
-- same run, which is the control proving a denial would have been visible:
--
--   add_scan_credits(email, credits)   -> 400 "Invalid credit amount"
--       The function's OWN validation rejected 0 credits, which means execution
--       reached the body. A positive number would have granted paid scan
--       credits to any email. This is the whole paywall.
--
--   roll_up_and_prune_closures(days)   -> 200 {"months_rolled":0,"rows_pruned":0}
--       Probed with p_keep_days = 999999 precisely so it would delete nothing.
--       A small value deletes from the closure log — the one dataset here that
--       cannot be rebuilt from anywhere else, because it is a record of when
--       postings disappeared and nobody else keeps it.
--
--   get_purchased_content_by_email(email)   -> 200
--   get_purchased_content_by_session(id)    -> 200
--   get_failed_deliveries_for_retry(limit)  -> 200
--       Purchased content and delivery records, addressable by a customer's
--       email. Empty for the fake inputs I used; not empty for a real one.
--
--   acquire_scan_slot / release_scan_slot   -> 200 / 204
--       The concurrency limiter that keeps AI scan spend bounded. Anon could
--       release slots it never took.
--
--   update_delivery_retry(id, status)       -> 200 false
--   track_ab_event_optimized(...)           -> 400 (CHECK violation, i.e. it
--                                              reached the INSERT)
--
-- I did not probe enqueue_email, read_email_batch, delete_email, move_to_dlq or
-- the cleanup_* functions, because I could not construct a call that was
-- provably harmless — sending mail or consuming a queue is not something to
-- test against production to satisfy curiosity. They are locked here on the
-- same static evidence as the rest.
--
-- Driven off pg_proc rather than 32 hand-written signatures: overloads are
-- handled, and a mistyped argument list cannot silently revoke nothing.
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
      AND p.prosecdef                      -- SECURITY DEFINER only
      AND p.proname = ANY (ARRAY[
        -- money and entitlements
        'add_scan_credits',
        'save_purchased_content',
        'get_purchased_content_by_email',
        'get_purchased_content_by_session',
        'get_failed_deliveries_for_retry',
        'update_delivery_retry',
        'record_affiliate_conversion',
        'increment_free_scan_count',
        -- irreversible data operations
        'roll_up_and_prune_closures',
        'cleanup_expired_analyses',
        'cleanup_expired_stripe_sessions',
        'cleanup_expired_temp_resumes',
        'cleanup_old_rate_limits',
        -- the email queue: sending, reading and destroying messages
        'enqueue_email',
        'read_email_batch',
        'delete_email',
        'move_to_dlq',
        'log_email_send',
        -- spend and abuse controls; anon must not be able to move these
        'acquire_scan_slot',
        'release_scan_slot',
        'check_rate_limit',
        'check_global_rate_limit',
        -- expensive maintenance an anonymous caller could use to burn CPU
        'build_speed_indexes_oneshot',
        'refresh_explore_cache',
        'refresh_stats_cache',
        'seed_embedding_row',
        'get_empty_boards',
        -- internal telemetry and audit trails
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
  -- A silent zero would mean this migration ran and protected nothing, which is
  -- the failure mode worth being loud about.
  IF n = 0 THEN
    RAISE WARNING 'definer lockdown matched NOTHING — the function names may have changed';
  END IF;
END
$do$;

-- Deliberately NOT touched, and the reasons matter more than the list:
--
--   get_temp_resume(session_id)  — the free scanner is anonymous by design and
--     Success.tsx calls this from the browser. The session uuid is the
--     capability. Locking it would break the product. It is worth revisiting on
--     its own terms (an unguessable id is a weak boundary for résumé text) but
--     that is a design change, not a permissions fix, and not one to make
--     silently inside a security migration.
--
--   The ~60 read-only reporting functions the frontend calls directly. They
--     need review, but they are reads over largely public data, and I cannot
--     test signed-in flows from here — so quietly revoking them risks breaking
--     the account dashboards to fix nothing measured.
