-- Create a table for caching AI responses
CREATE TABLE public.ai_response_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT NOT NULL,
  function_name TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);

-- Create unique index on cache_key + function_name for fast lookups
CREATE UNIQUE INDEX idx_ai_cache_key_function ON public.ai_response_cache(cache_key, function_name);

-- Create index on expires_at for cleanup queries
CREATE INDEX idx_ai_cache_expires ON public.ai_response_cache(expires_at);

-- Enable RLS but allow service role full access
ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;

-- No public access - only service role can read/write cache
-- (Edge functions use service role by default)

-- Function to get cached response
CREATE OR REPLACE FUNCTION public.get_cached_response(
  p_cache_key TEXT,
  p_function_name TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_response JSONB;
BEGIN
  -- Get response if not expired
  UPDATE public.ai_response_cache
  SET hit_count = hit_count + 1
  WHERE cache_key = p_cache_key 
    AND function_name = p_function_name
    AND expires_at > now()
  RETURNING response INTO v_response;
  
  RETURN v_response;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to store cached response
CREATE OR REPLACE FUNCTION public.store_cached_response(
  p_cache_key TEXT,
  p_function_name TEXT,
  p_response JSONB,
  p_ttl_hours INTEGER DEFAULT 24
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO public.ai_response_cache (cache_key, function_name, response, expires_at)
  VALUES (p_cache_key, p_function_name, p_response, now() + (p_ttl_hours || ' hours')::INTERVAL)
  ON CONFLICT (cache_key, function_name) 
  DO UPDATE SET 
    response = p_response,
    expires_at = now() + (p_ttl_hours || ' hours')::INTERVAL,
    hit_count = 0,
    created_at = now();
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to cleanup expired cache entries
CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.ai_response_cache
  WHERE expires_at < now();
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;