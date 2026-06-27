import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[RECOVER-PURCHASE] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, sessionId } = await req.json();

    // Require sessionId to prevent enumeration of purchases by email alone.
    // Email-only recovery is no longer permitted; users must provide their
    // Stripe checkout session ID (delivered in the post-purchase email).
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "A purchase session ID is required to recover content. Please use the link from your purchase confirmation email." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Recovery request", { email: email ? email.substring(0, 5) + "..." : undefined, hasSessionId: !!sessionId });


    // Initialize Supabase with service role for database access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let purchases: unknown[] = [];

    if (sessionId) {
      // Recover by session ID
      const { data, error } = await supabase.rpc('get_purchased_content_by_session', {
        p_session_id: sessionId
      });

      if (error) {
        logStep("Session lookup error", { error: error.message });
        throw new Error("Failed to look up purchase");
      }

      purchases = data || [];
    } else if (email) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(
          JSON.stringify({ error: "Invalid email format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Recover by email
      const { data, error } = await supabase.rpc('get_purchased_content_by_email', {
        p_email: email.toLowerCase().trim()
      });

      if (error) {
        logStep("Email lookup error", { error: error.message });
        throw new Error("Failed to look up purchases");
      }

      purchases = data || [];
    }

    logStep("Purchases found", { count: purchases.length });

    if (purchases.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          found: false,
          message: "No purchases found for this email. Please check the email address used during checkout.",
          purchases: []
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        found: true,
        purchases: purchases.map((p: any) => ({
          id: p.id,
          productType: p.product_type,
          productName: p.product_name,
          generatedContent: p.generated_content,
          createdAt: p.created_at
        }))
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[RECOVER-PURCHASE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to recover purchase", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});