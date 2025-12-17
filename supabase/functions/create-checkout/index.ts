import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT = 30; // 30 requests per hour (increased for checkout - revenue critical)
const RATE_WINDOW_MINUTES = 60;
const BASE_PRICE_USD = 25;

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
  ron: { rate: 4.60, minUnit: 100 },
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

function calculateAmount(currency: string): { amount: number; currency: string } {
  const lowerCurrency = currency.toLowerCase();
  const currencyData = CURRENCY_RATES[lowerCurrency];
  
  if (!currencyData) {
    // Fallback to USD if currency not supported
    return { amount: BASE_PRICE_USD * 100, currency: "usd" };
  }
  
  const convertedAmount = BASE_PRICE_USD * currencyData.rate;
  const roundedAmount = Math.round(convertedAmount);
  const amountInSmallestUnit = roundedAmount * currencyData.minUnit;
  
  return { amount: amountInSmallestUnit, currency: lowerCurrency };
}

serve(async (req) => {
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

  // Get client IP for rate limiting
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                   req.headers.get("x-real-ip") ||
                   "unknown";

  try {
    logStep("Function started", { ip: clientIp });

    // Check persistent rate limit
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check per-function rate limit
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'create-checkout',
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rlError) {
      console.error("[CREATE-CHECKOUT] Rate limit check error:", rlError);
    } else if (!allowed) {
      logStep("Rate limit exceeded", { ip: clientIp });
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check global rate limit (100 req/hr across ALL functions)
    const { data: globalAllowed, error: globalRlError } = await supabase.rpc('check_global_rate_limit', {
      p_ip: clientIp,
      p_max_requests: 100,
      p_window_minutes: 60
    });

    if (globalRlError) {
      console.error("[CREATE-CHECKOUT] Global rate limit check error:", globalRlError);
    } else if (!globalAllowed) {
      logStep("Global rate limit exceeded", { ip: clientIp });
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    const { resumeData, currency: requestedCurrency } = await req.json();
    logStep("Received request", { hasResumeData: !!resumeData, currency: requestedCurrency });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const origin = req.headers.get("origin") || "https://lovable.dev";

    // Calculate amount in the requested currency
    const { amount, currency } = calculateAmount(requestedCurrency || "usd");
    logStep("Calculated price", { amount, currency, baseUSD: BASE_PRICE_USD });

    // Create a one-time payment session with dynamic pricing for multi-currency
    const session = await stripe.checkout.sessions.create({
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
      cancel_url: `${origin}/?canceled=true`,
      metadata: {
        resumeData: resumeData ? JSON.stringify(resumeData).slice(0, 500) : "",
        originalCurrency: currency,
        baseAmountUSD: BASE_PRICE_USD.toString(),
      },
    });

    logStep("Checkout session created", { sessionId: session.id, currency, amount });

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-CHECKOUT] Error:", errorMessage, error);
    
    // Provide more specific error messages
    let userMessage = "Failed to create checkout session. Please try again.";
    let statusCode = 500;
    
    if (errorMessage.includes('Invalid API Key') || errorMessage.includes('api_key')) {
      userMessage = "Payment service configuration error. Please contact support.";
      statusCode = 503;
    } else if (errorMessage.includes('currency')) {
      userMessage = "Invalid currency. Please refresh and try again.";
      statusCode = 400;
    } else if (errorMessage.includes('amount')) {
      userMessage = "Invalid payment amount. Please refresh and try again.";
      statusCode = 400;
    }
    
    return new Response(JSON.stringify({ error: userMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: statusCode,
    });
  }
});