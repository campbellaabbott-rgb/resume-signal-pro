// deploy-stamp: 2026-10-05T11:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkoutContextOf, recordCheckoutStart } from "../_shared/checkout-start.ts";
import { rememberCheckoutResume, tempResumeIdOf } from "../_shared/checkout-resume-ref.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { isProCached } from "../_shared/pro.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "create-product-checkout.2026-10-05.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
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
  },
  freelanceBoost: {
    priceData: { unitAmount: 2900, currency: "usd" }, // $29.00
    name: "Freelance Boost",
    productType: "freelance_boost"
  },
  freelanceTransitionPro: {
    priceData: { unitAmount: 5900, currency: "usd" }, // $59.00
    name: "Freelance Boost — Transition Pro",
    productType: "freelance_transition_pro"
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

  // The platform's word for the caller's address, never the first forwarded
  // hop, which the caller writes itself and could rotate per request.
  const clientIp = clientAddressOr(req.headers);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  // Only an explicit "no" refuses (L6-19): a counter that errored used to tell
  // a buyer "Too many requests" and lose the sale, while every other checkout
  // carried on. Logged, not fatal.
  const { data: rlAllowed, error: rlError } = await supabase.rpc("check_rate_limit", { p_function: "create-product-checkout", p_ip: clientIp, p_max_requests: 30, p_window_minutes: 60 });
  if (rlError) console.error("[CREATE-PRODUCT-CHECKOUT] Rate limit check failed; continuing:", rlError.message);
  if (rlAllowed === false) return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    // WHO IS ASKING IS DECIDED BY THE SESSION, NOT BY THE BODY.
    //
    // This block mints an ENTITLEMENT — a pro_grant redeemable for any product
    // in the catalog — and it used to key that decision on `normalizedEmail`,
    // which is just a field in an unauthenticated POST body (verify_jwt = false
    // for this function, supabase/config.toml:33-34). So anyone who knew the
    // email address of one active Pro subscriber could mint that subscriber's
    // whole paid catalogue, for free, as many times as they liked. An email
    // address is a claim; only a signed token is proof.
    //
    // Same class as the streamer leak that assertPaidSession closed, but that
    // helper CANNOT be reused here: it answers "did a purchase happen for this
    // session id", which says nothing about who is asking, and this function is
    // UPSTREAM of it — one of the writers that manufactures the proof it
    // trusts. Calling it here would be circular. The invariant it documents is
    // restored at the writer instead.
    //
    // Pattern copied from check-subscription/index.ts:31-37 ("Prefer the
    // authenticated user's email over anything in the body"), with the anon-key
    // discrimination from free-keyword-scan/index.ts:1382-1389 so the anonymous
    // path never pays for an auth round trip. getUser() on a service-role
    // client still validates the token against the auth server.
    let proEmail: string | null = null;
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (bearer && bearer !== (Deno.env.get("SUPABASE_ANON_KEY") ?? "")) {
      try {
        const { data: authData } = await supabase.auth.getUser(bearer);
        if (authData?.user?.email) proEmail = authData.user.email.toLowerCase().trim();
      } catch (authErr) {
        // A bad token is an anonymous request, not an error. It must never fall
        // through to the body email — that is the bug this block exists to fix.
        console.error("[CREATE-PRODUCT-CHECKOUT] token check failed:", authErr);
      }
    }

    // `normalizedEmail` keeps its OTHER job below (prefilling Stripe's
    // customer_email at :196), which is a convenience and mints nothing.
    if (proEmail) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } },
        );
        // The shared reader, so a $99 agent plan or a comped agent account
        // (which includes Pro) is not sent to Stripe for an included tool:
        // this copy read only pro_subscribers (L6-08, decision-free half).
        // Same statuses and grace as before.
        const proActive = await isProCached(supabase, proEmail);
        if (proActive) {
          const { data: grant, error: grantError } = await supabase
            .from("pro_grants")
            .insert({
              email: proEmail,
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
            console.log(`[CREATE-PRODUCT-CHECKOUT] Pro grant ${grant.id} issued to ${proEmail} for ${product.name}`);
            return new Response(
              JSON.stringify({
                url: productId.startsWith('freelance')
                  ? `${origin}/freelance-boost?session_id=pro_${grant.id}`
                  : `${origin}/product-success?session_id=pro_${grant.id}&product=${productId}`,
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
    } else if (normalizedEmail) {
      // A PRO SUBSCRIBER WHO IS SIGNED OUT MUST NOT BE CHARGED FOR WHAT THEY OWN.
      // Gating the grant on the session would otherwise send them to Stripe to
      // buy a product their subscription already includes — fixing a way to
      // take money that should not be taken by creating another one. This
      // branch mints NOTHING, so it carries none of the entitlement risk: it
      // only tells the page to ask them to sign in.
      //
      // It does reveal whether an address is a Pro subscriber (one bit, from
      // the cache, no Stripe call, under this function's per-address limit).
      // check-subscription no longer answers that for a stranger (2026-10-05),
      // so this is now the one place that does: whether to keep it -- and so
      // not charge a signed-out subscriber for a tool their plan includes --
      // is an owner decision recorded in the payments wave report.
      try {
        const proActive = await isProCached(supabase, normalizedEmail);
        if (proActive) {
          return new Response(
            JSON.stringify({ proRequiresSignIn: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
          );
        }
      } catch (proErr) {
        console.error("[CREATE-PRODUCT-CHECKOUT] signed-out Pro check failed:", proErr);
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
      // Freelance Boost is a guided flow — return the buyer to it so
      // generation runs against their saved intake, not the generic page.
      success_url: productId.startsWith('freelance')
        ? `${origin}/freelance-boost?session_id={CHECKOUT_SESSION_ID}`
        : `${origin}/product-success?session_id={CHECKOUT_SESSION_ID}&product=${productId}`,
      cancel_url: `${origin}/payment-failed?product=${productId}`,
      metadata: {
        product_type: product.productType,
        product_name: product.name,
        customer_email: normalizedEmail || "",
        credits: product.credits?.toString() || "",
        job_title: sanitizedJobTitle,
        job_company: sanitizedJobCompany,
        referral_code: sanitizedReferralCode,
        language: sanitizedLanguage,
      },
    });

    // WHICH RÉSUMÉ THIS PURCHASE IS DELIVERED FROM STAYS ON OUR SIDE. The
    // temporary-store id is a bearer key to the whole text for its 24 hours,
    // so it is not in the metadata above; it is kept against the Stripe
    // session id in a table only service_role reads, before the browser has
    // the url, so no payment can arrive ahead of it. If it cannot be kept the
    // session is expired and the buyer asked to try again: a paid delivery
    // that cannot find its résumé is worse than a retry. A résumé already
    // gone ("gone") is what delivery would have found anyway, so the checkout
    // goes ahead as it always has.
    const tempResumeId = tempResumeIdOf(sessionId);
    if (tempResumeId) {
      const kept = await rememberCheckoutResume(supabase, session.id, tempResumeId);
      if (kept === "failed") {
        try {
          await stripe.checkout.sessions.expire(session.id);
        } catch (expireErr) {
          console.error("[CREATE-PRODUCT-CHECKOUT] Could not expire the session whose résumé reference failed:", expireErr instanceof Error ? expireErr.message : expireErr);
        }
        return new Response(
          JSON.stringify({ error: "Failed to create checkout. Please try again." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
        );
      }
      if (kept === "gone") {
        console.log(`[CREATE-PRODUCT-CHECKOUT] Session ${session.id}: the résumé it names is no longer stored`);
      }
    }

    // The start is on record before the browser has the url, so no
    // navigation can race it; keyed on the session id, so a second checkout
    // is a second row. Never blocks the purchase.
    await recordCheckoutStart(supabase, {
      stripeSessionId: session.id,
      checkoutFunction: "create-product-checkout",
      productType: product.productType,
      productId,
      amountCents: session.amount_total,
      currency: session.currency,
      mode: session.mode,
      context: checkoutContextOf(body),
      metadata: { language: sanitizedLanguage, referral: !!sanitizedReferralCode, credits: product.credits ?? null },
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
