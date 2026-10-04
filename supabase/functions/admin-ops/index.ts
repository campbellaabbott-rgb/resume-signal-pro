// admin-ops: the owner's operations readers, behind the ADMIN_API_KEY.
//
// WHY THIS EXISTS. /health-check and /scan-metrics called nineteen SECURITY
// DEFINER readers straight from the browser with the publishable key. The page
// had a lock screen, but the lock was only UI: any visitor could call the same
// RPCs with the key in the bundle, and get_delivery_health, get_payment_health,
// get_rate_limit_stats and detect_user_error_spikes handed back buyers' emails,
// Stripe checkout session and payment_intent ids, and visitor ids. Migration
// 20261004110000 closes all nineteen to anon and authenticated. This function
// is how the dashboards still reach them: it checks x-admin-key against the
// ADMIN_API_KEY secret (the key the dashboards' AdminAuthGate already asks the
// owner for), refuses any function not on ADMIN_OPS_RPCS, and calls the
// survivor with the service role.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ADMIN_OPS_RPCS, ARG_NAME } from "./rpcs.ts";

// Provable from outside without the key: every response, the CORS preflight
// included, carries this in x-fn-build.
const FN_BUILD = "admin-ops.2026-10-04.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * Constant-time comparison. An EMPTY secret never matches anything, including
 * an empty header: an unset ADMIN_API_KEY must lock the door, not open it.
 */
export function keyMatches(presented: string, secret: string): boolean {
  if (!secret || !presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const secret = Deno.env.get("ADMIN_API_KEY") ?? "";
  if (!keyMatches(req.headers.get("x-admin-key") ?? "", secret)) {
    return json(401, { error: "Unauthorized" });
  }

  let body: { fn?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "body must be JSON: {fn, args}" });
  }
  const fn = typeof body.fn === "string" ? body.fn : "";
  if (!ADMIN_OPS_RPCS.has(fn)) return json(400, { error: `not an operations reader: ${fn || "(none)"}` });

  const args = body.args ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return json(400, { error: "args must be an object" });
  }
  for (const k of Object.keys(args)) {
    if (!ARG_NAME.test(k)) return json(400, { error: `not an argument name: ${k}` });
  }

  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc(fn, args as Record<string, unknown>);
  if (error) {
    console.error(`[ADMIN-OPS] ${fn} failed: ${error.message}`);
    return json(502, { error: error.message, code: error.code ?? null });
  }
  return json(200, { data });
});
