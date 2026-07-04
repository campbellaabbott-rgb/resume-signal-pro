// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Admin-only, one-off utility for minting test coupons. Gated the same way as
// get-analytics/get-error-telemetry — without this gate, anyone who discovered
// the endpoint could call it repeatedly to mint unlimited 100%-off codes against
// live Stripe. Not meant to be called from the frontend; invoke directly with
// the admin key when you actually need a coupon.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const adminApiKey = Deno.env.get("ADMIN_API_KEY");
    const authHeader = req.headers.get("x-admin-key") || req.headers.get("authorization")?.replace("Bearer ", "");

    if (!adminApiKey || authHeader !== adminApiKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
    const isLiveMode = stripeKey.startsWith("sk_live_");

    const body = await req.json().catch(() => ({}));
    const code = (body.code || "TESTFREE48").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const expiresInHours = typeof body.expiresInHours === "number" ? body.expiresInHours : 48;

    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "once",
      max_redemptions: 1,
      name: `Test coupon (${code})`,
    });

    const promotionCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code,
      max_redemptions: 1,
      expires_at: Math.floor(Date.now() / 1000) + expiresInHours * 3600,
    });

    return new Response(
      JSON.stringify({
        success: true,
        code: promotionCode.code,
        couponId: coupon.id,
        promotionCodeId: promotionCode.id,
        expiresAt: new Date(promotionCode.expires_at! * 1000).toISOString(),
        isLiveMode,
        warning: isLiveMode
          ? "This Stripe key is in LIVE mode — this is a real coupon against real payments."
          : "This Stripe key is in TEST mode — no real money is involved regardless of the coupon.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-TEST-COUPON] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
