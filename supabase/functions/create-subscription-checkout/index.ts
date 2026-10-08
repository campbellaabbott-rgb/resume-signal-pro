// deploy-stamp: 2026-10-08T13:00Z
// Creates a Stripe Checkout session for Resume Booster Pro — $45/month,
// all current and future consumer tools included. Uses inline recurring
// price_data so no Price object needs to exist in the Stripe dashboard.
//
// SIGNED-IN CALLERS ONLY, for their own address (2026-10-04 completeness
// review). It used to take any address from the body and answer
// {alreadySubscribed: true} when that address paid us -- a subscription
// oracle for strangers that spent unmetered Stripe calls on every guess. The
// double-billing guard needs that lookup, and a lookup may only be answered
// about the caller, so the caller must be known: the page sends a signed-out
// visitor to sign in first (the success page, /account, needs an account
// anyway, and so does cancelling). Rate-limited per network address.
//
// THE GUARD (platform sweep L6-06): a plan that owes money (past_due,
// unpaid...) answers needsPaymentUpdate -- the fix is the card, not a second
// subscription that bills beside the first once Stripe's retry succeeds. A
// new subscription is billed to the Stripe customer the address already has,
// so the portal can see everything it pays for (L6-05).
//
// AND THE PLAN BELONGS TO THE ACCOUNT THAT BOUGHT IT (wave 2, L6-08). The
// buyer's user id rides the session (client_reference_id, metadata) and the
// subscription itself (subscription_data.metadata.user_id); checkProByEmail,
// which the webhook runs on purchase, copies it onto pro_subscribers.user_id,
// and every gate reads the plan by that id (pro_entitlement_rows). An address
// is a claim a password sign-up can make. NO TRIAL is offered here, so the
// one-trial rule of create-agent-checkout has nothing to guard.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { PRO_PRICE_CENTS, PRO_PRODUCT_NAME, subscriptionStandingByEmail } from "../_shared/pro.ts";
import { manualAgentGrant } from "../_shared/agent.ts";
import { checkoutVerdict, verdictBody } from "../_shared/subscription-standing.ts";
import { signedInUser } from "../_shared/signed-in-email.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { checkoutContextOf, recordCheckoutStart } from "../_shared/checkout-start.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "create-subscription-checkout.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Fail open on a counter error (a checkout is revenue); only an explicit
    // "no" refuses.
    const { data: allowed } = await supabase.rpc("check_rate_limit", {
      p_function: "create-subscription-checkout",
      p_ip: clientAddressOr(req.headers),
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (allowed === false) return json({ error: "Too many requests. Please try again later." }, 429);

    const buyer = await signedInUser(supabase.auth, req.headers, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const email = buyer?.email ?? null;
    if (!buyer?.id || !email) {
      return json({ error: "Sign in to subscribe, so the plan is attached to your account.", signInRequired: true }, 401);
    }
    const body = await req.json().catch(() => ({}));

    // An account granted the agent by hand already has Pro (the agent includes it).
    if (await manualAgentGrant(supabase, email)) return json({ alreadySubscribed: true, tier: "agent" });

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    // Don't double-bill: a live plan, or one that owes money, is answered
    // before Stripe is asked for anything new.
    const standing = await subscriptionStandingByEmail(stripe, email);
    const verdict = checkoutVerdict(standing, "pro");
    if (verdict.kind !== "proceed") return json(verdictBody(verdict));

    const origin = req.headers.get("origin") || "https://resumebooster.work";
    // The buyer's user id ON THE SUBSCRIPTION: the copy checkProByEmail reads
    // to bind pro_subscribers.user_id, on every later refresh.
    const subscriptionBuyer = { user_id: buyer.id };
    const session = await stripe.checkout.sessions.create({
      ...(standing.reuseCustomerId ? { customer: standing.reuseCustomerId } : { customer_email: email }),
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: PRO_PRICE_CENTS,
            recurring: { interval: "month" },
            product_data: {
              name: PRO_PRODUCT_NAME,
              description:
                "Every Resume Booster tool included — full analysis, keyword fix, cover letters, interview coach, career simulator, premium packages, unlimited scans, plus every new tool we ship.",
            },
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      // THE BUYER, three ways (the session, its metadata, the subscription).
      client_reference_id: buyer.id,
      subscription_data: { metadata: subscriptionBuyer },
      success_url: `${origin}/account?pro=success`,
      cancel_url: `${origin}/pricing?pro=cancelled`,
      metadata: { product_type: "pro_subscription", customer_email: email, user_id: buyer.id },
    });

    // The start is on record before the browser has the url, so no
    // navigation can race it; keyed on the session id, so a second checkout
    // is a second row. Never blocks the purchase.
    await recordCheckoutStart(supabase, {
      stripeSessionId: session.id,
      checkoutFunction: "create-subscription-checkout",
      productType: "pro_subscription",
      productId: null,
      amountCents: session.amount_total,
      currency: session.currency,
      mode: session.mode,
      context: checkoutContextOf(body),
      metadata: { planCents: PRO_PRICE_CENTS },
    });

    console.log(`[CREATE-SUBSCRIPTION-CHECKOUT] Session ${session.id} created`);
    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("[CREATE-SUBSCRIPTION-CHECKOUT] Error:", error);
    return json({ error: "Could not start checkout. Please try again." }, 500);
  }
});
