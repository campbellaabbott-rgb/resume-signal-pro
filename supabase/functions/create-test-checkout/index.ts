import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Test mode products - these should be created in your Stripe TEST dashboard
// For now, we'll create test products dynamically using price_data
const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-TEST-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid request format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { productId, productName, priceUsd } = requestBody;

    if (!productId || !productName || !priceUsd) {
      logStep("Missing required fields", { productId, productName, priceUsd });
      return new Response(
        JSON.stringify({ error: "Missing productId, productName, or priceUsd" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Request validated", { productId, productName, priceUsd });

    // Initialize Stripe with TEST key
    const stripeTestKey = Deno.env.get("STRIPE_TEST_SECRET_KEY");
    if (!stripeTestKey) {
      console.error("[CREATE-TEST-CHECKOUT] STRIPE_TEST_SECRET_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Test mode not configured. Please add STRIPE_TEST_SECRET_KEY." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify it's actually a test key
    if (!stripeTestKey.startsWith("sk_test_")) {
      console.error("[CREATE-TEST-CHECKOUT] STRIPE_TEST_SECRET_KEY is not a test key");
      return new Response(
        JSON.stringify({ error: "Invalid test key configuration" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeTestKey, { apiVersion: "2025-12-15.clover" });
    const origin = req.headers.get("origin") || "https://lovable.dev";

    // Create checkout session with price_data (for testing without pre-created prices)
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `[TEST] ${productName}`,
              description: `Test checkout for ${productId}`,
            },
            unit_amount: Math.round(priceUsd * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/dev/checkout-test?success=true&product=${productId}`,
      cancel_url: `${origin}/dev/checkout-test?canceled=true`,
      metadata: {
        test_mode: "true",
        product_id: productId,
        product_name: productName,
      },
    });

    logStep("Test checkout session created", { 
      sessionId: session.id, 
      product: productName,
      amount: priceUsd
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-TEST-CHECKOUT] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: `Test checkout failed: ${errorMessage}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
