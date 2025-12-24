-- Drop the duplicate function with UUID parameter type (keep the TEXT version)
DROP FUNCTION IF EXISTS public.track_ab_event_optimized(
  p_test_name text,
  p_variant text,
  p_event_type text,
  p_visitor_id uuid,
  p_metadata jsonb,
  p_client_ip text,
  p_max_requests integer,
  p_window_minutes integer
);

-- Also fix the get_temp_resume function overloading issue
DROP FUNCTION IF EXISTS public.get_temp_resume(p_session_id uuid);