-- Performance optimization: Add indexes for frequently queried columns

-- Index on ab_test_events for faster analytics queries
CREATE INDEX IF NOT EXISTS idx_ab_test_events_test_name_created 
ON public.ab_test_events(test_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ab_test_events_visitor_id 
ON public.ab_test_events(visitor_id);

-- Index on free_scan_leads for faster email lookups
CREATE INDEX IF NOT EXISTS idx_free_scan_leads_email 
ON public.free_scan_leads(email);

CREATE INDEX IF NOT EXISTS idx_free_scan_leads_created_at 
ON public.free_scan_leads(created_at DESC);

-- Index on temp_resume_storage for session lookups
CREATE INDEX IF NOT EXISTS idx_temp_resume_storage_expires_at 
ON public.temp_resume_storage(expires_at);

-- Index on rate_limits for faster lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start 
ON public.rate_limits(window_start);

-- Index on error_telemetry for monitoring
CREATE INDEX IF NOT EXISTS idx_error_telemetry_created_at 
ON public.error_telemetry(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_telemetry_function_name 
ON public.error_telemetry(function_name, created_at DESC);

-- Index on ai_response_cache for cache lookups
CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires_at 
ON public.ai_response_cache(expires_at);

-- Index on used_stripe_sessions for verification
CREATE INDEX IF NOT EXISTS idx_used_stripe_sessions_used_at 
ON public.used_stripe_sessions(used_at DESC);

-- Index on affiliate tables for dashboard queries
CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_created_at 
ON public.affiliate_conversions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_created_at 
ON public.affiliate_clicks(created_at DESC);