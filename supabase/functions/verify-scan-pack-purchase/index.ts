import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CREDITS_PER_PACK = 30;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-SCAN-PACK-PURCHASE] ${step}${detailsStr}`);
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

    const { sessionId } = requestBody;

    if (!sessionId || typeof sessionId !== 'string') {
      return new Response(
        JSON.stringify({ error: "Session ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Verifying session", { sessionId });

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      console.error("[VERIFY-SCAN-PACK-PURCHASE] STRIPE_SECRET_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Payment service temporarily unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    logStep("Session retrieved", { 
      status: session.payment_status, 
      email: session.customer_email,
      metadata: session.metadata
    });

    // Verify payment completed
    if (session.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({ error: "Payment not completed", verified: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify this is a scan pack purchase
    if (session.metadata?.product_type !== 'scan_pack') {
      return new Response(
        JSON.stringify({ error: "Invalid session type", verified: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get email from session
    const customerEmail = session.customer_email || session.metadata?.customer_email;
    if (!customerEmail) {
      return new Response(
        JSON.stringify({ error: "No email associated with purchase", verified: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if session already used (prevent double-crediting)
    const { data: existingUsage } = await supabase
      .from('used_stripe_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .single();

    if (existingUsage) {
      logStep("Session already used", { sessionId });
      
      // Get current credits for the email
      const { data: credits } = await supabase.rpc('get_scan_credits', { p_email: customerEmail });
      
      return new Response(
        JSON.stringify({ 
          verified: true, 
          alreadyCredited: true,
          email: customerEmail,
          credits: credits || 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Mark session as used
    await supabase.from('used_stripe_sessions').insert({
      session_id: sessionId,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 'unknown'
    });

    // Add credits to the email
    const creditsToAdd = parseInt(session.metadata?.credits || String(CREDITS_PER_PACK));
    const { data: creditSuccess, error: creditError } = await supabase.rpc('add_scan_credits', {
      p_email: customerEmail,
      p_credits: creditsToAdd
    });

    if (creditError) {
      console.error("[VERIFY-SCAN-PACK-PURCHASE] Failed to add credits:", creditError);
      return new Response(
        JSON.stringify({ error: "Failed to add credits. Please contact support.", verified: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Credits added successfully", { email: customerEmail, credits: creditsToAdd });

    // Get updated credit count
    const { data: newCredits } = await supabase.rpc('get_scan_credits', { p_email: customerEmail });

    return new Response(
      JSON.stringify({ 
        verified: true, 
        email: customerEmail,
        creditsAdded: creditsToAdd,
        totalCredits: newCredits || creditsToAdd
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[VERIFY-SCAN-PACK-PURCHASE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to verify purchase. Please contact support." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
