import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

// OPTIMIZATION: Removed Supabase import - rate limiting done at webhook level
// This reduces cold start and removes a DB dependency from the critical path

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
  interviewCoach: {
    priceId: "price_1T8u3pHBplUUV1CgN5CDJGEF",
    name: "Interview Coach",
    productType: "interview_coach"
  },
  careerPathSimulator: {
    priceId: "price_1T8u4NHBplUUV1CggBvfeDT0",
    name: "Career Path Simulator",
    productType: "career_path_simulator"
  },
  scanPack: {
    priceId: "price_1Sgv2THBplUUV1CgntHsXlDK",
    name: "Scan Pack (10 Credits)",
    productType: "scan_pack",
    credits: 10
  }
};

// OPTIMIZATION: Move Stripe initialization outside handler (module-level singleton)
// This reuses the connection across warm invocations
let stripeInstance: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeInstance) {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    stripeInstance = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
  }
  return stripeInstance;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // OPTIMIZATION: Parse body inline without extra try-catch nesting
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ error: "Invalid request format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, productId, sessionId, jobTitle, jobCompany, referralCode } = body;

    // Validate product ID (fast sync check)
    const product = PRODUCTS[productId];
    if (!product) {
      return new Response(
        JSON.stringify({ error: "Invalid product selected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // OPTIMIZATION: Get Stripe instance (reused from module-level)
    const stripe = getStripe();
    const origin = req.headers.get("origin") || "https://lovable.dev";

    // Sanitize inputs (pure CPU, very fast)
    const normalizedEmail = email?.includes?.('@') ? email.toLowerCase().trim() : null;
    const sanitizedJobTitle = typeof jobTitle === 'string' ? jobTitle.slice(0, 100).replace(/[<>]/g, '') : '';
    const sanitizedJobCompany = typeof jobCompany === 'string' ? jobCompany.slice(0, 100).replace(/[<>]/g, '') : '';
    const sanitizedReferralCode = typeof referralCode === 'string' ? referralCode.slice(0, 20).replace(/[^a-f0-9]/gi, '') : '';

    // Create Stripe session - THE ONLY blocking call
    const session = await stripe.checkout.sessions.create({
      customer_email: normalizedEmail || undefined,
      customer_creation: 'if_required',
      line_items: [{ price: product.priceId, quantity: 1 }],
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

    console.log(`[CREATE-PRODUCT-CHECKOUT] Session created: ${session.id} for ${product.name}`);

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[CREATE-PRODUCT-CHECKOUT] Error:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: "Failed to create checkout. Please try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
