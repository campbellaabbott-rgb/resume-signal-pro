// deploy-stamp: 2026-07-04T18:44Z
// Returns the caller's Resume Booster Pro status. Accepts either a signed-in
// user's JWT (preferred) or an explicit email in the body (used right after
// checkout before the user has an account). Live-checks Stripe and refreshes
// the pro_subscribers cache.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkProByEmail } from "../_shared/pro.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Prefer the authenticated user's email over anything in the body.
    let email = "";
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const { data } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (data?.user?.email) email = data.user.email.toLowerCase();
    }
    if (!email) {
      const body = await req.json().catch(() => ({}));
      if (typeof body.email === "string") email = body.email.trim().toLowerCase();
    }
    if (!email) {
      return new Response(JSON.stringify({ active: false, status: "no_email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache-first: a pro_subscribers row refreshed within the last hour skips
    // the Stripe round trip entirely — this endpoint fires on every /pricing
    // and /account view, and Stripe rate limits are not a thing to discover
    // on a high-traffic day. `force: true` in the body bypasses (used right
    // after checkout returns).
    try {
      const { data: row } = await supabase
        .from("pro_subscribers")
        .select("status, current_period_end, updated_at")
        .eq("email", email)
        .maybeSingle();
      if (row && new Date(row.updated_at).getTime() > Date.now() - 3600 * 1000) {
        const active = ["active", "trialing"].includes(row.status) &&
          (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now() - 24 * 3600 * 1000);
        return new Response(
          JSON.stringify({ active, status: row.status, currentPeriodEnd: row.current_period_end, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch (_) { /* fall through to live check */ }

    const status = await checkProByEmail(stripe, supabase, email);
    return new Response(
      JSON.stringify({ active: status.active, status: status.status, currentPeriodEnd: status.currentPeriodEnd }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[CHECK-SUBSCRIPTION] Error:", error);
    return new Response(JSON.stringify({ active: false, error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
