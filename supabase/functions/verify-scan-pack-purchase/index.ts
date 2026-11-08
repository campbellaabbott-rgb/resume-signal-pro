// deploy-stamp: 2026-10-09T13:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkoutSessionSettled } from "../_shared/pass-settlement.ts";
import { buyerEmailOf } from "../_shared/buyer-email.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { maskEmail } from "../_shared/mailbox-proof.ts";
import { networkBucket } from "../_shared/network-bucket.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-11-10.1 (hotfix H3, M-S14-007 / C-S14-003): an id that cannot be a
// Checkout session never reaches Stripe; a purchase already credited and
// recorded is answered from our own rows; every Stripe read is counted per
// caller network under this function's name, and a count that cannot be
// taken refuses; the buyer's address is masked in every reply.
const FN_BUILD = "verify-scan-pack-purchase.2026-11-10.1";

/** A Stripe Checkout session id, as the other paid doors accept one. */
const CHECKOUT_SESSION = /^cs_[A-Za-z0-9_]{1,250}$/;
/** Stripe reads per caller network per hour: a buyer's page asks once per visit. */
const STRIPE_READS_PER_NETWORK_PER_HOUR = 20;
/**
 * How scan_credit_session_grants keys a purchase: the SHA-256 of its session
 * id, as _shared/scan-credits.ts sessionHash computes it (that module is not
 * bundled here, so its importers keep their own build).
 */
async function sessionHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const NOT_FOUND = "We couldn't find that purchase. If you just paid, wait a moment and refresh; otherwise the link may have expired.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

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

    // NOTHING THAT CANNOT BE A CHECKOUT SESSION IS SENT TO STRIPE (H3). Any
    // string used to be read with the live key, spending the account's read
    // limit the checkouts and the webhook share.
    if (!CHECKOUT_SESSION.test(sessionId)) {
      logStep("Not a Checkout session id; refused before any Stripe read");
      return new Response(
        JSON.stringify({ error: NOT_FOUND }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Verifying session", { sessionId });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // OUR OWN ROWS FIRST (H3). A pack already credited (the claim names a
    // scan product) whose purchase is recorded is answered from the record:
    // a reload of the success page reads Stripe no more. Anything else, or a
    // lookup that fails, goes on to the counted Stripe read below.
    const { data: claim, error: claimLookupError } = await supabase
      .from('used_stripe_sessions')
      .select('product_type')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (!claimLookupError && claim?.product_type) {
      if (claim.product_type !== 'scan_credits' && claim.product_type !== 'scan_pack') {
        logStep("Session claimed for another product", { productType: claim.product_type });
        return new Response(
          JSON.stringify({ error: "Invalid session type", verified: false }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: grant, error: grantError } = await supabase
        .from('scan_credit_session_grants')
        .select('credits_bought')
        .eq('session_hash', await sessionHash(sessionId))
        .maybeSingle();
      const bought = Number(grant?.credits_bought);
      if (!grantError && Number.isInteger(bought) && bought > 0) {
        logStep("Already credited; answered from the record", { credits: bought });
        return new Response(
          JSON.stringify({ verified: true, alreadyCredited: true, creditsAdded: bought }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    }

    // EVERY STRIPE READ IS COUNTED BEFORE IT IS MADE (H3), per caller
    // network (a keyed hash of the IPv4 /24 or IPv6 /48), under this
    // function's own name. A count that cannot be taken is a refusal.
    const readBucket = await networkBucket(req.headers, supabaseServiceKey ?? "", "verify-scan-pack-purchase");
    const { data: readAllowed, error: readCountError } = await supabase.rpc('check_rate_limit', {
      p_ip: readBucket,
      p_function: 'verify-scan-pack-purchase',
      p_max_requests: STRIPE_READS_PER_NETWORK_PER_HOUR,
      p_window_minutes: 60,
    });
    if (readCountError) {
      console.error("[VERIFY-SCAN-PACK-PURCHASE] The Stripe read could not be counted; not reading blind:", readCountError.message);
      return new Response(
        JSON.stringify({ error: "Payment service temporarily unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (readAllowed !== true) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later.", code: "rate_limited_stripe_reads" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" } }
      );
    }

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      console.error("[VERIFY-SCAN-PACK-PURCHASE] STRIPE_SECRET_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Payment service temporarily unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    // Retrieve session with line items. Guard the Stripe call so a
    // malformed/expired id returns a clean 400, not a bare 500.
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items']
      });
    } catch (e) {
      logStep("Session retrieve failed", { message: e instanceof Error ? e.message : String(e) });
      return new Response(
        JSON.stringify({ error: NOT_FOUND }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    logStep("Session retrieved", {
      status: session.payment_status,
      metadata: session.metadata
    });

    // Verify payment completed: 'paid', or a $0 session a 100%-off code
    // completed -- the rule every delivery path shares (L6-10).
    if (!checkoutSessionSettled(session)) {
      return new Response(
        JSON.stringify({ error: "Payment not completed", verified: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify this is a scan credits purchase (accept both old and new product_type values)
    const productType = session.metadata?.product_type;
    if (productType !== 'scan_credits' && productType !== 'scan_pack') {
      logStep("Invalid product type", { productType });
      return new Response(
        JSON.stringify({ error: "Invalid session type", verified: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get email from session: customer_details first, which is the only copy
    // when the checkout reused an existing Stripe customer or started without
    // an address (L6-25).
    const customerEmail = buyerEmailOf(session);
    if (!customerEmail) {
      return new Response(
        JSON.stringify({ error: "No email associated with purchase", verified: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atomically claim this session via the PRIMARY KEY on session_id, rather
    // than a separate SELECT-then-INSERT. This function, stripe-webhook, and
    // verify-product-purchase can all race for the same session (webhook fires
    // server-side while this runs from the user's browser on the success page)
    // — a SELECT-then-INSERT has a window where both see "not yet used" and
    // both credit the customer twice. The other two were already fixed this
    // way; this one was missed. Doing the INSERT first and checking its result
    // makes the claim atomic: only one caller can win it.
    //
    // AND THE CLAIM NAMES THE PRODUCT. This writer recorded none, and the
    // purchase gate (_shared/paid-session.ts) accepts a claim with no product
    // as grandfathered -- so whenever this function won the race against the
    // webhook, a $2 scan-pack receipt became proof of purchase for every paid
    // generator: the exact hole 20260827180000 closed for the other writers.
    // Get credits from line items quantity (more reliable than metadata)
    let creditsToAdd = 1;
    
    if (session.line_items?.data?.length) {
      const quantity = session.line_items.data[0].quantity || 1;
      creditsToAdd = quantity;
      logStep("Credits from line items", { quantity: creditsToAdd });
    } else if (session.metadata?.credits) {
      // Fallback to metadata
      creditsToAdd = parseInt(session.metadata.credits) || 1;
      logStep("Credits from metadata", { credits: creditsToAdd });
    }

    const { error: claimError } = await supabase
      .from('used_stripe_sessions')
      .insert({
        session_id: sessionId,
        ip_address: clientAddressOr(req.headers),
        product_type: productType,
      });

    if (claimError) {
      if (claimError.code === '23505') {
        logStep("Session already claimed by another process (race avoided)", { sessionId });

        // THIS PURCHASE'S COUNT, NEVER THE ADDRESS'S BALANCE (S8-054). The
        // checkout takes any typed address without sign-in, so answering
        // the address's pool here (and on the first claim) told whoever paid
        // the $0.60 minimum how many credits any address holds.
        return new Response(
          JSON.stringify({
            verified: true,
            alreadyCredited: true,
            // Masked (M-S14-007): whoever holds the success link is shown
            // which address was credited, never the address itself.
            email: maskEmail(customerEmail),
            creditsAdded: creditsToAdd
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      // Unexpected DB error — fail closed rather than risk double-crediting
      // on a transient failure.
      console.error("[VERIFY-SCAN-PACK-PURCHASE] Error claiming session:", claimError.message);
      return new Response(
        JSON.stringify({ error: "Failed to verify purchase. Please contact support.", verified: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate credits amount — reject entirely rather than silently under-deliver
    if (creditsToAdd < 1 || creditsToAdd > 500) {
      console.error("[VERIFY-SCAN-PACK-PURCHASE] Invalid credit amount:", creditsToAdd);
      return new Response(
        JSON.stringify({ error: "Invalid credit amount detected. Please contact support.", verified: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
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

    logStep("Credits added successfully", { email: maskEmail(customerEmail), credits: creditsToAdd });

    return new Response(
      JSON.stringify({
        verified: true,
        email: maskEmail(customerEmail),
        creditsAdded: creditsToAdd
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
