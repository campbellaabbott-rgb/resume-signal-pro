// deploy-stamp: 2026-10-05T11:00Z
// Returns the caller's OWN Resume Booster Pro status.
//
// WHO IS ASKED ABOUT. This used to answer for whatever address the request
// body named, for anyone: an unauthenticated oracle for "does this person pay
// us", which also spent two or more unmetered Stripe calls per new address
// and wrote a pro_subscribers row for each (2026-10-04 completeness review).
// It now answers only about:
//   1. the signed-in caller (the auth server's word for their address), or
//   2. the address bound to a completed subscription checkout whose Stripe
//      session id the caller holds (the id is in the success URL Stripe
//      redirected them to; holding it is the proof).
// Anything else -- an address in the body included -- gets
// { active: false, status: "sign_in_required" } with no lookup at all.
//
// A live Stripe check is rate-limited per network address -- every live
// check, a signed-in one holding a session id included. A cached row saying
// the plan is live is served for an hour; a row saying it is NOT live only
// for five minutes, because a buyer who just paid must not be told "Go Pro"
// for an hour (the webhook now writes the row on payment; this is the bound
// for when it is late), and never to a caller holding the checkout they just
// completed.
//
// "NOT SUBSCRIBED" IS CACHED TOO, for the signed-in caller. checkProByEmail
// no longer creates a row for an address Stripe has no subscription for (the
// checkout's pre-check wrote one minutes before every first purchase -- L6-28),
// so without a row written here every page view by a signed-in non-subscriber
// was a fresh Stripe lookup, up to the per-address allowance (2026-10-05
// review). The row is written only when none exists (a row the webhook wrote
// first is left alone) and is trusted for the same five minutes.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkProByEmail } from "../_shared/pro.ts";
import { isOwingStatus, LIVE_SUBSCRIPTION_STATUSES } from "../_shared/subscription-standing.ts";
import { signedInEmail } from "../_shared/signed-in-email.ts";
import { buyerEmailOf } from "../_shared/buyer-email.ts";
import { clientAddressOr } from "../_shared/client-address.ts";

// Provable from outside without an account: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "check-subscription.2026-10-05.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const LIVE_CACHE_MS = 3600 * 1000;
const NOT_LIVE_CACHE_MS = 5 * 60 * 1000;
const LIVE_CHECKS_PER_HOUR = 30;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const body = await req.json().catch(() => ({})) as { sessionId?: unknown };

    const signedIn = await signedInEmail(supabase.auth, req.headers, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    let email = signedIn;
    const heldSession = typeof body.sessionId === "string" && /^cs_[A-Za-z0-9_]{8,250}$/.test(body.sessionId)
      ? body.sessionId : null;
    if (!email && !heldSession) {
      // No lookup, no Stripe call, no row: the same answer for every address.
      return json({ active: false, status: "sign_in_required" });
    }

    let stripe: Stripe | null = null;
    const stripeClient = () => {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
      return (stripe ??= new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" }));
    };
    // Fail open: a counter that cannot be read must not hide a paying
    // subscriber's plan. Only an explicit "no" refuses. Counted once per
    // request, whichever path asks first.
    let liveCheckCounted = false;
    const liveCheckAllowed = async (): Promise<boolean> => {
      liveCheckCounted = true;
      const { data } = await supabase.rpc("check_rate_limit", {
        p_function: "check-subscription",
        p_ip: clientAddressOr(req.headers),
        p_max_requests: LIVE_CHECKS_PER_HOUR,
        p_window_minutes: 60,
      });
      return data !== false;
    };

    if (!email && heldSession) {
      if (!(await liveCheckAllowed())) return json({ active: false, status: "rate_limited" }, 429);
      try {
        const session = await stripeClient().checkout.sessions.retrieve(heldSession);
        if (session.mode === "subscription" && session.status === "complete") email = buyerEmailOf(session);
      } catch (_) {
        // An unknown or malformed id proves nothing.
      }
      if (!email) return json({ active: false, status: "sign_in_required" });
    }
    const who = email as string;

    // Cache-first. This endpoint fires on every /pricing, /account and /jobs
    // view for a signed-in visitor.
    let cachedAnswer: Record<string, unknown> | null = null;
    // The row's updated_at as read, null for no row, undefined when the read
    // failed: checkProByEmail downgrades only the row seen, and "not
    // subscribed" is written only where there was none.
    let seenUpdatedAt: string | null | undefined;
    try {
      const { data: row } = await supabase
        .from("pro_subscribers")
        .select("status, current_period_end, updated_at")
        .eq("email", who)
        .maybeSingle();
      seenUpdatedAt = row ? String(row.updated_at) : null;
      if (row) {
        const live = LIVE_SUBSCRIPTION_STATUSES.has(row.status) &&
          (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now() - 24 * 3600 * 1000);
        cachedAnswer = {
          active: live,
          status: row.status,
          currentPeriodEnd: row.current_period_end,
          needsPaymentUpdate: isOwingStatus(row.status),
          cached: true,
        };
        const age = Date.now() - new Date(row.updated_at).getTime();
        // A caller holding the checkout they just completed is told the live
        // answer, never a not-live row written before they paid.
        const notLiveFor = heldSession ? 0 : NOT_LIVE_CACHE_MS;
        if (age < (live ? LIVE_CACHE_MS : notLiveFor)) return json(cachedAnswer);
      }
    } catch (_) { /* fall through to live check */ }

    // A session id in the body is not a pass: an invented cs_... string from a
    // signed-in caller used to skip this allowance on every request.
    if (!liveCheckCounted && !(await liveCheckAllowed())) {
      // Over the live-check allowance: the last known answer, said to be old,
      // rather than a "not subscribed" that may be false.
      return cachedAnswer
        ? json({ ...cachedAnswer, stale: true })
        : json({ active: false, status: "rate_limited" }, 429);
    }
    const status = await checkProByEmail(stripeClient(), supabase, who, { seenUpdatedAt });
    if (signedIn && seenUpdatedAt === null && !status.stripeCustomerId) {
      // Stripe has no subscription for this address, and checkProByEmail
      // wrote nothing: remember that for five minutes. An insert, never an
      // upsert, so a row the webhook wrote in the meantime wins (23505).
      try {
        await supabase.from("pro_subscribers").insert({
          email: who,
          stripe_customer_id: null,
          status: "inactive",
          current_period_end: null,
          updated_at: new Date().toISOString(),
        });
      } catch (_) { /* best-effort; the next view looks again */ }
    }
    return json({
      active: status.active,
      status: status.status,
      currentPeriodEnd: status.currentPeriodEnd,
      needsPaymentUpdate: isOwingStatus(status.status),
    });
  } catch (error) {
    console.error("[CHECK-SUBSCRIPTION] Error:", error);
    return json({ active: false, error: "Could not check the subscription just now." }, 500);
  }
});
