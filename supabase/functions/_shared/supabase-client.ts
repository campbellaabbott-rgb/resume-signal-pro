/**
 * Optimized Supabase client factory for edge functions
 * Uses connection pooling hints and keep-alive for reduced latency
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Module-level cache for singleton pattern
let serviceClient: any = null;
let anonClient: any = null;

// Custom fetch with keep-alive and connection reuse hints
const optimizedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  
  // Connection reuse hints
  headers.set('Connection', 'keep-alive');
  headers.set('Keep-Alive', 'timeout=30, max=100');
  
  return fetch(input, {
    ...init,
    headers,
    // @ts-ignore - Deno supports keepalive
    keepalive: true,
  });
};

// Supabase client options optimized for edge functions
const getClientOptions = () => ({
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: optimizedFetch,
    headers: {
      'X-Client-Info': 'supabase-edge-function',
    },
  },
});

/**
 * Get or create a service role Supabase client (cached at module level)
 * Use for admin operations, bypassing RLS
 */
export function getServiceClient(): any {
  if (serviceClient) return serviceClient;
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('[SUPABASE-CLIENT] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return null;
  }
  
  serviceClient = createClient(supabaseUrl, supabaseKey, getClientOptions());
  return serviceClient;
}

/**
 * Get or create an anonymous Supabase client (cached at module level)
 * Use for user-facing operations that respect RLS
 */
export function getAnonClient(): any {
  if (anonClient) return anonClient;
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('[SUPABASE-CLIENT] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return null;
  }
  
  anonClient = createClient(supabaseUrl, supabaseKey, getClientOptions());
  return anonClient;
}

/**
 * Quick database ping to warm up connection pool
 * Returns latency in ms
 */
export async function warmConnection(client: any): Promise<number> {
  const start = Date.now();
  try {
    await client.from('heartbeat_results').select('id').limit(1);
    return Date.now() - start;
  } catch {
    return Date.now() - start;
  }
}
