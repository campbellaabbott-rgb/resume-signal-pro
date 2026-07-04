// deploy-stamp: 2026-07-04T18:44Z
// Creates a Stripe Checkout session for Resume Booster Pro — $45/month,
// all current and future consumer tools included. Uses inline recurring
// price_data so no Price object needs to exist in the Stripe dashboard.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkProByEmail, PRO_PRICE_CENTS, PRO_PRODUCT_NAME } from "../_shared/pro.ts";

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

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "A valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Don't double-bill someone who already has an active subscription.
    const existing = await checkProByEmail(stripe, supabase, email);
    if (existing.active) {
      return new Response(JSON.stringify({ alreadySubscribed: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "https://resumebooster.work";
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: PRO_PRICE_CENTS,
            recurring: { interval: "month" },
            product_data: {
              name: PRO_PRODUCT_NAME,
              description:
                "Every Resume Booster tool included — full analysis, keyword fix, cover letters, interview coach, career simulator, premium packages, unlimited scans, plus every new tool we ship.",
            },
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: `${origin}/account?pro=success`,
      cancel_url: `${origin}/pricing?pro=cancelled`,
      metadata: { product_type: "pro_subscription", customer_email: email },
    });

    console.log(`[CREATE-SUBSCRIPTION-CHECKOUT] Session ${session.id} created for ${email}`);
    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[CREATE-SUBSCRIPTION-CHECKOUT] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
