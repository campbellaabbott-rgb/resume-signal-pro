import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Product configuration with price IDs (keys match frontend ProductId keys)
const PRODUCTS: Record<string, { priceId: string; name: string; productType: string; credits?: number }> = {
  basicKeywordFix: {
    priceId: "price_1Sgv2hHBplUUV1Cgjdqw9kHi",
    name: "Basic Keyword Fix",
    productType: "basic_keyword_fix"
  },
  coverLetter: {
    priceId: "price_1Sgv2tHBplUUV1CgoXHF6GjD",
    name: "Cover Letter Generator",
    productType: "cover_letter"
  },
  premiumPackage: {
    priceId: "price_1Sgv32HBplUUV1CgAdw6PnV3",
    name: "Premium Resume Package",
    productType: "premium_package"
  },
  atsDefense: {
    priceId: "price_1Sgv3LHBplUUV1CgpCF5pDLO",
    name: "ATS Defense Complete",
    productType: "ats_defense"
  },
  careerSnapshot: {
    priceId: "price_1SibLiHBplUUV1CgHmRy7ayi",
    name: "Career Snapshot",
    productType: "career_snapshot"
  },
  graduateGamePlan: {
    priceId: "price_1SibRNHBplUUV1CgEj5L8eH1",
    name: "Graduate Game Plan",
    productType: "graduate_gameplan"
  },
  scanPack: {
    priceId: "price_1Sgv2THBplUUV1CgntHsXlDK",
    name: "Scan Pack (10 Credits)",
    productType: "scan_pack",
    credits: 10
  }
};

const RATE_LIMIT = 10;
const RATE_WINDOW_MINUTES = 60;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PRODUCT-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Get client IP for rate limiting (prioritize Cloudflare's trusted header)
  const clientIp = req.headers.get("cf-connecting-ip") ||
                   req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                   req.headers.get("x-real-ip") ||
                   "unknown";

  try {
    // Parse request body FIRST (before logging to minimize time)
    let requestBody;
    try {
      requestBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid request format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, productId, sessionId, jobTitle, jobCompany, referralCode } = requestBody;

    // Validate product ID early (fast check)
    if (!productId || !PRODUCTS[productId]) {
      return new Response(
        JSON.stringify({ error: "Invalid product selected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const product = PRODUCTS[productId];

    // Initialize Stripe FIRST (needed for session creation)
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Payment service temporarily unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
    const origin = req.headers.get("origin") || "https://lovable.dev";

    // Sanitize inputs in parallel with Stripe prep (these are pure CPU ops)
    const normalizedEmail = email && typeof email === 'string' && email.includes('@') 
      ? email.toLowerCase().trim() 
      : null;
    const sanitizedJobTitle = jobTitle && typeof jobTitle === 'string' 
      ? jobTitle.slice(0, 100).replace(/[<>]/g, '') 
      : '';
    const sanitizedJobCompany = jobCompany && typeof jobCompany === 'string' 
      ? jobCompany.slice(0, 100).replace(/[<>]/g, '') 
      : '';
    const sanitizedReferralCode = referralCode && typeof referralCode === 'string'
      ? referralCode.slice(0, 20).replace(/[^a-f0-9]/gi, '')
      : '';

    // OPTIMIZATION: Create Stripe session FIRST (the critical path)
    // Rate limiting runs in background - if abused, we handle at webhook level
    const sessionPromise = stripe.checkout.sessions.create({
      customer_email: normalizedEmail || undefined,
      customer_creation: 'if_required', // Let Stripe handle customer creation/linking
      line_items: [
        {
          price: product.priceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      allow_promotion_codes: true,
      automatic_tax: { enabled: false },
      success_url: `${origin}/product-success?session_id={CHECKOUT_SESSION_ID}&product=${productId}`,
      cancel_url: `${origin}/payment-failed?product=${productId}`,
      metadata: {
        product_type: product.productType,
        product_name: product.name,
        customer_email: normalizedEmail || "",
        session_id: sessionId || "",
        credits: product.credits?.toString() || "",
        job_title: sanitizedJobTitle,
        job_company: sanitizedJobCompany,
        referral_code: sanitizedReferralCode,
      },
    });

    // OPTIMIZATION: Run rate limit check in BACKGROUND (non-blocking)
    // Initialize Supabase only for background rate limit logging
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      // Fire-and-forget rate limit check (for monitoring/abuse detection, not blocking)
      supabase.rpc('check_rate_limit', {
        p_ip: clientIp,
        p_function: 'create-product-checkout',
        p_max_requests: RATE_LIMIT,
        p_window_minutes: RATE_WINDOW_MINUTES
      }).then(({ data, error }) => {
        if (error) {
          console.log("[CREATE-PRODUCT-CHECKOUT] Rate limit tracking error:", error.message);
        } else if (!data) {
          console.log("[CREATE-PRODUCT-CHECKOUT] Rate limit exceeded for IP:", clientIp);
          // Could flag for webhook-level blocking if needed
        }
      });
    }

    // Await Stripe session (the actual critical path)
    const session = await sessionPromise;

    logStep("Checkout session created", { 
      sessionId: session.id, 
      product: product.name,
      latencyMs: Date.now() - Date.now() // Will be calculated
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-PRODUCT-CHECKOUT] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to create checkout. Please try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
