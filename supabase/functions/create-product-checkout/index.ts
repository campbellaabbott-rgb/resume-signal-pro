import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Product configuration with price IDs (keys match frontend ProductId keys).
// Most products reference a pre-created Stripe Price object (priceId). applyAssistant
// instead uses inline priceData — Stripe creates an ephemeral price per checkout
// session from currency + unitAmount, so no Price object needs to exist in the
// Stripe dashboard beforehand. Both are valid, fully-supported Stripe patterns.
const PRODUCTS: Record<string, { priceId?: string; priceData?: { unitAmount: number; currency: string }; name: string; productType: string; credits?: number }> = {
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
  },
  applyAssistant: {
    priceData: { unitAmount: 700, currency: "usd" }, // $7.00
    name: "Apply Assistant",
    productType: "apply_assistant"
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

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: rlAllowed } = await supabase.rpc("check_rate_limit", { p_function: "create-product-checkout", p_ip: clientIp, p_max_requests: 30, p_window_minutes: 60 });
  if (!rlAllowed) return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Parse body inline without extra try-catch nesting
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ error: "Invalid request format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, productId, sessionId, jobTitle, jobCompany, referralCode, language } = body;

    // Validate product ID (fast sync check)
    const product = PRODUCTS[productId];
    if (!product || (!product.priceId && !product.priceData)) {
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
    // Allowlist against the site's actual supported languages — this flows
    // into an AI prompt server-side later (generation happens from the
    // webhook, which has no access to the browser's i18n state), so it must
    // be captured at checkout time, not assumed.
    const SUPPORTED_LANGUAGES = ['en', 'en-GB', 'es', 'hi', 'tl', 'de', 'fr', 'fr-CA', 'nl', 'pt'];
    const sanitizedLanguage = typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language) ? language : 'en';

    // Pro subscribers get every tool included: instead of a Stripe session,
    // issue a single-use server-side grant and send them straight to the
    // success page. Cache-only check keeps this path fast; the cache is
    // refreshed by check-subscription and the subscription checkout flow.
    if (normalizedEmail) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } },
        );
        const { data: proRow } = await supabase
          .from("pro_subscribers")
          .select("status, current_period_end")
          .eq("email", normalizedEmail)
          .maybeSingle();
        const proActive = !!proRow && ["active", "trialing"].includes(proRow.status) &&
          (!proRow.current_period_end || new Date(proRow.current_period_end).getTime() > Date.now() - 24 * 3600 * 1000);
        if (proActive) {
          const { data: grant, error: grantError } = await supabase
            .from("pro_grants")
            .insert({
              email: normalizedEmail,
              product_id: productId,
              product_type: product.productType,
              product_name: product.name,
              credits: product.credits ?? null,
              resume_session_id: sessionId || null,
              job_title: sanitizedJobTitle || null,
              job_company: sanitizedJobCompany || null,
              language: sanitizedLanguage,
            })
            .select("id")
            .single();
          if (!grantError && grant) {
            console.log(`[CREATE-PRODUCT-CHECKOUT] Pro grant ${grant.id} issued to ${normalizedEmail} for ${product.name}`);
            return new Response(
              JSON.stringify({
                url: `${origin}/product-success?session_id=pro_${grant.id}&product=${productId}`,
                sessionId: `pro_${grant.id}`,
                proIncluded: true,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
            );
          }
          console.error("[CREATE-PRODUCT-CHECKOUT] Pro grant insert failed, falling back to Stripe:", grantError?.message);
        }
      } catch (proErr) {
        // Pro check is best-effort — never block a paying customer.
        console.error("[CREATE-PRODUCT-CHECKOUT] Pro check failed:", proErr);
      }
    }

    // Create Stripe session - THE ONLY blocking call
    const session = await stripe.checkout.sessions.create({
      customer_email: normalizedEmail || undefined,
      customer_creation: 'if_required',
      line_items: [
        product.priceId
          ? { price: product.priceId, quantity: 1 }
          : {
              price_data: {
                currency: product.priceData!.currency,
                product_data: { name: product.name },
                unit_amount: product.priceData!.unitAmount,
              },
              quantity: 1,
            }
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
        language: sanitizedLanguage,
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
