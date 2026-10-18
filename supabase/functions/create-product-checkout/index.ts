// deploy-stamp: 2026-10-09T13:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkoutContextOf, recordCheckoutStart } from "../_shared/checkout-start.ts";
import { rememberCheckoutResume, tempResumeIdOf } from "../_shared/checkout-resume-ref.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { accountProStanding } from "../_shared/pro.ts";
import { checkoutOrigin, euConsentAnswer, euConsentRefusal, policyMetadata, sessionPolicy } from "../_shared/checkout-policy.ts";
import { targetRolesMetadata } from "../_shared/target-roles.ts";
import { APPLY_ASSISTANT_ON_SALE } from "../_shared/apply-agent-switch.ts";
import { retiredCheckoutAnswer } from "../_shared/apply-agent-retired.ts";
import { cutCheckoutAnswer, isCutProduct } from "../_shared/product-cuts.ts";
import { ipinfoLookup, territoryAnswer, territoryRefusal, withBillingAddress } from "../_shared/sales-territory.ts";
import {
  buyerMetadata, buyerSessionFields, CALLER_UNAVAILABLE_BODY, checkoutCaller, fairUseAnswer, grantCapOf, recordCheckoutBuyer,
  refusedCallerBody,
} from "../_shared/checkout-buyer.ts";
import { planPaid, UNPAID_PLAN_NOTE } from "../_shared/consumable-paid.ts";
import { sellerGate } from "../_shared/seller-gate.ts";
import { proIncludes } from "../_shared/pro-perks.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-10-11.1: the Apply Assistant is retired; its purchase is a 410 naming
// applying yourself (wave 4, the apply pivot).
// 2026-10-11.2: its refusal reads a switch of its own (APPLY_ASSISTANT_ON_SALE),
// so putting the Agent Pass or plan back on sale cannot reopen it.
// 2026-10-11.23 (wave 4 round 2, checkout-catalogue): the cut products answer
// 410 (product-cuts.ts); a buyer in the EU, the EEA or the UK is refused while
// the EU/UK switch is off (sales-territory.ts); a Pro grant that cannot be
// minted, or an auth server that cannot answer, is a 503 and never a Stripe
// url; a grant over the daily or monthly cap is a fair-use 429; the signed-out
// "you hold Pro" lookup by a typed address is gone (owner decision D8); the
// signed-in buyer's verified address and account ride the session and
// checkout_buyers; the billing address is always collected; a referral here
// earns nothing (the affiliate re-base); a connected app's token, or one
// issued for another audience, is refused with a 401 (critical-path CP-D).
// Owner decisions 2026-10-17, same build: Freelance Boost and Transition Pro
// are cut too (410), so nothing here is sold; a member mints only what Pro
// includes (pro-perks.ts), which is nothing this function sells; and while
// the seller's legal name and postal address are unset every purchase is a
// 409 seller_identity_missing (seller-gate.ts), before the limiter or Stripe.
const FN_BUILD = "create-product-checkout.2026-10-11.23";

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

  // THE APPLY ASSISTANT IS NO LONGER SOLD (owner decision 2026-10-11, the
  // apply pivot). It is one row of PRODUCTS below, so while
  // APPLY_ASSISTANT_ON_SALE is off a purchase of that row is answered 410
  // with the sentence from _shared/apply-agent-retired.ts, BEFORE the client,
  // the rate limiter, the Pro grant or Stripe: nothing is counted, granted or
  // charged, and the buyer is told applying yourself is free. Every other
  // product sells as before. The body is read off a clone, so the purchase
  // path below still reads the original.
  //
  // THE CUT PRODUCTS ARE NO LONGER SOLD EITHER (owner decision 2026-10-12,
  // the product line): every row named in _shared/product-cuts.ts answers
  // 410 here the same way, before anything is counted, granted or charged.
  // Past buyers keep what they bought; nothing they reach reads this.
  const asked = await req.clone().json().catch(() => null);
  const askedId = asked && typeof asked === "object" ? (asked as { productId?: unknown }).productId : undefined;
  if (!APPLY_ASSISTANT_ON_SALE && askedId === "applyAssistant") {
    const answer = retiredCheckoutAnswer("apply_assistant", {
      body: asked,
      acceptLanguage: req.headers.get("accept-language"),
      origin: checkoutOrigin(req.headers.get("origin"), (k: string) => Deno.env.get(k)),
    });
    console.log("[CREATE-PRODUCT-CHECKOUT] refused: the Apply Assistant is no longer sold");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (isCutProduct(askedId)) {
    const answer = cutCheckoutAnswer(String(askedId), {
      body: asked,
      acceptLanguage: req.headers.get("accept-language"),
      origin: checkoutOrigin(req.headers.get("origin"), (k: string) => Deno.env.get(k)),
    });
    console.log(`[CREATE-PRODUCT-CHECKOUT] refused: ${String(askedId)} is no longer sold`);
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  // NO SALE WITHOUT A NAMED SELLER (owner decision 2026-10-17, B&P 17538(d)):
  // before the limiter, a grant or Stripe.
  const closed = sellerGate({ body: asked, acceptLanguage: req.headers.get("accept-language") });
  if (closed) {
    console.log("[CREATE-PRODUCT-CHECKOUT] refused: seller_identity_missing");
    return new Response(JSON.stringify(closed.body), { status: closed.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    const { email, productId, sessionId, jobTitle, jobCompany, language } = body;

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
    const env = (k: string) => Deno.env.get(k);
    // Only our own hosts get the buyer back (S8-060).
    const origin = checkoutOrigin(req.headers.get("origin"), env);

    // Sanitize inputs (pure CPU, very fast)
    const normalizedEmail = email?.includes?.('@') ? email.toLowerCase().trim() : null;
    const sanitizedJobTitle = typeof jobTitle === 'string' ? jobTitle.slice(0, 100).replace(/[<>]/g, '') : '';
    const sanitizedJobCompany = typeof jobCompany === 'string' ? jobCompany.slice(0, 100).replace(/[<>]/g, '') : '';
    // ATS Defense targets up to three roles the buyer names (S11-074).
    const targetRoles = product.productType === 'ats_defense' ? targetRolesMetadata(body.targetRoles) : null;
    // Allowlist against the site's actual supported languages — this flows
    // into an AI prompt server-side later (generation happens from the
    // webhook, which has no access to the browser's i18n state), so it must
    // be captured at checkout time, not assumed.
    const SUPPORTED_LANGUAGES = ['en', 'en-GB', 'es', 'hi', 'tl', 'de', 'fr', 'fr-CA', 'nl', 'pt'];
    const sanitizedLanguage = typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language) ? language : 'en';

    // Pro subscribers get their included tools as a single-use server-side
    // grant instead of a Stripe session, sent straight to the success page.
    // WHO IS ASKING IS DECIDED BY THE SESSION, NOT BY THE BODY.
    //
    // This block mints an ENTITLEMENT, and it used to key that decision on
    // `normalizedEmail`, which is just a field in an unauthenticated POST body
    // (verify_jwt = false for this function). An email address is a claim;
    // only a signed token is proof. The anonymous path never pays for an auth
    // round trip.
    //
    // THREE ANSWERS (checkout-buyer.ts, CP-025): a token the auth server
    // refused is an anonymous buyer; an auth server that could not answer is
    // a 503 and no Stripe url, because sending a member to Stripe then could
    // charge them for a tool their plan includes.
    const caller = await checkoutCaller(supabase.auth, req.headers, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    if (caller.kind === "unavailable") {
      console.error("[CREATE-PRODUCT-CHECKOUT] The auth server could not answer; not starting a checkout:", caller.reason);
      return new Response(JSON.stringify(CALLER_UNAVAILABLE_BODY), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
    }
    // A connected app's token (or one issued for another audience) is not
    // the person on the website: it neither buys nor mints their grant.
    if (caller.kind === "refused") {
      console.log(`[CREATE-PRODUCT-CHECKOUT] refused: the token is not a website session (${caller.reason})`);
      return new Response(JSON.stringify(refusedCallerBody(caller)), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 });
    }
    const proEmail = caller.kind === "signed_in" ? caller.email : null;
    const proUserId = caller.kind === "signed_in" ? caller.id : null;

    if (proEmail) {
      // THE ONE RULE (_shared/pro-standing.ts; L6-08, L6-29): the verified
      // ACCOUNT's plan, from both caches (a $99 or comped agent plan includes
      // Pro), never the session's address. A grant is a consumable: a trial
      // unlocks the plan's ongoing features but mints none, so a trialing
      // member goes to Stripe like anyone else.
      let standing: Awaited<ReturnType<typeof accountProStanding>>;
      try {
        standing = await accountProStanding(supabase, proUserId);
      } catch (proErr) {
        console.error("[CREATE-PRODUCT-CHECKOUT] Pro check threw:", proErr);
        standing = { pro: false, trialing: false, consumables: false, status: null, known: false };
      }
      if (!standing.known) {
        // The plan could not be read. Sending a member to Stripe now could
        // charge them for a tool their plan includes; a retry costs nothing.
        console.error("[CREATE-PRODUCT-CHECKOUT] The account's plan could not be read; not starting a checkout");
        return new Response(
          JSON.stringify({ error: "We couldn't check your plan just now. Please try again in a minute." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
        );
      }
      if (standing.trialing) {
        console.log("[CREATE-PRODUCT-CHECKOUT] Trialing plan: no grant minted while the trial runs");
      }
      // A TRIAL'S FIRST REAL PAYMENT FIRST (S12-098): the hour between a
      // trial's end and its first charge reads "active" in the cache.
      const paid = standing.consumables ? await planPaid(stripe, supabase, proUserId ?? "") : "paid";
      if (paid !== "paid") {
        console.log(`[CREATE-PRODUCT-CHECKOUT] No grant: the plan is ${paid}`);
        return new Response(
          JSON.stringify(paid === "unpaid"
            ? { error: UNPAID_PLAN_NOTE, planUnpaid: true }
            : { error: "We couldn't check your plan just now. Please try again in a minute.", retryable: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: paid === "unpaid" ? 409 : 503 },
        );
      }
      // ONLY WHAT PRO INCLUDES (owner decision 2026-10-17): the Full Analysis,
      // which create-checkout mints. Nothing this function sells is included.
      if (standing.consumables && proIncludes(productId)) {
        const grantFields = {
          // The account the redeemer re-checks (20261008130000).
          user_id: proUserId,
          product_id: productId,
          product_type: product.productType,
          product_name: product.name,
          credits: product.credits ?? null,
          resume_session_id: sessionId || null,
          job_title: sanitizedJobTitle || null,
          job_company: sanitizedJobCompany || null,
          language: sanitizedLanguage,
        };
        let grant: { id?: string } | null = null;
        let grantError: { code?: string; message?: string } | null = null;
        try {
          ({ data: grant, error: grantError } = await supabase
            .from("pro_grants")
            .insert({
              email: proEmail,
              ...grantFields,
              // The roles an ATS Defense grant targets (S11-074).
              ...(targetRoles ? { target_roles: targetRoles } : {}),
            })
            .select("id")
            .single());
          // A database without the target_roles column yet (20261009134300
          // not applied): the grant is minted without the roles.
          if (grantError && targetRoles && (grantError.code === "42703" || grantError.code === "PGRST204")) {
            ({ data: grant, error: grantError } = await supabase
              .from("pro_grants")
              .insert({ email: proEmail, ...grantFields })
              .select("id")
              .single());
          }
        } catch (insertErr) {
          grantError = { message: String(insertErr instanceof Error ? insertErr.message : insertErr) };
        }
        if (!grantError && grant?.id) {
          console.log(`[CREATE-PRODUCT-CHECKOUT] Pro grant ${grant.id} issued for ${product.name}`);
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
        // OVER THE CAP (owner decision D7): fair use, never a charge.
        const cap = grantCapOf(grantError);
        if (cap) {
          const answer = fairUseAnswer(cap);
          console.log(`[CREATE-PRODUCT-CHECKOUT] Pro grant refused by the ${cap} cap`);
          return new Response(JSON.stringify(answer.body), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: answer.status });
        }
        // NEVER A CHARGE FOR AN INCLUDED TOOL (CP-025): a grant that could not
        // be minted is a retry, not a Stripe page. It used to fall back to Stripe.
        console.error("[CREATE-PRODUCT-CHECKOUT] Pro grant insert failed; not starting a checkout:", grantError?.message ?? "no id returned");
        return new Response(
          JSON.stringify({ error: "We couldn't unlock your included tool just now, so nothing was charged. Please try again in a minute.", retryable: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
        );
      }
    }
    // A SIGNED-OUT VISITOR IS NOT TOLD WHETHER AN ADDRESS HOLDS PRO (owner
    // decision D8). The body's address used to be looked up in the Pro cache
    // and answered "sign in to use your plan", which revealed one bit about
    // any address. The page now sends no address for a signed-out buyer, and
    // a subscriber who wants their included tool signs in first.

    // NO SALE INTO THE EU, THE EEA OR THE UK WHILE THE SWITCH IS OFF
    // (S12-059): after the grant (a member's included tool is not a sale),
    // before Stripe.
    const territory = await territoryRefusal({
      env, headers: req.headers, body, address: clientIp, lookup: ipinfoLookup(env),
    });
    if (territory) {
      const answer = territoryAnswer(territory, { body, acceptLanguage: req.headers.get("accept-language") });
      console.log(`[CREATE-PRODUCT-CHECKOUT] refused: the buyer is in the VAT territory (${territory.signal})`);
      return new Response(JSON.stringify(answer.body), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: answer.status });
    }

    // The EU/UK switch (off by default): delivery at once needs the waiver.
    const consentMissing = euConsentRefusal(env, "payment", body);
    if (consentMissing) {
      return new Response(
        JSON.stringify(euConsentAnswer(consentMissing)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    // The Terms shown, the waiver, and the referral, which earns nothing here
    // since the affiliate re-base (_shared/affiliate-commission.ts).
    const policy = policyMetadata(body, env);
    // THE SIGNED-IN BUYER'S VERIFIED ADDRESS FIRST (CP-012): the body's is
    // what the page prefilled, and only a signed-in page sends one.
    const buyerEmail = proEmail ?? normalizedEmail;

    // Create Stripe session - THE ONLY blocking call
    const session = await stripe.checkout.sessions.create({
      customer_email: buyerEmail || undefined,
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
      // The receipt, and tax only with the EU/UK switch on (it was off here
      // by a literal; it still is unless the owner turns the switch on); the
      // billing address on every session (S12-059, withBillingAddress).
      ...withBillingAddress(sessionPolicy({ mode: "payment", env, receiptEmail: buyerEmail })),
      // THE ACCOUNT THAT BOUGHT IT (CP-022): a signed-in buyer's id on the
      // session and its metadata, and in checkout_buyers below.
      ...buyerSessionFields(caller),
      // Freelance Boost is a guided flow — return the buyer to it so
      // generation runs against their saved intake, not the generic page.
      success_url: productId.startsWith('freelance')
        ? `${origin}/freelance-boost?session_id={CHECKOUT_SESSION_ID}`
        : `${origin}/product-success?session_id={CHECKOUT_SESSION_ID}&product=${productId}`,
      cancel_url: `${origin}/payment-failed?product=${productId}`,
      metadata: {
        product_type: product.productType,
        product_name: product.name,
        customer_email: buyerEmail || "",
        ...buyerMetadata(caller),
        credits: product.credits?.toString() || "",
        job_title: sanitizedJobTitle,
        job_company: sanitizedJobCompany,
        language: sanitizedLanguage,
        // The roles an ATS Defense buyer named (S11-074): every deliverer
        // reads them. Empty for any other product, which Stripe stores as none.
        target_roles: targetRoles ?? "",
        ...policy,
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
      metadata: { language: sanitizedLanguage, referral: !!policy.referral_code, credits: product.credits ?? null, termsVersion: policy.terms_version || null, withdrawalWaiver: policy.withdrawal_waiver ?? null },
    });
    // The account behind the session, before the browser has the url.
    await recordCheckoutBuyer(supabase, {
      stripeSessionId: session.id, caller, checkoutFunction: "create-product-checkout", productType: product.productType,
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
