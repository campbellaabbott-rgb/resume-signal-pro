// deploy-stamp: 2026-10-14T11:00Z
/**
 * AUTH-SIGNED-IN: CALLED ONCE BY THE SITE RIGHT AFTER A SIGN-IN (R1, 2026-10-14).
 *
 * POST, with the person's own access token in Authorization (verify_jwt stays
 * at the platform default, true). Runs _shared/mailbox-guard.ts for that
 * session: a fresh emailed code, link or Google sign-in proves the address
 * and clears a password set before the proof (owner decision D15).
 *
 * Answers (contract 3 of the R1 plan):
 *   200 {proven, passwordCleared, reason?, signedOut?}
 *   401 {error, reason}  no website session (none, the publishable key, a
 *                        connector's token, a token the auth server refuses)
 *   403 {error, reason}  rate_limited
 *   409 {error, reason, proven: false, passwordCleared}  the sign-in does not
 *                        vouch for the address the account carries now
 *   503 {error, reason, proven: false, passwordCleared}  a read or write
 *                        failed; nothing was recorded (fail closed)
 * Safe to call twice: the second call answers proven and changes nothing.
 *
 * The site MUST await this answer before it lets the person set a password
 * (the reset form, Account > Security): a password set before the guard has
 * run in this session is cleared with the one set before the proof.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkoutOrigin, SITE_ORIGIN } from "../_shared/checkout-policy.ts";
import { type GuardAdmin, runMailboxGuard, sessionPasswordRotator } from "../_shared/mailbox-guard.ts";
import { requireWebsiteSession } from "../_shared/website-session.ts";

// Provable from outside without a session: every response, the preflight
// included, carries this in x-fn-build.
const FN_BUILD = "auth-signed-in.2026-10-14.1";

/** At most this many calls per account per hour (the site calls once per sign-in). */
const CALLS_PER_HOUR = 20;

/** A Lovable preview of a project (the editor's own preview hosts). */
const LOVABLE_PREVIEW = /^https:\/\/(?:(?:id-preview(?:-[a-z0-9]+)?|project)--)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-dev)?\.(?:lovable\.app|lovableproject\.com)$/i;

/**
 * The browser origins this answers: our own hosts, a local dev server and an
 * exact origin listed in CHECKOUT_EXTRA_ORIGINS (the rule every checkout
 * uses, _shared/checkout-policy.ts), plus a Lovable preview host. Anything
 * else is answered with the site's own origin, which a browser refuses.
 */
function corsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get("origin") ?? "").trim();
  const allowed = !!origin && (checkoutOrigin(origin, (k) => Deno.env.get(k)) === origin || LOVABLE_PREVIEW.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : SITE_ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "x-fn-build": FN_BUILD,
    "Access-Control-Expose-Headers": "x-fn-build",
  };
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[AUTH-SIGNED-IN] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST.", reason: "method_not_allowed" }, cors);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Refused before anything is read or written: no token, the publishable
  // key, a connector's token, or one the auth server no longer accepts.
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const session = await requireWebsiteSession(req, { auth: anon.auth, headers: cors });
  if (session instanceof Response) return session;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Per account, not per address: the shared limiter (check_rate_limit).
  // Only an explicit "no" refuses; a limiter that errored lets the call on.
  try {
    const { data: allowed, error } = await admin.rpc("check_rate_limit", {
      p_ip: `user:${session.user.id}`,
      p_function: "auth-signed-in",
      p_max_requests: CALLS_PER_HOUR,
      p_window_minutes: 60,
    });
    if (error) logStep("rate limit check failed; continuing", { error: error.message });
    if (allowed === false) return json(403, { error: "Too many requests. Please try again later.", reason: "rate_limited" }, cors);
  } catch (e) {
    logStep("rate limit check threw; continuing", { error: String(e).slice(0, 200) });
  }

  try {
    const result = await runMailboxGuard(
      {
        admin: admin as unknown as GuardAdmin,
        rotateAsSession: sessionPasswordRotator(url, anonKey),
        log: logStep,
      },
      session,
    );
    logStep("answered", { userId: session.user.id, status: result.status, proven: result.body.proven, passwordCleared: result.body.passwordCleared, reason: result.body.reason ?? null });
    return json(result.status, result.body, cors);
  } catch (e) {
    logStep("guard threw", { error: String(e).slice(0, 200) });
    return json(503, { error: "We could not finish checking this sign-in. Please try again.", reason: "unavailable", proven: false, passwordCleared: false }, cors);
  }
});
