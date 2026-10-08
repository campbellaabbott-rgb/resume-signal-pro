// deploy-stamp: 2026-10-08T13:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { getServiceClient } from "../_shared/supabase-client.ts";
import { checkoutContextOf, recordCheckoutStart } from "../_shared/checkout-start.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { accountProStanding } from "../_shared/pro.ts";
import { FULL_ANALYSIS_PRODUCT_NAME, FULL_ANALYSIS_PRODUCT_TYPE } from "../_shared/full-analysis.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "create-checkout.2026-10-08.1";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Performance monitoring thresholds (ms)
const SLOW_REQUEST_THRESHOLD = 5000; // 5s for checkout
const VERY_SLOW_THRESHOLD = 10000;

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "resumeboostersupp@gmail.com";
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between alerts per type
const alertLastSent: Record<string, number> = {};

// Send alert email (non-blocking, rate-limited)
async function sendAlert(alertType: string, subject: string, details: Record<string, unknown>) {
  const now = Date.now();
  const lastSent = alertLastSent[alertType] || 0;
  
  if (now - lastSent < ALERT_COOLDOWN_MS) {
    console.log(`[ALERT] Skipping ${alertType} alert (cooldown active)`);
    return;
  }
  
  alertLastSent[alertType] = now;
  
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return;
    
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Resume Booster Alerts <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `🚨 ${subject}`,
        html: `
          <h2>Checkout Alert - Revenue Impact</h2>
          <p><strong>Alert Type:</strong> ${alertType}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <h3>Details:</h3>
          <pre style="background:#f4f4f4;padding:15px;border-radius:5px;">${JSON.stringify(details, null, 2)}</pre>
        `,
      }),
    });
    
    if (!response.ok) {
      console.error("[ALERT] Failed to send:", await response.text());
    } else {
      console.log(`[ALERT] Sent ${alertType} alert`);
    }
  } catch (error) {
    console.error("[ALERT] Error sending alert:", error);
  }
}

// Performance tracking helper with alerting
const trackPerformance = (startTime: number, operation: string, success: boolean, details?: Record<string, unknown>, clientIp?: string) => {
  const duration = Date.now() - startTime;
  const level = duration > VERY_SLOW_THRESHOLD ? 'CRITICAL' : duration > SLOW_REQUEST_THRESHOLD ? 'SLOW' : 'OK';
  console.log(`[PERF] ${operation} | ${duration}ms | ${level} | success=${success}${details ? ` | ${JSON.stringify(details)}` : ''}`);
  
  // Send alert for CRITICAL performance or errors (checkout is revenue-critical)
  if (level === 'CRITICAL' || !success) {
    EdgeRuntime.waitUntil(
      sendAlert(
        success ? `${operation}_slow` : `${operation}_error`,
        success ? `CHECKOUT SLOW (${duration}ms) - Revenue Impact` : `CHECKOUT ERROR - Revenue Impact`,
        { operation, duration, level, success, ip: clientIp || 'unknown', ...details }
      )
    );
  }
  
  return duration;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

// Module-level singletons (reduces latency variance on warm invocations)
const supabase = getServiceClient();

let stripeInstance: Stripe | null = null;
function getStripe(stripeKey: string): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
  }
  return stripeInstance;
}

const RATE_LIMIT = 30; // 30 requests per hour (increased for checkout - revenue critical)
const RATE_WINDOW_MINUTES = 60;
const BASE_PRICE_USD = 5;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Supported currencies with exchange rates (approximate, updated periodically)
// Amount is in smallest currency unit (cents, pence, etc.)
const CURRENCY_RATES: Record<string, { rate: number; minUnit: number }> = {
  usd: { rate: 1, minUnit: 100 },
  cad: { rate: 1.40, minUnit: 100 },
  gbp: { rate: 0.79, minUnit: 100 },
  eur: { rate: 0.92, minUnit: 100 },
  inr: { rate: 84.50, minUnit: 100 },
  aud: { rate: 1.58, minUnit: 100 },
  jpy: { rate: 154, minUnit: 1 }, // JPY has no decimal
  mxn: { rate: 20.20, minUnit: 100 },
  brl: { rate: 6.10, minUnit: 100 },
  php: { rate: 58.50, minUnit: 100 },
  sgd: { rate: 1.35, minUnit: 100 },
  nzd: { rate: 1.75, minUnit: 100 },
  chf: { rate: 0.89, minUnit: 100 },
  sek: { rate: 10.90, minUnit: 100 },
  nok: { rate: 11.20, minUnit: 100 },
  dkk: { rate: 6.90, minUnit: 100 },
  pln: { rate: 4.05, minUnit: 100 },
  zar: { rate: 18.20, minUnit: 100 },
  hkd: { rate: 7.80, minUnit: 100 },
  krw: { rate: 1420, minUnit: 1 }, // KRW has no decimal
  thb: { rate: 35.00, minUnit: 100 },
  myr: { rate: 4.45, minUnit: 100 },
  idr: { rate: 15900, minUnit: 100 },
  ils: { rate: 3.65, minUnit: 100 },
  aed: { rate: 3.67, minUnit: 100 },
  twd: { rate: 32.50, minUnit: 100 },
  czk: { rate: 23.50, minUnit: 100 },
  huf: { rate: 390, minUnit: 100 },
  ron: { rate: 4.70, minUnit: 100 },
  uyu: { rate: 44.50, minUnit: 100 },
};

// Blocked country codes (ISO 3166-1 alpha-2)
const BLOCKED_COUNTRIES = new Set(['RU', 'NG', 'PK']);

const getCountryCode = (req: Request): string | null => {
  return req.headers.get('cf-ipcountry') || 
         req.headers.get('x-vercel-ip-country') || 
         null;
};

const isBlockedCountry = (req: Request): boolean => {
  const country = getCountryCode(req);
  if (!country) return false;
  return BLOCKED_COUNTRIES.has(country.toUpperCase());
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

/** Currencies Stripe bills in whole major units: the smallest-unit amount must
 *  be divisible by 100. https://docs.stripe.com/currencies#special-cases */
export const STRIPE_WHOLE_UNIT_CURRENCIES = new Set(["twd", "huf", "ugx"]);

export function calculateAmount(currency: string): { amount: number; currency: string } {
  const lowerCurrency = currency.toLowerCase();
  const currencyData = CURRENCY_RATES[lowerCurrency];
  
  if (!currencyData) {
    // Fallback to USD if currency not supported
    return { amount: BASE_PRICE_USD * 100, currency: "usd" };
  }
  
  // Multiply by minUnit BEFORE rounding — rounding major units first (e.g. 4.6 → 5)
  // then multiplying by 100 gives €5.00 instead of €4.60 (26% overcharge for GBP).
  let amountInSmallestUnit = Math.round(BASE_PRICE_USD * currencyData.rate * currencyData.minUnit);

  // THREE CURRENCIES STRIPE TREATS SPECIALLY, and one of them was unbuyable.
  //
  // Stripe requires TWD, HUF and UGX amounts to be evenly divisible by 100 — it
  // charges them in whole major units despite presenting them with two decimal
  // places. 5 x 32.50 x 100 = 16,250 for TWD, which is not, so every Taiwanese
  // customer's checkout session was rejected with invalid_request_error. HUF
  // escaped only by arithmetic luck (5 x 390 x 100 = 195,000, divisible), which
  // is why TWD was the only one broken: it is the only rate in the table with a
  // half unit.
  //
  // Rounding to the nearest whole major unit gives NT$163 rather than NT$162.50.
  // The table is hand-edited, so the next rate with a fractional part would have
  // reintroduced this silently — hence the test.
  if (STRIPE_WHOLE_UNIT_CURRENCIES.has(lowerCurrency)) {
    amountInSmallestUnit = Math.round(amountInSmallestUnit / 100) * 100;
  }

  return { amount: amountInSmallestUnit, currency: lowerCurrency };
}

// ONE KEY PER LOGICAL REQUEST (platform sweep L6-17). It used to be the
// caller's address and a 5-second bucket, which was wrong both ways: this
// function's own retry after a Stripe 500 replayed Stripe's stored 500 (Stripe
// saves the first result for a key, errors included), and a second request
// from the same address in the same bucket -- a double-click, a retry, a
// shared office NAT -- sent different params (expires_at is per request), got
// idempotency_error and a failed $5 checkout. Each ATTEMPT of a request gets
// its own suffix (see createStripeSessionWithRetry), so a retry is a real
// retry; the cost of a duplicate is an unused checkout session that expires
// on its own, never a second charge.
export function generateIdempotencyKey(): string {
  return `checkout_${crypto.randomUUID()}`;
}

// Sleep helper for retry delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry wrapper for Stripe API calls
async function createStripeSessionWithRetry(
  stripe: Stripe,
  sessionParams: Stripe.Checkout.SessionCreateParams,
  idempotencyKey: string,
  maxRetries: number = MAX_RETRIES
): Promise<Stripe.Checkout.Session> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logStep(`Stripe API attempt ${attempt}/${maxRetries}`);
      
      const session = await stripe.checkout.sessions.create(sessionParams, {
        idempotencyKey: `${idempotencyKey}_${attempt}`,
      });
      
      logStep(`Stripe session created successfully on attempt ${attempt}`);
      return session;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry for certain errors
      const errorMessage = lastError.message.toLowerCase();
      if (
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('invalid_request_error') ||
        errorMessage.includes('card_error')
      ) {
        logStep(`Non-retryable Stripe error: ${lastError.message}`);
        throw lastError;
      }
      
      // Log and wait before retry (if not last attempt)
      if (attempt < maxRetries) {
        const delay = RETRY_DELAY_MS * attempt; // Exponential backoff
        logStep(`Stripe API error, retrying in ${delay}ms`, { 
          attempt, 
          error: lastError.message 
        });
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  logStep(`All ${maxRetries} Stripe API attempts failed`);
  throw lastError;
}

serve(async (req) => {
  const requestStartTime = Date.now();
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Geo-blocking check
  if (isBlockedCountry(req)) {
    const country = getCountryCode(req);
    console.log(`[CREATE-CHECKOUT] Blocked request from country: ${country}`);
    return new Response(
      JSON.stringify({ error: "Service not available in your region." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // The platform's word for the caller's address (cf-connecting-ip, else the
  // last forwarded hop), never the first hop, which a caller writes itself
  // and could rotate per request to dodge the limit below.
  const clientIp = clientAddressOr(req.headers);

  try {
    logStep("Function started", { ip: clientIp });

    // Parse body early so warm-up can short-circuit without hitting DB or Stripe API
    let requestBody: any;
    try {
      requestBody = await req.json();
    } catch {
      logStep("Invalid JSON in request body");
      return new Response(
        JSON.stringify({ error: "Invalid request format. Please try again." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Warm-up requests should NEVER create real Stripe sessions or consume rate limits
    if (requestBody?._warmup === true) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (stripeKey) {
        // Initialize Stripe client (no network calls)
        getStripe(stripeKey);
      }

      if (!supabase) {
        console.error("[CREATE-CHECKOUT] Missing backend configuration during warm-up");
      }

      return new Response(
        JSON.stringify({ warmed: true, timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (!supabase) {
      throw new Error("Missing Supabase configuration");
    }

    // Check BOTH rate limits in parallel (saves ~100-200ms)
    const [rateLimitResult, globalRateLimitResult] = await Promise.all([
      supabase.rpc('check_rate_limit', {
        p_ip: clientIp,
        p_function: 'create-checkout',
        p_max_requests: RATE_LIMIT,
        p_window_minutes: RATE_WINDOW_MINUTES
      }),
      supabase.rpc('check_global_rate_limit', {
        p_ip: clientIp,
        p_max_requests: 100,
        p_window_minutes: 60
      })
    ]);

    if (rateLimitResult.error) {
      console.error("[CREATE-CHECKOUT] Rate limit check error:", rateLimitResult.error);
    } else if (!rateLimitResult.data) {
      logStep("Rate limit exceeded", { ip: clientIp });
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later.", code: "rate_limited_function" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" } }
      );
    }

    if (globalRateLimitResult.error) {
      console.error("[CREATE-CHECKOUT] Global rate limit check error:", globalRateLimitResult.error);
    } else if (!globalRateLimitResult.data) {
      logStep("Global rate limit exceeded", { ip: clientIp });
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later.", code: "rate_limited_budget" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" } }
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      console.error("[CREATE-CHECKOUT] STRIPE_SECRET_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Payment service temporarily unavailable. Please try again later." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    logStep("Stripe key verified");

    // NO RÉSUMÉ TEXT IS READ FROM THIS BODY. Until 2026-10-04 the first 500
    // characters of it (the name, email, phone and address header, in
    // practice) were copied into the Stripe session's metadata, where Stripe
    // kept them and stripe-webhook stored them again in webhook_events. Nothing
    // ever read them: the analysis is fulfilled on the success page from the
    // temporary store, whose id the browser already holds. A body that still
    // carries the text (an old cached bundle) is simply not looked at.
    const { currency: requestedCurrency, promoCode } = requestBody;
    logStep("Received request", { currency: requestedCurrency });

    // Validate currency format if provided
    if (requestedCurrency && typeof requestedCurrency !== 'string') {
      logStep("Invalid currency format");
      return new Response(
        JSON.stringify({ error: "Invalid currency format. Please refresh and try again." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = getStripe(stripeKey);
    const origin = req.headers.get("origin") || "https://lovable.dev";

    // THE FULL ANALYSIS IS PART OF PRO (owner decision 2026-10-04, platform
    // sweep L3-04). The Pro card and Pro's own Stripe page said "every paid
    // tool included -- Full Analysis", and this function charged a Pro member
    // $5 for it anyway: it had no signed-in path at all. A signed-in account
    // whose plan may mint consumables (the one rule, _shared/pro-standing.ts:
    // both caches, by the VERIFIED account, never an address on the session,
    // and not a trial) gets a single-use grant instead of a Stripe session,
    // exactly as create-product-checkout mints one, and the success page
    // redeems it through analyze-resume like a paid session. A trial, or no
    // plan, buys at the price below.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (bearer && bearer !== (Deno.env.get("SUPABASE_ANON_KEY") ?? "")) {
      let member: { id: string; email: string } | null = null;
      try {
        const { data: authData } = await supabase.auth.getUser(bearer);
        const u = authData?.user;
        if (u?.id && typeof u.email === "string" && u.email.includes("@")) member = { id: u.id, email: u.email.trim().toLowerCase() };
      } catch (authErr) {
        // A token the auth server refuses is an anonymous buyer, nothing more.
        logStep("Token check failed; continuing as an anonymous checkout", { error: String(authErr).slice(0, 120) });
      }
      if (member) {
        const standing = await accountProStanding(supabase, member.id);
        if (!standing.known) {
          // Charging a member for a tool their plan includes is worse than a retry.
          return new Response(
            JSON.stringify({ error: "We couldn't check your plan just now. Please try again in a minute." }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (standing.consumables) {
          const tempSessionId = typeof requestBody?.tempSessionId === "string" && UUID_RE.test(requestBody.tempSessionId)
            ? requestBody.tempSessionId : null;
          const { data: grant, error: grantError } = await supabase
            .from("pro_grants")
            .insert({
              email: member.email,
              user_id: member.id,
              product_id: "fullAnalysis",
              product_type: FULL_ANALYSIS_PRODUCT_TYPE,
              product_name: FULL_ANALYSIS_PRODUCT_NAME,
              resume_session_id: tempSessionId,
            })
            .select("id")
            .single();
          if (!grantError && grant?.id) {
            logStep("Pro grant issued for the full analysis", { grant: grant.id });
            trackPerformance(requestStartTime, 'create-checkout', true, { proIncluded: true }, clientIp);
            return new Response(JSON.stringify({
              url: `${origin}/success?session_id=pro_${grant.id}`,
              sessionId: `pro_${grant.id}`,
              proIncluded: true,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
          }
          // Never a charge for an included tool: a failed mint is a retry.
          logStep("Pro grant insert failed", { error: grantError?.message ?? "no id returned" });
          return new Response(
            JSON.stringify({ error: "We couldn't unlock your included analysis just now. Please try again in a minute." }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (standing.trialing) logStep("Trialing plan: the full analysis is bought, not minted, while the trial runs");
      }
    }

    // Optional coupon code (normalize to UPPERCASE)
    const normalizedPromoCode =
      typeof promoCode === "string" ? promoCode.trim().toUpperCase() : "";

    let promotionCodeId: string | null = null;

    if (normalizedPromoCode) {
      logStep("Promo code provided", { promoCode: normalizedPromoCode });

      const promotionCodes = await stripe.promotionCodes.list({
        code: normalizedPromoCode,
        active: true,
        limit: 1,
      });

      if (!promotionCodes.data.length) {
        logStep("Promo code not found/invalid", { promoCode: normalizedPromoCode });
        return new Response(
          JSON.stringify({
            error: "Invalid coupon code. Please check the code and try again.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      promotionCodeId = promotionCodes.data[0].id;
      logStep("Promo code resolved", { promotionCodeId });
    }

    // Calculate amount in the requested currency
    const { amount, currency } = calculateAmount(requestedCurrency || "usd");
    logStep("Calculated price", { amount, currency, baseUSD: BASE_PRICE_USD });

    // Validate calculated amount (sanity check)
    if (amount < 100 || amount > 10000000) { // Between $1 and $100,000 equivalent
      logStep("Invalid calculated amount", { amount });
      return new Response(
        JSON.stringify({ error: "Invalid payment amount. Please refresh and try again." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // One key for this request and its retries (see generateIdempotencyKey).
    const idempotencyKey = generateIdempotencyKey();

    // Create session params
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: "Resume Booster Analysis",
              description: "Comprehensive AI-powered resume analysis with ATS optimization, bullet rewrites, and action plan",
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      // Backing out of Stripe lands here, and the page offers the way back to
      // what they were buying (L3-15), so it is told which product.
      cancel_url: `${origin}/payment-failed?product=fullAnalysis`,
      allow_promotion_codes: true, // Enable coupon/promo code input field
      // Every value here is kept by Stripe for the life of the account, so
      // only what Stripe itself needs and nothing a person wrote.
      metadata: {
        originalCurrency: currency,
        baseAmountUSD: BASE_PRICE_USD.toString(),
        product_type: 'full_analysis',
      },
      // Additional reliability settings
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Session expires in 30 minutes
    };

    if (promotionCodeId) {
      sessionParams.discounts = [{ promotion_code: promotionCodeId }];
      sessionParams.allow_promotion_codes = false;
    }

    // Create checkout session with retry logic
    const session = await createStripeSessionWithRetry(stripe, sessionParams, idempotencyKey);

    // The start is on record before the browser has the url, so no
    // navigation can race it; keyed on the session id, so a second checkout
    // is a second row. Never blocks the purchase.
    await recordCheckoutStart(supabase, {
      stripeSessionId: session.id,
      checkoutFunction: "create-checkout",
      productType: "full_analysis",
      productId: "fullAnalysis",
      amountCents: session.amount_total ?? amount,
      currency: session.currency ?? currency,
      mode: session.mode ?? "payment",
      context: checkoutContextOf(requestBody),
      metadata: { promo: !!promotionCodeId, requestedCurrency: requestedCurrency ?? null },
    });

    trackPerformance(requestStartTime, 'create-checkout', true, { currency, amount }, clientIp);
    logStep("Checkout session created", { sessionId: session.id, currency, amount });

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    trackPerformance(requestStartTime, 'create-checkout', false, { error: errorMessage }, clientIp);
    console.error("[CREATE-CHECKOUT] Error:", errorMessage, error);
    
    // Provide more specific error messages
    let userMessage = "Failed to create checkout session. Please try again.";
    let statusCode = 500;
    
    if (errorMessage.includes('Invalid API Key') || errorMessage.includes('api_key')) {
      userMessage = "Payment service configuration error. Please contact support.";
      statusCode = 503;
    } else if (errorMessage.includes('authentication')) {
      userMessage = "Payment service authentication error. Please contact support.";
      statusCode = 503;
    } else if (errorMessage.includes('currency')) {
      userMessage = "Invalid currency. Please refresh and try again.";
      statusCode = 400;
    } else if (errorMessage.includes('amount')) {
      userMessage = "Invalid payment amount. Please refresh and try again.";
      statusCode = 400;
    } else if (errorMessage.includes('rate_limit') || errorMessage.includes('too many requests')) {
      userMessage = "Payment service is busy. Please wait a moment and try again.";
      statusCode = 429;
    } else if (errorMessage.includes('timeout') || errorMessage.includes('network')) {
      userMessage = "Connection to payment service timed out. Please try again.";
      statusCode = 503;
    }
    
    return new Response(JSON.stringify({ error: userMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: statusCode,
    });
  }
});