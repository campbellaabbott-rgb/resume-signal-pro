




import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


let serviceClient: any = null;
let anonClient: any = null;


const optimizedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  
  
  headers.set('Connection', 'keep-alive');
  headers.set('Keep-Alive', 'timeout=30, max=100');
  
  return fetch(input, {
    ...init,
    headers,
    
    keepalive: true,
  });
};


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





export async function warmConnection(client: any): Promise<number> {
  const start = Date.now();
  try {
    await client.from('heartbeat_results').select('id').limit(1);
    return Date.now() - start;
  } catch {
    return Date.now() - start;
  }
}
