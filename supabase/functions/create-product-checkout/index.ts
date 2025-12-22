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
  careerBundle: {
    priceId: "price_1Sgv3rHBplUUV1CgC3N97S71",
    name: "Career Bundle (75 Analyses)",
    productType: "career_bundle",
    credits: 75
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

    const { email, productId, sessionId, jobTitle, jobCompany, referralCode } = requestBody;

    // Validate product ID
    if (!productId || !PRODUCTS[productId]) {
      logStep("Invalid product ID", { productId });
      return new Response(
        JSON.stringify({ error: "Invalid product selected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Email is optional - Stripe will collect it during checkout if not provided
    const normalizedEmail = email && typeof email === 'string' && email.includes('@') 
      ? email.toLowerCase().trim() 
      : null;
    
    // Sanitize job details (limit length, remove dangerous chars)
    const sanitizedJobTitle = jobTitle && typeof jobTitle === 'string' 
      ? jobTitle.slice(0, 100).replace(/[<>]/g, '') 
      : '';
    const sanitizedJobCompany = jobCompany && typeof jobCompany === 'string' 
      ? jobCompany.slice(0, 100).replace(/[<>]/g, '') 
      : '';
    
    // Sanitize referral code
    const sanitizedReferralCode = referralCode && typeof referralCode === 'string'
      ? referralCode.slice(0, 20).replace(/[^a-f0-9]/gi, '')
      : '';
    
    const product = PRODUCTS[productId];
    logStep("Request validated", { 
      email: normalizedEmail || 'will be collected by Stripe', 
      productId, 
      productName: product.name,
      jobTitle: sanitizedJobTitle || 'not provided',
      jobCompany: sanitizedJobCompany || 'not provided',
      referralCode: sanitizedReferralCode || 'none'
    });

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limit check
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'create-product-checkout',
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rlError) {
      console.error("[CREATE-PRODUCT-CHECKOUT] Rate limit check error:", rlError);
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
      console.error("[CREATE-PRODUCT-CHECKOUT] STRIPE_SECRET_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Payment service temporarily unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || "https://lovable.dev";

    // Check if customer exists (only if email provided)
    let customerId: string | undefined;
    if (normalizedEmail) {
      const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        logStep("Found existing customer", { customerId });
      }
    }

    // Create checkout session - Stripe will collect email if not provided
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : (normalizedEmail || undefined),
      line_items: [
        {
          price: product.priceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      allow_promotion_codes: true,
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

    logStep("Checkout session created", { 
      sessionId: session.id, 
      email: normalizedEmail, 
      product: product.name,
      hasReferral: !!sanitizedReferralCode
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
