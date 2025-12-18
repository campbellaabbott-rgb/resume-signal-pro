import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCAN_PACK_PRICE_ID = "price_1SfqT8HBplUUV1Cg3McLmgI7";
const CREDITS_PER_PACK = 30;
const RATE_LIMIT = 10;
const RATE_WINDOW_MINUTES = 60;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-SCAN-PACK-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                   req.headers.get("x-real-ip") ||
                   "unknown";

  try {
    logStep("Function started", { ip: clientIp });

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

    const { email } = requestBody;

    // Validate email
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      logStep("Invalid email provided");
      return new Response(
        JSON.stringify({ error: "Valid email address is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    logStep("Email validated", { email: normalizedEmail });

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limit check
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'create-scan-pack-checkout',
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rlError) {
      console.error("[CREATE-SCAN-PACK-CHECKOUT] Rate limit check error:", rlError);
    } else if (!allowed) {
      logStep("Rate limit exceeded", { ip: clientIp });
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      console.error("[CREATE-SCAN-PACK-CHECKOUT] STRIPE_SECRET_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Payment service temporarily unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || "https://lovable.dev";

    // Check if customer exists
    const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing customer", { customerId });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : normalizedEmail,
      line_items: [
        {
          price: SCAN_PACK_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/?scan_pack_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?scan_pack_canceled=true`,
      metadata: {
        product_type: "scan_pack",
        credits: CREDITS_PER_PACK.toString(),
        customer_email: normalizedEmail,
      },
    });

    logStep("Checkout session created", { sessionId: session.id, email: normalizedEmail });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-SCAN-PACK-CHECKOUT] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to create checkout. Please try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
